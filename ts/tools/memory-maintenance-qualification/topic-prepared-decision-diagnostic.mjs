// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    configuredTopicDecisionModel,
    packTopicDecisions,
    planTopicDecisionChoice,
    TopicDecisionError,
    withTopicDecisionRepacking,
    canRepackTopicDecision,
    assertTopicDecisionGeneration,
    TopicDecisionCapacityError,
    resolveTopicDecisionExecution,
} from "../../packages/memory/service/dist/topicDecision.js";
import { executeTopicDecisionWave } from "../../packages/memory/service/dist/topicDecisionWave.js";
import { createLimiter } from "../../packages/utils/commonUtils/dist/indexNode.js";
import {
    reviewPreparedTopicChoices,
    reconcileGeneratedPreparedTopics,
} from "../../packages/memory/service/dist/topicPreparedDecisionReview.js";
import {
    prepareTopicDecisionGroups,
    preparedTopicDecisionRecipe,
    reconcilePreparedTopicChoices,
} from "../../packages/memory/service/dist/topicPreparedDecision.js";
import {
    refinePreparedTopicCuration,
    preparedTopicRefinementRecipe,
} from "../../packages/memory/service/dist/topicPreparedRefinement.js";
import {
    createTopicCompletion,
    bindTopicCompletion,
} from "../../packages/memory/service/dist/topicGeneration.js";
import { validateTopicSnapshot } from "../../packages/memory/service/dist/topicSnapshot.js";
import {
    curateTopics,
    orderedTopicNodes,
} from "../../packages/memory/service/dist/topicCuration.js";
import {
    atomicWriteJson,
    createReplayOutput,
    hashBytes,
    hashValue,
    positiveInteger,
} from "./replay-artifacts.mjs";
import {
    implementationIdentity,
    initializeReplayModel,
    inspectTopicReplayModelBinding,
    topicReplayDeadline,
} from "./topic-curation-replay.mjs";
import { decisionReplayImplementation } from "./topic-decision-replay.mjs";
import { recordDiagnosticCompletion } from "./topic-reconciliation-diagnostic.mjs";

const controlRules =
    "For each question in the supplied native Decision request, follow its exact instructions and select exactly one of its offered criteria using only the supplied state. Return an answers object mapping every question ID to the selected criterion key. Do not change definitions, add options, generate metadata, infer endorsement, or fabricate probabilities/confidence.";

export function preparedControlSchema(request) {
    return {
        name: "prepared_topic_bounded_choices",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            required: ["answers"],
            properties: {
                answers: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(request.questions),
                    properties: Object.fromEntries(
                        Object.entries(request.questions).map(
                            ([key, question]) => [
                                key,
                                {
                                    type: "string",
                                    enum: Object.keys(question.criteria),
                                },
                            ],
                        ),
                    ),
                },
            },
        },
    };
}

export function readPreparedControlAnswers(request, response) {
    const answers = {};
    const errors = [];
    const supplied =
        response &&
        typeof response === "object" &&
        response.answers &&
        typeof response.answers === "object" &&
        !Array.isArray(response.answers)
            ? response.answers
            : {};
    for (const [key, question] of Object.entries(request.questions)) {
        const answer = supplied[key];
        if (
            typeof answer === "string" &&
            Object.hasOwn(question.criteria, answer)
        )
            answers[key] = answer;
        else
            errors.push({
                question: key,
                reason: "Missing or unoffered bounded choice",
            });
    }
    for (const key of Object.keys(supplied))
        if (!Object.hasOwn(request.questions, key))
            errors.push({ question: key, reason: "Unknown question ID" });
    return { answers, errors };
}

export function preparedChoices(tasks, pairs, arm) {
    const choices = new Map();
    const rows = [];
    for (const task of tasks) {
        const key = task.candidate.key;
        const relevant = pairs.filter((pair) =>
            pair.packet.tasks.some((entry) => entry.candidate.key === key),
        );
        const offered = new Set(task.targets.map((target) => target.key));
        const evaluated = new Set();
        const values = [];
        for (const pair of relevant) {
            const answer = pair[arm]?.answers?.[`disposition_${key}`];
            if (typeof answer !== "string") continue;
            const piece = pair.packet.tasks.find(
                (entry) => entry.candidate.key === key,
            );
            const criteria =
                pair.packet.request.questions[`disposition_${key}`].criteria;
            assert(
                Object.hasOwn(criteria, answer),
                "Cannot install an unoffered choice",
            );
            values.push(answer);
            for (const target of piece.targets) evaluated.add(target.key);
        }
        const complete =
            task.candidate.complete &&
            task.targets.every(
                (target) =>
                    (target.complete ?? target.candidate?.complete) === true,
            ) &&
            relevant.length > 0 &&
            values.length === relevant.length &&
            [...offered].every((target) => evaluated.has(target));
        const plan = complete
            ? planTopicDecisionChoice(task, values)
            : "uncertain_needs_synthesis";
        const choice =
            typeof plan === "string" ? plan : "uncertain_needs_synthesis";
        choices.set(key, choice);
        rows.push({
            key,
            choice,
            completeExposure: complete,
            expectedPartitions: relevant.length,
            answeredPartitions: values.length,
            offeredTargets: offered.size,
            evaluatedTargets: evaluated.size,
            partitionChoices: values,
            conflict: typeof plan !== "string",
        });
    }
    return { choices, rows };
}

async function nativePacket(
    packet,
    native,
    signal,
    deadline,
    calls,
    save,
    execution,
    reason = "prepared-group-reconciliation",
) {
    deadline.check();
    const entry = {
        ordinal: calls.length,
        started: Date.now(),
        packet: structuredClone(packet),
        transportFailures: [],
        responseBodies: [],
        outcome: "started",
    };
    calls.push(entry);
    await save();
    const model = {
        ...native,
        decide(request, options) {
            deadline.check();
            assertTopicDecisionGeneration(native);
            return native.decide(request, {
                ...options,
                onTransportFailure: (message) =>
                    entry.transportFailures.push(message),
                onFailureResponseBody: (body) =>
                    entry.responseBodies.push(body),
            });
        },
    };
    try {
        [entry.response] = await executeTopicDecisionWave(
            {
                model,
                concurrency: execution.concurrency,
                onReceipt: (receipt) => {
                    entry.receipt = receipt;
                },
            },
            [packet],
            signal,
            reason,
            execution.limiter,
        );
        entry.outcome = "success";
        return {
            ordinal: entry.ordinal,
            answers: Object.fromEntries(
                Object.entries(entry.response.answers)
                    .filter(([, answer]) => answer.type === "choice")
                    .map(([key, answer]) => [key, answer.choice]),
            ),
        };
    } catch (error) {
        entry.outcome = "failed";
        entry.error = String(error);
        if (error instanceof TopicDecisionError) entry.failure = error.failure;
        throw error;
    } finally {
        entry.elapsedMs = Date.now() - entry.started;
        await save();
    }
}

async function preparedPacketPair(
    packet,
    native,
    complete,
    signal,
    hooks,
    repack,
    tokenLimit,
) {
    signal.throwIfAborted();
    let nativeResult;
    const runNative = async () => {
        if (hooks.arm === "control") return;
        try {
            nativeResult = await hooks.native(packet);
        } catch (error) {
            signal.throwIfAborted();
            if (canRepackTopicDecision(error, native, repack)) throw error;
            nativeResult = { answers: {}, error: String(error) };
            console.error(`Prepared native packet failed: ${String(error)}`);
        }
    };
    let control;
    const runControl = async () => {
        if (hooks.arm === "native") return;
        try {
            const response = await complete(
                controlRules,
                packet.request,
                preparedControlSchema(packet.request),
                { kind: "adjudication", phase: "reconciliation", signal },
            );
            control = readPreparedControlAnswers(packet.request, response);
            if (control.errors.length)
                console.error(
                    `Prepared control packet has ${control.errors.length} invalid/missing answers`,
                );
        } catch (error) {
            signal.throwIfAborted();
            control = { answers: {}, errors: [{ reason: String(error) }] };
            console.error(`Prepared control packet failed: ${String(error)}`);
        }
    };
    if (hooks.controlFirst) {
        await runControl();
        await runNative();
    } else {
        await runNative();
        await runControl();
    }
    const pair = { packet, native: nativeResult, control, tokenLimit };
    await hooks.onPair?.(pair);
    return pair;
}

function preparedNativeRecorder(
    native,
    signal,
    deadline,
    calls,
    output,
    concurrency,
) {
    const execution = {
        concurrency: resolveTopicDecisionExecution({ concurrency }).concurrency,
        limiter: createLimiter(concurrency),
    };
    let writing = Promise.resolve();
    const save = () => {
        writing = writing.then(() =>
            atomicWriteJson(path.join(output, "native-calls.json"), calls),
        );
        return writing;
    };
    return (packet, reason) =>
        nativePacket(
            packet,
            native,
            signal,
            deadline,
            calls,
            save,
            execution,
            reason,
        );
}

export async function preparedReviewPackets(
    packets,
    arm,
    complete,
    signal,
    nativeCall,
    concurrency = 1,
) {
    const limiter = createLimiter(concurrency);
    const settled = await Promise.allSettled(
        packets.map((packet) =>
            limiter(async () => {
                signal.throwIfAborted();
                if (arm === "native") return (await nativeCall(packet)).answers;
                const response = await complete(
                    controlRules,
                    packet.request,
                    preparedControlSchema(packet.request),
                    { kind: "adjudication", phase: "reconciliation", signal },
                );
                const parsed = readPreparedControlAnswers(
                    packet.request,
                    response,
                );
                assert.equal(
                    parsed.errors.length,
                    0,
                    "Prepared semantic control review requires every bounded answer",
                );
                return parsed.answers;
            }),
        ),
    );
    const failed = settled.find((entry) => entry.status === "rejected");
    if (failed) throw failed.reason;
    return settled.map((entry) => {
        assert.equal(entry.status, "fulfilled");
        return entry.value;
    });
}

export async function matchedPreparedPackets(
    tasks,
    native,
    complete,
    signal,
    hooks,
) {
    const pairs = [];
    const admissible = [];
    const capacityFailures = [];
    for (const task of tasks) {
        try {
            packTopicDecisions(
                [task],
                native.model,
                24576,
                native.checkRequest,
                "factored-best-fit",
            );
            admissible.push(task);
        } catch (error) {
            if (!(error instanceof TopicDecisionCapacityError)) throw error;
            const failure = {
                candidate: task.candidate.key,
                error: String(error),
            };
            capacityFailures.push(failure);
            console.error(
                `Prepared candidate cannot fit native capacity: ${failure.error}`,
            );
            await hooks.onCapacityFailure?.(failure);
        }
    }
    const repack = { used: false };
    const originals = packTopicDecisions(
        admissible,
        native.model,
        24576,
        native.checkRequest,
        "factored-best-fit",
    );
    if (hooks.arm === "native" && hooks.concurrency > 1) {
        const effective = await withTopicDecisionRepacking(
            native,
            signal,
            repack,
            async (tokenLimit) => {
                const limiter = createLimiter(hooks.concurrency);
                const packets = packTopicDecisions(
                    admissible,
                    native.model,
                    tokenLimit,
                    native.checkRequest,
                    "factored-best-fit",
                );
                const settled = await Promise.allSettled(
                    packets.map((packet) =>
                        limiter(() =>
                            preparedPacketPair(
                                packet,
                                native,
                                complete,
                                signal,
                                hooks,
                                repack,
                                tokenLimit,
                            ),
                        ),
                    ),
                );
                const failed = settled.find(
                    (entry) => entry.status === "rejected",
                );
                if (failed) throw failed.reason;
                return settled.map((entry) => {
                    assert.equal(entry.status, "fulfilled");
                    return entry.value;
                });
            },
        );
        return {
            pairs: effective,
            repacked: repack.used,
            plannedPackets: originals.length,
            capacityFailures,
        };
    }
    for (const original of originals) {
        signal.throwIfAborted();
        const effective = await withTopicDecisionRepacking(
            native,
            signal,
            repack,
            async (tokenLimit) => {
                const attempt = [];
                for (const packet of packTopicDecisions(
                    original.tasks,
                    native.model,
                    tokenLimit,
                    native.checkRequest,
                    "factored-best-fit",
                )) {
                    attempt.push(
                        await preparedPacketPair(
                            packet,
                            native,
                            complete,
                            signal,
                            hooks,
                            repack,
                            tokenLimit,
                        ),
                    );
                }
                return attempt;
            },
        );
        pairs.push(...effective);
    }
    return {
        pairs,
        repacked: repack.used,
        plannedPackets: originals.length,
        capacityFailures,
    };
}

function assignment(curation, id) {
    if (!curation) return "unresolved";
    const concept = curation.concepts.find((entry) =>
        entry.memberIds.includes(id),
    );
    if (concept) return "admit";
    if (curation.deferred.some((entry) => entry.nodeId === id)) return "defer";
    return "unresolved";
}

export function preparedWindowComparison(
    window,
    groups,
    native,
    control,
    nativeCuration,
    controlCuration,
) {
    return groups.map((group, ordinal) => ({
        candidateId: group.task.candidate.node.id,
        members: group.memberIds.length,
        native: native.rows[ordinal],
        control: control.rows[ordinal],
        boundedAgreement:
            native.rows[ordinal].completeExposure &&
            control.rows[ordinal].completeExposure &&
            native.rows[ordinal].choice === control.rows[ordinal].choice,
        rawAssignments: group.memberIds.map((id) => ({
            id,
            g0: assignment(window.curation, id),
            native: assignment(nativeCuration, id),
            control: assignment(controlCuration, id),
        })),
    }));
}

function preparedRefinementSuffix(treatment = "baseline") {
    assert(
        ["baseline", "ownership", "repair", "combined"].includes(treatment),
        "Unknown prepared refinement treatment",
    );
    return treatment === "baseline"
        ? ""
        : `:${preparedTopicRefinementRecipe}:${treatment}`;
}

export async function refinePreparedCanonical(
    snapshot,
    window,
    curation,
    hooks,
) {
    const treatment = hooks.treatment ?? "baseline";
    if (!preparedRefinementSuffix(treatment))
        return { outcome: "complete", curation, events: [] };
    return refinePreparedTopicCuration(snapshot, window, curation, {
        model: hooks.native,
        recoverOwnership: ["ownership", "combined"].includes(treatment),
        repairDefinitions: ["repair", "combined"].includes(treatment),
        review: hooks.review,
        complete: hooks.complete,
        signal: hooks.signal,
        subjectMateriality: hooks.subjectMateriality,
        definitionAdequacy: hooks.definitionAdequacy,
        repairFirst: hooks.repairFirst,
        ...(hooks.adjudicateEvidence
            ? { adjudicateEvidence: hooks.adjudicateEvidence }
            : {}),
        ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
    });
}

async function canonicalArm(
    snapshot,
    window,
    groups,
    selected,
    complete,
    signal,
    file,
    native,
    review,
    adjudicateNegative,
    treatment,
) {
    const fallbacks = [];
    let guarded;
    const generatedReviews = [];
    const reviewArtifact = () =>
        guarded
            ? {
                  usefulness: guarded.usefulness,
                  usefulnessReviews: guarded.usefulnessReviews,
                  certifications: guarded.certifications,
                  effectiveChoices: Object.fromEntries(guarded.choices),
                  generatedReviews,
              }
            : { generatedReviews };
    try {
        guarded = await reviewPreparedTopicChoices(
            snapshot,
            window,
            groups,
            selected.choices,
            { model: native },
            (packets, reason) => review(packets, reason),
            adjudicateNegative,
        );
        const curation = await reconcilePreparedTopicChoices(
            snapshot,
            window,
            guarded.groups,
            guarded.choices,
            complete,
            signal,
            (event) => fallbacks.push(event),
            guarded.usefulRawIds,
            async (priors, generated) => {
                const reconciled = await reconcileGeneratedPreparedTopics(
                    snapshot,
                    window,
                    priors,
                    generated,
                    { model: native },
                    review,
                );
                generatedReviews.push(reconciled.review);
                return reconciled.curation;
            },
        );
        const refined = await refinePreparedCanonical(
            snapshot,
            window,
            curation,
            {
                treatment,
                native,
                review,
                complete,
                signal,
                adjudicateEvidence: adjudicateNegative,
                onProgress: (progress) =>
                    atomicWriteJson(
                        `${file}.refinement-progress.json`,
                        progress,
                    ),
            },
        );
        await atomicWriteJson(file, {
            outcome: refined.outcome,
            curation: refined.curation,
            fallbacks,
            review: reviewArtifact(),
            refinement: refined.events,
        });
        return {
            outcome: refined.outcome,
            curation: refined.curation,
            fallbacks,
        };
    } catch (error) {
        const failure = {
            outcome: "failed",
            error: String(error),
            fallbacks,
            review: reviewArtifact(),
        };
        await atomicWriteJson(file, failure);
        console.error(
            `Prepared canonical installation failed: ${String(error)}`,
        );
        return failure;
    }
}

export async function constructPreparedTopics(
    snapshot,
    complete,
    native,
    signal,
    hooks,
) {
    const refinement = preparedRefinementSuffix(hooks.treatment);
    assert(
        ["native", "control"].includes(hooks.arm),
        "Choose one construction arm",
    );
    const windows = [];
    const curation = await curateTopics(
        snapshot,
        (node) => node.citations,
        complete,
        signal,
        true,
        hooks.onCommit,
        undefined,
        {
            preparedReconciliation: {
                recipe: `${preparedTopicDecisionRecipe}:${hooks.arm}${refinement}`,
                reconcile: async (window) => {
                    const started = Date.now();
                    const groups = prepareTopicDecisionGroups(snapshot, window);
                    const tasks = groups.map((group) => group.task);
                    const matched = await matchedPreparedPackets(
                        tasks,
                        native,
                        complete,
                        signal,
                        hooks,
                    );
                    const selected = preparedChoices(
                        tasks,
                        matched.pairs,
                        hooks.arm,
                    );
                    const guarded = hooks.review
                        ? await reviewPreparedTopicChoices(
                              snapshot,
                              window,
                              groups,
                              selected.choices,
                              { model: native },
                              hooks.review,
                              hooks.adjudicateNegative,
                          )
                        : undefined;
                    const fallbacks = [];
                    const generatedReviews = [];
                    const result = await reconcilePreparedTopicChoices(
                        snapshot,
                        window,
                        guarded?.groups ?? groups,
                        guarded?.choices ?? selected.choices,
                        complete,
                        signal,
                        (event) => fallbacks.push(event),
                        guarded?.usefulRawIds,
                        async (priors, generated) => {
                            assert(
                                hooks.review,
                                "Raw-only generation requires bounded equivalence review",
                            );
                            const reconciled =
                                await reconcileGeneratedPreparedTopics(
                                    snapshot,
                                    window,
                                    priors,
                                    generated,
                                    { model: native },
                                    hooks.review,
                                );
                            generatedReviews.push(reconciled.review);
                            return reconciled.curation;
                        },
                    );
                    const refined = await refinePreparedCanonical(
                        snapshot,
                        window,
                        result,
                        {
                            treatment: hooks.treatment,
                            native,
                            complete,
                            signal,
                            review: hooks.review,
                            adjudicateEvidence: hooks.adjudicateNegative,
                            onProgress: hooks.onRefinementProgress,
                        },
                    );
                    const entry = {
                        ordinal: windows.length,
                        window,
                        groups,
                        matched,
                        selected: selected.rows,
                        outcome: refined.outcome,
                        curation: refined.curation,
                        refinement: refined.events,
                        fallbacks,
                        ...(guarded
                            ? {
                                  review: {
                                      usefulness: guarded.usefulness,
                                      usefulnessReviews:
                                          guarded.usefulnessReviews,
                                      certifications: guarded.certifications,
                                      effectiveChoices: Object.fromEntries(
                                          guarded.choices,
                                      ),
                                      generatedReviews,
                                  },
                              }
                            : {}),
                        elapsedMs: Date.now() - started,
                    };
                    windows.push(entry);
                    await hooks.onWindow?.(entry);
                    assert.equal(
                        refined.outcome,
                        "complete",
                        "Prepared refinement remains pending; construction window was not committed",
                    );
                    return refined.curation;
                },
            },
        },
    );
    return { curation, windows };
}

export function preparedConstructionSnapshot(snapshot, nodeCount) {
    const selected = structuredClone(snapshot);
    delete selected.curation;
    delete selected.curationProgress;
    delete selected.curationPackets;
    delete selected.curationInputFingerprint;
    delete selected.curationSuppressionFingerprint;
    selected.parents = [];
    selected.related = [];
    if (nodeCount !== undefined) {
        selected.nodes = orderedTopicNodes(selected.nodes).slice(
            0,
            positiveInteger(nodeCount, undefined, "nodes"),
        );
        const represented = new Set(
            selected.nodes.flatMap((node) => node.occurrenceIds),
        );
        selected.occurrences = selected.occurrences.filter((occurrence) =>
            represented.has(occurrence.id),
        );
        selected.limits.push(
            `Diagnostic prefix: ${selected.nodes.length} of ${snapshot.nodes.length} raw nodes`,
        );
    }
    validateTopicSnapshot(selected);
    return selected;
}

async function runPreparedConstruction(
    values,
    snapshot,
    native,
    complete,
    deadline,
    output,
    nativeCalls,
) {
    const arm = values.mode === "native-curation" ? "native" : "control";
    const selected = preparedConstructionSnapshot(snapshot, values.nodes);
    await atomicWriteJson(
        path.join(output, "construction-input.json"),
        selected,
    );
    const started = Date.now();
    const concurrency = positiveInteger(
        values["native-concurrency"],
        1,
        "native-concurrency",
    );
    const nativeCall = preparedNativeRecorder(
        native,
        deadline.controller.signal,
        deadline,
        nativeCalls,
        output,
        concurrency,
    );
    const result = await constructPreparedTopics(
        selected,
        complete,
        native,
        deadline.controller.signal,
        {
            arm,
            treatment: values.treatment,
            concurrency,
            native: nativeCall,
            review: (packets, reason) =>
                preparedReviewPackets(
                    packets,
                    arm,
                    complete,
                    deadline.controller.signal,
                    (packet) => nativeCall(packet, reason),
                    concurrency,
                ),
            ...(arm === "native"
                ? {
                      adjudicateNegative: (packets) =>
                          preparedReviewPackets(
                              packets,
                              "control",
                              complete,
                              deadline.controller.signal,
                              nativeCall,
                              1,
                          ),
                  }
                : {}),
            onCommit: (curation) =>
                atomicWriteJson(
                    path.join(output, "curation-progress.json"),
                    curation,
                ),
            onRefinementProgress: (curation) =>
                atomicWriteJson(
                    path.join(output, "refinement-progress.json"),
                    curation,
                ),
            onWindow: async (entry) => {
                await atomicWriteJson(
                    path.join(
                        output,
                        `construction-window-${entry.ordinal}.json`,
                    ),
                    entry,
                );
                console.error(
                    `Prepared ${arm} construction ${entry.outcome} window ${entry.ordinal}`,
                );
            },
        },
    );
    selected.recipe += `:${preparedTopicDecisionRecipe}:${arm}${preparedRefinementSuffix(values.treatment)}`;
    selected.curation = result.curation;
    validateTopicSnapshot(selected);
    await atomicWriteJson(
        path.join(output, "constructed-snapshot.json"),
        selected,
    );
    const accounted =
        result.curation.concepts.reduce(
            (sum, concept) => sum + concept.memberIds.length,
            0,
        ) + result.curation.deferred.length;
    assert.equal(
        accounted,
        selected.nodes.length,
        "Construction lost original raw membership",
    );
    return {
        outcome: "curation-complete",
        arm,
        raws: selected.nodes.length,
        windows: result.windows.length,
        concepts: result.curation.concepts.length,
        deferred: result.curation.deferred.length,
        fallbacks: result.windows.flatMap((window) => window.fallbacks).length,
        uncertainGroups: result.windows
            .flatMap((window) => window.selected)
            .filter((row) => row.choice === "uncertain_needs_synthesis").length,
        incompleteGroups: result.windows
            .flatMap((window) => window.selected)
            .filter((row) => !row.completeExposure).length,
        elapsedMs: Date.now() - started,
        organization: "not-run",
        readinessQualified: false,
        fullHistory: values.nodes === undefined,
    };
}

export function preparedDiagnosticSummary(windows, count, results, calls) {
    const parts = windows.slice(0, count).flatMap((window) => window.prepared);
    const expectedGroups = parts.reduce(
        (sum, part) => sum + part.concepts.length + part.deferred.length,
        0,
    );
    const expectedRaws = parts.reduce(
        (sum, part) =>
            sum +
            part.concepts.reduce(
                (members, concept) => members + concept.memberIds.length,
                0,
            ) +
            part.deferred.length,
        0,
    );
    const rows = results.flatMap((result) => result.comparison ?? []);
    const reportedRaws = rows.reduce((sum, row) => sum + row.members, 0);
    assert(
        rows.length <= expectedGroups && reportedRaws <= expectedRaws,
        "Diagnostic accounting exceeds the captured input",
    );
    return {
        outcome:
            results.length === count &&
            results.every((result) => result.outcome === "complete")
                ? "diagnostic-complete"
                : "partial-or-failed",
        expectedGroups,
        expectedRaws,
        reportedGroups: rows.length,
        reportedRaws,
        unobservedGroups: expectedGroups - rows.length,
        unobservedRaws: expectedRaws - reportedRaws,
        boundedAgreements: rows.filter((row) => row.boundedAgreement).length,
        calls: Object.fromEntries(
            Object.entries(calls).map(([arm, entries]) => [
                arm,
                entries.length,
            ]),
        ),
        nativeFailures: calls.native.filter((call) => call.outcome === "failed")
            .length,
        limitations: [
            "G0 and bounded generative control are not independent semantic ground truth.",
            "Fixed captured priors make this a role diagnostic, not full evolving construction or readiness timing.",
            "Prepared grouping and lexical nomination may lose distinctions or omit acceptable targets.",
            "All repair, failed and local fallback calls remain in accounting.",
        ],
    };
}

export async function runPreparedDecisionDiagnostic(values) {
    assert.equal(
        values.live,
        true,
        "Explicit --live authorization is required",
    );
    assert(values.deadline, "An absolute authorized --deadline is required");
    const refinement = preparedRefinementSuffix(values.treatment);
    assert(
        ["matched", "native-curation", "control-curation"].includes(
            values.mode ?? "matched",
        ),
        "Unknown prepared Decision mode",
    );
    assert(
        (values.mode !== undefined && values.mode !== "matched") ||
            values.nodes === undefined,
        "--nodes is only supported for construction",
    );
    const deadline = topicReplayDeadline({ ...values, "timeout-ms": 28800000 });
    const output = await createReplayOutput(
        values.output,
        path.dirname(path.resolve(values.snapshot)),
    );
    const timer = setTimeout(
        () =>
            deadline.controller.abort(
                new Error("Prepared Decision authorization expired"),
            ),
        deadline.remaining(),
    );
    const signal = deadline.controller.signal;
    const results = [];
    const nativeCalls = [];
    const controlCalls = [];
    const nativeFallbackCalls = [];
    const controlFallbackCalls = [];
    let identity;
    let outcome = "failed-or-interrupted";
    try {
        const snapshotText = await readFile(values.snapshot, "utf8");
        const windowText = await readFile(values.prepared, "utf8");
        const snapshot = JSON.parse(snapshotText);
        validateTopicSnapshot(snapshot);
        const windows = JSON.parse(windowText);
        assert(
            Array.isArray(windows) && windows.length,
            "No captured prepared windows",
        );
        const count = Math.min(
            windows.length,
            positiveInteger(values.windows, windows.length, "windows"),
        );
        const model = await initializeReplayModel(values);
        const native = configuredTopicDecisionModel();
        const nativeConcurrency = positiveInteger(
            values["native-concurrency"],
            1,
            "native-concurrency",
        );
        resolveTopicDecisionExecution({ concurrency: nativeConcurrency });
        const nativeCall = preparedNativeRecorder(
            native,
            signal,
            deadline,
            nativeCalls,
            output,
            nativeConcurrency,
        );
        const implementation = {
            generative: await implementationIdentity(),
            native: await decisionReplayImplementation(),
        };
        identity = {
            recipe: `${preparedTopicDecisionRecipe}${refinement}`,
            treatment: values.treatment ?? "baseline",
            snapshotHash: hashBytes(snapshotText),
            preparedHash: hashBytes(windowText),
            sourceRecipe: snapshot.recipe,
            implementation,
            control: inspectTopicReplayModelBinding(model, values.endpoint),
            native: {
                provider: native.provider,
                model: native.model,
                configGeneration: native.configGeneration,
            },
            deadline: new Date(deadline.deadline).toISOString(),
            maximumLogicalCalls: null,
            plannedWindows: values.mode?.endsWith("-curation") ? null : count,
            retainedReferenceWindows: count,
            candidateUnit: "frozen-prepared-reference-group",
            mode: values.mode ?? "matched",
            order: values["control-first"]
                ? "alternate-window-order-inverted"
                : "alternate-window-order",
            packetPolicy: "factored-best-fit",
            nativeConcurrency,
            semanticReview:
                "independent-raw-usefulness-negative-adjudication-and-joint-fixed-root-components-v2",
            tokenLimits: { primary: 24576, oneTimeRepair: 16384 },
            transport: {
                generativeTimeoutOverrideMs:
                    process.env.AZURE_OPENAI_MAX_TIMEOUT ?? null,
                retryPolicy: "configured-provider-policy",
                providerAttemptBreakdown: "unavailable",
            },
            productionDefaultsChanged: false,
            comparison:
                "Identical external state, instructions, criteria and effective partitions; provider-internal prompting differs",
        };
        await atomicWriteJson(path.join(output, "identity.json"), identity);
        const bound = bindTopicCompletion(
            createTopicCompletion(values.endpoint, model),
            signal,
        );
        const base = Object.assign(
            (...args) => {
                deadline.check();
                return bound(...args);
            },
            { inspectRequest: bound.inspectRequest },
        );
        const recorded = (file, calls) =>
            recordDiagnosticCompletion(
                base,
                path.join(output, file),
                calls,
                deadline.check,
            );
        const control = recorded("control-calls.json", controlCalls);
        const nativeFallback = recorded(
            "native-fallback-calls.json",
            nativeFallbackCalls,
        );
        const controlFallback = recorded(
            "control-fallback-calls.json",
            controlFallbackCalls,
        );
        if (
            values.mode === "native-curation" ||
            values.mode === "control-curation"
        ) {
            const constructionCalls = [];
            const summary = await runPreparedConstruction(
                values,
                snapshot,
                native,
                recorded(
                    "construction-generative-calls.json",
                    constructionCalls,
                ),
                deadline,
                output,
                nativeCalls,
            );
            summary.calls = {
                native: nativeCalls.length,
                generative: constructionCalls.length,
            };
            summary.nativeFailures = nativeCalls.filter(
                (call) => call.outcome === "failed",
            ).length;
            assert.deepEqual(
                {
                    generative: await implementationIdentity(),
                    native: await decisionReplayImplementation(),
                },
                implementation,
                "Implementation changed during construction",
            );
            await atomicWriteJson(path.join(output, "summary.json"), summary);
            outcome = summary.outcome;
            return summary;
        }
        for (let ordinal = 0; ordinal < count; ordinal++) {
            if (signal.aborted || deadline.remaining() === 0) {
                deadline.controller.abort(
                    new Error("Prepared Decision authorization expired"),
                );
                console.error(
                    "Prepared Decision deadline reached; remaining windows stay unresolved",
                );
                break;
            }
            const started = Date.now();
            const window = windows[ordinal];
            const directory = await createReplayOutput(
                path.join(output, `window-${ordinal}`),
            );
            const groups = prepareTopicDecisionGroups(snapshot, window);
            const tasks = groups.map((group) => group.task);
            await atomicWriteJson(path.join(directory, "groups.json"), groups);
            try {
                const allPairs = [];
                const matched = await matchedPreparedPackets(
                    tasks,
                    native,
                    control,
                    signal,
                    {
                        controlFirst:
                            Boolean(ordinal % 2) !==
                            Boolean(values["control-first"]),
                        native: (packet) => nativeCall(packet),
                        onPair: async (pair) => {
                            allPairs.push(pair);
                            await atomicWriteJson(
                                path.join(directory, "attempted-pairs.json"),
                                allPairs,
                            );
                        },
                    },
                );
                await atomicWriteJson(
                    path.join(directory, "effective-pairs.json"),
                    matched.pairs,
                );
                const selectedNative = preparedChoices(
                    tasks,
                    matched.pairs,
                    "native",
                );
                const selectedControl = preparedChoices(
                    tasks,
                    matched.pairs,
                    "control",
                );
                const nativeResult = await canonicalArm(
                    snapshot,
                    window,
                    groups,
                    selectedNative,
                    nativeFallback,
                    signal,
                    path.join(directory, "native-canonical.json"),
                    native,
                    (packets, reason) =>
                        preparedReviewPackets(
                            packets,
                            "native",
                            nativeFallback,
                            signal,
                            (packet) => nativeCall(packet, reason),
                            nativeConcurrency,
                        ),
                    (packets) =>
                        preparedReviewPackets(
                            packets,
                            "control",
                            nativeFallback,
                            signal,
                            nativeCall,
                            1,
                        ),
                    values.treatment,
                );
                const controlResult = await canonicalArm(
                    snapshot,
                    window,
                    groups,
                    selectedControl,
                    controlFallback,
                    signal,
                    path.join(directory, "control-canonical.json"),
                    native,
                    (packets) =>
                        preparedReviewPackets(
                            packets,
                            "control",
                            controlFallback,
                            signal,
                            nativeCall,
                            1,
                        ),
                    undefined,
                    values.treatment,
                );
                const comparison = preparedWindowComparison(
                    window,
                    groups,
                    selectedNative,
                    selectedControl,
                    nativeResult.curation,
                    controlResult.curation,
                );
                results.push({
                    ordinal,
                    outcome:
                        nativeResult.outcome === "complete" &&
                        controlResult.outcome === "complete" &&
                        selectedNative.rows.every(
                            (row) => row.completeExposure,
                        ) &&
                        selectedControl.rows.every(
                            (row) => row.completeExposure,
                        )
                            ? "complete"
                            : "partial-or-failed",
                    groups: groups.length,
                    raws: groups.reduce(
                        (sum, group) => sum + group.memberIds.length,
                        0,
                    ),
                    effectivePackets: matched.pairs.length,
                    repacked: matched.repacked,
                    capacityFailures: matched.capacityFailures,
                    nativeCanonical: nativeResult.outcome,
                    controlCanonical: controlResult.outcome,
                    nativeFallbacks: nativeResult.fallbacks,
                    controlFallbacks: controlResult.fallbacks,
                    elapsedMs: Date.now() - started,
                    comparison,
                });
                assert(
                    values.snapshot && values.prepared,
                    "Captured snapshot and prepared windows are required",
                );
            } catch (error) {
                results.push({
                    ordinal,
                    outcome: "failed",
                    expectedGroups: groups.length,
                    expectedRaws: groups.reduce(
                        (sum, group) => sum + group.memberIds.length,
                        0,
                    ),
                    error: String(error),
                    elapsedMs: Date.now() - started,
                });
                console.error(
                    `Prepared window ${ordinal} failed: ${String(error)}`,
                );
            }
            await atomicWriteJson(path.join(output, "results.json"), results);
            console.error(
                `Prepared window ${ordinal}: ${results.at(-1).outcome}`,
            );
            if (signal.aborted) break;
        }
        assert.deepEqual(
            inspectTopicReplayModelBinding(model, values.endpoint),
            identity.control,
        );
        assert.deepEqual(
            {
                generative: await implementationIdentity(),
                native: await decisionReplayImplementation(),
            },
            implementation,
            "Implementation changed during live qualification",
        );
        const summary = preparedDiagnosticSummary(windows, count, results, {
            native: nativeCalls,
            control: controlCalls,
            nativeFallback: nativeFallbackCalls,
            controlFallback: controlFallbackCalls,
        });
        await atomicWriteJson(path.join(output, "summary.json"), summary);
        outcome = summary.outcome;
        return summary;
    } finally {
        clearTimeout(timer);
        await atomicWriteJson(path.join(output, "final-state.json"), {
            identityHash: identity ? hashValue(identity) : null,
            finished: new Date().toISOString(),
            aborted: signal.aborted,
            mode: values.mode ?? "matched",
            outcome,
            completedMatchedWindows: results.length,
        });
    }
}

export function preparedDiagnosticArguments(args) {
    return parseArgs({
        args,
        allowPositionals: false,
        strict: true,
        options: Object.fromEntries(
            [
                "snapshot",
                "prepared",
                "output",
                "endpoint",
                "deadline",
                "windows",
                "mode",
                "nodes",
                "native-concurrency",
                "treatment",
            ]
                .map((name) => [name, { type: "string" }])
                .concat([
                    ["live", { type: "boolean" }],
                    ["control-first", { type: "boolean" }],
                ]),
        ),
    }).values;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    runPreparedDecisionDiagnostic(
        preparedDiagnosticArguments(process.argv.slice(2)),
    )
        .then((summary) => {
            console.error(JSON.stringify(summary));
            if (
                !["diagnostic-complete", "curation-complete"].includes(
                    summary.outcome,
                )
            )
                process.exitCode = 1;
        })
        .catch((error) => {
            console.error(String(error));
            process.exitCode = 1;
        });
