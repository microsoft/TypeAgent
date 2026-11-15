// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    configuredTopicDecisionModel,
    groundTopicCandidate,
    groundTopicConcept,
    packTopicDecisions,
    executeTopicDecision,
    indexTopicDecisionEvidence,
    assertTopicDecisionGeneration,
} from "../../packages/memory/service/dist/topicDecision.js";
import {
    createTopicSnapshot,
    createTopicCompletion,
    bindTopicCompletion,
} from "../../packages/memory/service/dist/topicGeneration.js";
import {
    curateTopics,
    validateTopicCurationProgress,
} from "../../packages/memory/service/dist/topicCuration.js";
import { TopicEvidenceIndex } from "../../packages/memory/service/dist/topicLookup.js";
import {
    resolveTopicCurationSettings,
    topicCurationPolicy,
} from "../../packages/memory/service/dist/topicCurationSettings.js";
import {
    atomicWriteJson,
    createReplayOutput,
    hashValue,
    loadCapturedTopicInput,
    positiveInteger,
} from "./replay-artifacts.mjs";
import {
    implementationIdentity,
    initializeReplayModel,
    inspectTopicReplayModelBinding,
    topicReplayDeadline,
} from "./topic-curation-replay.mjs";
import { decisionReplayImplementation } from "./topic-decision-replay.mjs";

class WindowLimit extends Error {}

function preparedMembers(window) {
    return new Set(
        window.prepared.flatMap((part) => [
            ...part.concepts.flatMap((concept) => concept.memberIds),
            ...part.deferred.map((entry) => entry.nodeId),
        ]),
    );
}

export function reconciliationTasks(snapshot, window) {
    const contexts = indexTopicDecisionEvidence(snapshot);
    const index = new TopicEvidenceIndex(snapshot);
    const fresh = preparedMembers(window);
    const targets = [
        ...window.current.concepts,
        ...window.prepared.flatMap((part) => part.concepts),
    ].map((concept, ordinal) =>
        groundTopicConcept(snapshot, concept, `t${ordinal}`, contexts, index),
    );
    const candidates = snapshot.nodes.filter((node) => fresh.has(node.id));
    assert.equal(
        candidates.length,
        fresh.size,
        "Prepared window lost raw members",
    );
    assert(
        !window.current.concepts.some((concept) =>
            concept.memberIds.some((id) => fresh.has(id)),
        ),
        "Prepared input overlaps committed membership",
    );
    return candidates.map((node, ordinal) => ({
        candidate: groundTopicCandidate(
            snapshot,
            node,
            node.citations,
            `n${ordinal}`,
            contexts,
        ),
        targets,
        score: false,
        reason: "prepared-window-diagnostic",
        nomination: {
            availableConcepts: targets.length,
            nominatedConcepts: targets.length,
        },
    }));
}

export function reconciliationComparison(window, curation, receipts) {
    const fresh = preparedMembers(window);
    const deferred = new Set(curation.deferred.map((entry) => entry.nodeId));
    const admitted = new Set(
        curation.concepts.flatMap((concept) => concept.memberIds),
    );
    const rows = new Map();
    const expectedTargets = new Set([
        ...window.current.concepts.map((concept) => concept.id),
        ...window.prepared.flatMap((part) =>
            part.concepts.map((concept) => concept.id),
        ),
    ]);
    const exposure = new Map();
    for (const receipt of receipts) {
        if (receipt.outcome === "failed") continue;
        for (const target of receipt.targetExposure ?? []) {
            const state = exposure.get(target.nodeId) ?? {
                targets: new Set(),
                grounded: true,
            };
            for (const id of target.evaluatedTargetIds) state.targets.add(id);
            if (
                target.candidateGrounding !== "complete" ||
                target.unavailableTargetIds.length
            )
                state.grounded = false;
            exposure.set(target.nodeId, state);
        }
        for (const [key, detail] of Object.entries(
            receipt.answerDetails ?? {},
        )) {
            if (!key.startsWith("disposition_") || detail.type !== "choice")
                continue;
            const candidateKey = key.slice("disposition_".length);
            const id = receipt.candidateIds[candidateKey];
            assert(fresh.has(id), "Decision returned an unknown raw member");
            const values = rows.get(id) ?? [];
            values.push(detail);
            rows.set(id, values);
        }
    }
    return [...fresh].map((id) => {
        assert(admitted.has(id) !== deferred.has(id), "Invalid G0 accounting");
        const answers = rows.get(id) ?? [];
        const choices = [...new Set(answers.map((answer) => answer.choice))];
        const observed = exposure.get(id);
        const complete =
            observed?.grounded === true &&
            [...expectedTargets].every((target) =>
                observed.targets.has(target),
            );
        const outcome =
            choices.length !== 1 || !complete
                ? "uncertain-partitions"
                : choices[0].startsWith("defer_")
                  ? "defer"
                  : choices[0] === "uncertain_needs_synthesis"
                    ? "uncertain"
                    : "admit";
        const reference = admitted.has(id) ? "admit" : "defer";
        return {
            nodeId: id,
            reference,
            outcome,
            agreement: reference === outcome,
            expectedTargets: expectedTargets.size,
            evaluatedTargets: observed?.targets.size ?? 0,
            completeExposure: complete,
            answers,
        };
    });
}

export async function nativeWindow(
    snapshot,
    window,
    model,
    signal,
    output,
    reserveCall = () => {},
) {
    const receipts = [];
    const failures = [];
    let interruption;
    if (signal.aborted)
        return { receipts, failures, interruption: String(signal.reason) };
    const tasks = reconciliationTasks(snapshot, window);
    const packets = packTopicDecisions(
        tasks,
        model.model,
        24576,
        model.checkRequest,
    );
    for (const [ordinal, packet] of packets.entries()) {
        if (signal.aborted) {
            interruption = String(signal.reason);
            break;
        }
        assertTopicDecisionGeneration(model);
        await atomicWriteJson(
            path.join(output, `native-request-${ordinal}.json`),
            packet,
        );
        let attempted = false;
        try {
            reserveCall();
            attempted = true;
            await executeTopicDecision(
                { model, onReceipt: (receipt) => receipts.push(receipt) },
                packet,
                signal,
                "prepared-window-diagnostic",
            );
        } catch (error) {
            failures.push({
                ordinal,
                attempted,
                error: String(error),
                ...(error.failure ? { failure: error.failure } : {}),
            });
            console.error(`Native packet ${ordinal} failed: ${String(error)}`);
        } finally {
            await atomicWriteJson(
                path.join(output, "native-receipts.json"),
                receipts,
            );
            await atomicWriteJson(
                path.join(output, "native-failures.json"),
                failures,
            );
        }
        if (signal.aborted) {
            interruption = String(signal.reason);
            break;
        }
        assertTopicDecisionGeneration(model);
    }
    return { receipts, failures, interruption };
}

export function diagnosticSummary(windows, results, failure, budget) {
    const rows = results.flatMap((result) => result.rows ?? []);
    const expectedCandidates = windows.reduce(
        (sum, window) => sum + preparedMembers(window).size,
        0,
    );
    return {
        status:
            failure ||
            rows.length !== expectedCandidates ||
            results.length !== windows.length ||
            results.some((result) => result.outcome !== "complete")
                ? "partial-or-failed"
                : "diagnostic-complete",
        windows: windows.length,
        ...budget,
        expectedCandidates,
        candidates: rows.length,
        answeredCandidates: rows.filter((row) => row.answers.length).length,
        unobservedCandidates: expectedCandidates - rows.length,
        dispositionAgreements: rows.filter((row) => row.agreement).length,
        fullHistoryGate: "blocked-pending-independent-semantic-labels",
        limitations: [
            "Raw-level native decisions inspect all prepared definitions and priors; generative nomination and grouping are not identical formulations.",
            "Partition conflicts remain uncertain; this diagnostic does not install a canonical native output or generate new metadata.",
            "Agreement with G0 is not accuracy, and diagnostic timings do not establish full-construction speedup.",
        ],
    };
}

export function recordDiagnosticCompletion(
    base,
    file,
    calls,
    reserveCall = () => {},
) {
    let writing = Promise.resolve();
    const flush = () => {
        const document = structuredClone(calls);
        writing = writing.then(() => atomicWriteJson(file, document));
        return writing;
    };
    return Object.assign(
        async (rules, payload, schema, call) => {
            reserveCall();
            const entry = {
                ordinal: calls.length,
                phase: call?.phase,
                kind: call?.kind,
                request: structuredClone({ rules, payload, schema }),
                outcome: "started",
                started: Date.now(),
            };
            calls.push(entry);
            await flush();
            const started = performance.now();
            try {
                entry.response = await base(rules, payload, schema, call);
                entry.outcome = "success";
                return entry.response;
            } catch (error) {
                entry.outcome = "failed";
                entry.error = String(error);
                throw error;
            } finally {
                entry.providerDurationMs = performance.now() - started;
                entry.durationMs = Date.now() - entry.started;
                await flush();
            }
        },
        { inspectRequest: base.inspectRequest },
    );
}

export async function captureWindows(
    snapshot,
    complete,
    signal,
    output,
    limit,
) {
    const windows = [];
    let pending;
    let failure;
    try {
        await curateTopics(
            snapshot,
            (node) => node.citations,
            complete,
            signal,
            true,
            async (curation) => {
                assert(pending, "Missing prepared window");
                validateTopicCurationProgress({
                    ...snapshot,
                    curationProgress: curation,
                });
                const entry = {
                    ...pending,
                    curation: structuredClone(curation),
                };
                windows.push(entry);
                await atomicWriteJson(
                    path.join(output, "windows.json"),
                    windows,
                );
                console.error(`Captured generative window ${windows.length}`);
                pending = undefined;
                if (windows.length >= limit) throw new WindowLimit();
            },
            undefined,
            {
                onPreparedWindow: async (window) => {
                    pending = structuredClone(window);
                    await atomicWriteJson(
                        path.join(output, "prepared.json"),
                        pending,
                    );
                },
            },
        );
    } catch (error) {
        if (!(error instanceof WindowLimit)) {
            failure = String(error);
            await atomicWriteJson(path.join(output, "capture-failure.json"), {
                error: failure,
                completedWindows: windows.length,
            });
            console.error(`Generative window capture failed: ${failure}`);
        }
    }
    return { windows, failure };
}

export async function runReconciliationDiagnostic(values) {
    assert.equal(
        values.live,
        true,
        "Explicit --live authorization is required",
    );
    const windowLimit = positiveInteger(values.windows, 5, "windows");
    const maxCalls = positiveInteger(values["max-calls"], 60, "max-calls");
    const deadline = topicReplayDeadline(values);
    const output = await createReplayOutput(
        values.output,
        values.history
            ? path.dirname(path.dirname(path.resolve(values.history)))
            : undefined,
    );
    const controller = deadline.controller;
    const timer = setTimeout(
        () => controller.abort(new Error("Diagnostic deadline exceeded")),
        deadline.remaining(),
    );
    const { signal } = controller;
    const calls = [];
    const results = [];
    let logicalCalls = 0;
    const reserveCall = () => {
        deadline.check();
        if (logicalCalls >= maxCalls)
            controller.abort(
                new Error("Diagnostic logical-call budget exhausted"),
            );
        signal.throwIfAborted();
        logicalCalls++;
    };
    let binding;
    try {
        const { input, inputHash } = await loadCapturedTopicInput(values);
        const model = await initializeReplayModel(values);
        signal.throwIfAborted();
        binding = inspectTopicReplayModelBinding(model, values.endpoint);
        const native = configuredTopicDecisionModel();
        const settings = resolveTopicCurationSettings();
        const snapshot = createTopicSnapshot(input, topicCurationPolicy(true));
        delete snapshot.curation;
        delete snapshot.curationProgress;
        const implementation = {
            ...(await implementationIdentity()),
            nativeCompiled: await decisionReplayImplementation(),
        };
        const identity = {
            inputHash,
            incidenceHash: hashValue(input.topicInput.occurrences),
            policy: topicCurationPolicy(true),
            settings,
            implementation,
            generative: binding,
            native: {
                provider: native.provider,
                model: native.model,
                configGeneration: native.configGeneration,
            },
            transport: {
                generativeTimeoutOverrideMs:
                    process.env.AZURE_OPENAI_MAX_TIMEOUT ?? null,
                retryAttempts: "configured-provider-policy",
            },
            budget: { windows: windowLimit, maxCalls },
            deadline: new Date(deadline.deadline).toISOString(),
            diagnosticOnly: true,
        };
        await atomicWriteJson(path.join(output, "identity.json"), identity);
        await atomicWriteJson(path.join(output, "snapshot.json"), snapshot);
        const base = bindTopicCompletion(
            createTopicCompletion(values.endpoint, model),
            signal,
        );
        const complete = recordDiagnosticCompletion(
            base,
            path.join(output, "generative-calls.json"),
            calls,
            reserveCall,
        );
        const { windows, failure } = await captureWindows(
            snapshot,
            complete,
            signal,
            output,
            windowLimit,
        );
        for (const [ordinal, window] of windows.entries()) {
            const directory = path.join(output, `window-${ordinal}`);
            await createReplayOutput(directory);
            try {
                const started = Date.now();
                const { receipts, failures, interruption } = await nativeWindow(
                    snapshot,
                    window,
                    native,
                    signal,
                    directory,
                    reserveCall,
                );
                const rows = reconciliationComparison(
                    window,
                    window.curation,
                    receipts,
                );
                const result = {
                    ordinal,
                    outcome: interruption
                        ? "interrupted"
                        : failures.length
                          ? "partial-or-failed"
                          : "complete",
                    elapsedMs: Date.now() - started,
                    failures,
                    ...(interruption ? { interruption } : {}),
                    expectedCandidates: preparedMembers(window).size,
                    rows,
                };
                results.push(result);
                await atomicWriteJson(
                    path.join(directory, "comparison.json"),
                    result,
                );
            } catch (error) {
                console.error(
                    `Native window ${ordinal} failed: ${String(error)}`,
                );
                results.push({
                    ordinal,
                    outcome: "failed",
                    error: String(error),
                    expectedCandidates: preparedMembers(window).size,
                });
                await atomicWriteJson(
                    path.join(directory, "failure.json"),
                    results.at(-1),
                );
            }
            await atomicWriteJson(path.join(output, "results.json"), results);
            console.error(
                `Native window ${ordinal}: ${results.at(-1).outcome}`,
            );
        }
        assert.deepEqual(
            inspectTopicReplayModelBinding(model, values.endpoint),
            binding,
        );
        assert.deepEqual(
            {
                ...(await implementationIdentity()),
                nativeCompiled: await decisionReplayImplementation(),
            },
            implementation,
        );
        const summary = diagnosticSummary(windows, results, failure, {
            requestedWindows: windowLimit,
            logicalCalls,
            maxCalls,
        });
        await atomicWriteJson(path.join(output, "summary.json"), summary);
        return summary;
    } catch (error) {
        await atomicWriteJson(path.join(output, "failure.json"), {
            error: String(error),
            calls: calls.length,
            logicalCalls,
            maxCalls,
            results,
        });
        throw error;
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: {
            live: { type: "boolean" },
            input: { type: "string" },
            history: { type: "string" },
            commit: { type: "string" },
            job: { type: "string" },
            endpoint: { type: "string" },
            output: { type: "string" },
            windows: { type: "string" },
            "max-calls": { type: "string" },
            deadline: { type: "string" },
            "timeout-ms": { type: "string" },
        },
    });
    const summary = await runReconciliationDiagnostic(values);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status !== "diagnostic-complete") process.exitCode = 1;
}
