// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    checkpointExpectationHash,
    assertCheckpoint,
    snapshotCompiledCheckpoint,
    writeJson,
} from "../../packages/benchmarks/src/memoryBench/shared/checkpoint.mjs";
export {
    checkpointExpectationHash,
    assertCheckpoint,
    snapshotCompiledCheckpoint,
    writeJson,
};

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, realpath, rename } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createOfflineOptions } from "./offline-models.mjs";
import {
    installP6Options,
    installCanonicalCrash,
    verifyConsolidation,
    verifyTailArticle,
    installOfflineTrace,
    installStoreTrace,
} from "./p6-preflight.mjs";
import { assertExactCounts, measureProgress } from "./evaluate.mjs";
import { classifyRequestError } from "./transport.mjs";
import {
    createPerformanceTrace,
    installProductPerformance,
} from "./performance-trace.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const families = ["wiki", "projects", "topics"];

export function initialReadiness(snapshot, jobs, sources, topic) {
    const errors = [
        snapshot.wikiFamily?.error,
        snapshot.projectFamily?.error,
        topic.family.error,
    ].filter(Boolean);
    const pending = !!(
        jobs.some((job) => job.state === "running") ||
        snapshot.wikiFamily?.pending ||
        snapshot.projectFamily?.pending ||
        topic.family.dirty ||
        sources.some(
            (source) =>
                source.revisions.find(
                    (revision) =>
                        revision.revisionId === source.activeRevisionId,
                )?.synopsis?.status === "pending",
        )
    );
    const enabled =
        snapshot.wikiFamily?.enabled &&
        snapshot.projectFamily?.enabled &&
        topic.family.enabled;
    return {
        ready: !!enabled && !pending && !errors.length,
        pending,
        enabled: !!enabled,
        errors,
    };
}

export function classifyCanonicalEvidence(jobs) {
    const receipts = [];
    for (const job of jobs) {
        assert.equal(
            job.state,
            "complete",
            `Canonical gate has unsettled/error job ${job.jobId}: ${job.state}`,
        );
        assert.ok(!job.error, `Canonical gate job error: ${job.jobId}`);
        for (const result of job.results) {
            assert.ok(
                successfulTerminalResult(result),
                `Canonical gate target ${job.jobId}/${result.viewId}: ${result.state}`,
            );
            if (!result.wikiConsolidation) continue;
            assert.equal(
                result.wikiConsolidation.stage,
                "ready",
                `Canonical receipt incomplete ${job.jobId}/${result.viewId}: ${result.wikiConsolidation.stage}`,
            );
            receipts.push(result.wikiConsolidation);
        }
    }
    return {
        status: receipts.length ? "READY" : "NOT_EXERCISED",
        canonicalReceipts: receipts.length,
        scope: "Natural full-corpus canonical consolidation only",
    };
}

function successfulTerminalResult(result) {
    return (
        !result.error &&
        (["draft", "merged", "published", "searchable"].includes(
            result.state,
        ) ||
            (result.state === "skipped" &&
                result.reason ===
                    "Unchanged indexed evidence and definition; no synthesis required"))
    );
}

export async function readCanonicalQualification(service, corpusId) {
    const gate = classifyCanonicalEvidence(
        await service.listViewBuilds(corpusId),
    );
    return gate.status === "READY"
        ? { ...gate, evidence: await verifyConsolidation(service, corpusId) }
        : gate;
}

export function handledRequestDiagnostics(errors = [], successes = []) {
    return errors.every((error) => {
        if (
            error.phase !== "optimistic-head-retry" ||
            error.recognizedErrorType !== "ViewBuildStaleError" ||
            typeof error.requestId !== "string" ||
            !Number.isSafeInteger(error.attempt) ||
            error.attempt < 1
        )
            return false;
        const group = errors.filter(
            (entry) => entry.requestId === error.requestId,
        );
        const proof = successes.filter(
            (entry) => entry.requestId === error.requestId,
        );
        return (
            proof.length === 1 &&
            proof[0].returned === true &&
            proof[0].handledDiagnosticCount === group.length &&
            proof[0].completedAttempt === group.length + 1 &&
            group.every(
                (entry, index) =>
                    entry.phase === "optimistic-head-retry" &&
                    entry.recognizedErrorType === "ViewBuildStaleError" &&
                    entry.attempt === index + 1 &&
                    Number.isSafeInteger(entry.epochMs) &&
                    Number.isSafeInteger(proof[0].returnedEpochMs) &&
                    proof[0].returnedEpochMs >= entry.epochMs,
            )
        );
    });
}

export async function guardHeadRequest(action, hooks) {
    const requestId = randomUUID();
    const diagnostics = [];
    for (let attempt = 0; attempt < 20; attempt++) {
        hooks.checkDeadline();
        let value;
        try {
            value = await action();
        } catch (error) {
            if (!hooks.isStale(error) || attempt === 19) throw error;
            const diagnostic = {
                phase: "optimistic-head-retry",
                ...classifyRequestError(error),
                requestId,
                recognizedErrorType: "ViewBuildStaleError",
                attempt: attempt + 1,
                epochMs: Date.now(),
            };
            diagnostics.push(diagnostic);
            hooks.onDiagnostic(diagnostic);
            await (hooks.wait ?? (() => delay(25)))();
            continue;
        }
        if (diagnostics.length)
            hooks.onSuccessfulReturn({
                requestId,
                returned: true,
                handledDiagnosticCount: diagnostics.length,
                completedAttempt: attempt + 1,
                returnedEpochMs: Date.now(),
            });
        return value;
    }
    throw new Error("Guarded operation exhausted");
}

export function recordOwnedFixtureProtection(
    version,
    noteSectionId,
    protectedTargets,
) {
    assert.equal(version.provenance, "human");
    assert.ok(version.actor && version.actor !== "memory-view-generator");
    const targets = ["title", `section:${noteSectionId}:note`].sort();
    assert.deepEqual(protectedTargets(version).sort(), targets);
    const authoredEdits = version.edits.filter(
        (edit) => edit.status !== "cleared",
    );
    assert.equal(authoredEdits.length, 2);
    assert.deepEqual(
        authoredEdits.map((edit) => edit.target).sort(),
        ["title", `section:${noteSectionId}`].sort(),
    );
    for (const edit of authoredEdits) {
        assert.equal(edit.actor, version.actor);
        assert.equal(edit.operation, "set");
    }
    return {
        viewId: version.viewId,
        version: version.version,
        revisionId: version.revisionId,
        generatedBase: version.generation.candidateId,
        title: version.content.title,
        note: version.content.sections.find(
            (section) => section.id === noteSectionId,
        ).details.note,
        noteSectionId,
        actor: version.actor,
        authoredEdits: structuredClone(authoredEdits),
        protectedTargets: targets,
    };
}

export function assertOwnedEditorialEdits(
    view,
    protection,
    protectedTargets,
    hashValue,
    expectedProtection = protection.protectedTargets,
) {
    assert.ok(view.generation?.candidateId);
    assert.equal(
        view.generation.fingerprint,
        hashValue(view.generation.content),
    );
    assert.deepEqual(protectedTargets(view).sort(), expectedProtection);
    assert.equal(protection.authoredEdits.length, 2);
    const value = (content, target) =>
        target === "title"
            ? content.title
            : content.sections.find(
                  (section) => `section:${section.id}` === target,
              );
    for (const recorded of protection.authoredEdits) {
        const matching = view.edits.filter((edit) => edit.id === recorded.id);
        assert.equal(
            matching.length,
            1,
            "Exact recorded authored edit must remain",
        );
        const edit = matching[0];
        assert.notEqual(edit.status, "cleared");
        for (const key of ["actor", "target", "createdAt", "operation"])
            assert.equal(
                edit[key],
                recorded[key],
                `Authored edit ${key} changed`,
            );
        assert.equal(edit.actor, protection.actor);
        assert.deepEqual(edit.protection, recorded.protection);
        assert.deepEqual(edit.unlockedTargets ?? [], []);
        assert.equal(edit.generatedBaseId, view.generation.candidateId);
        assert.equal(edit.baseFingerprint, view.generation.fingerprint);
        assert.equal(
            edit.oldHash,
            hashValue(value(view.generation.content, edit.target)),
        );
        assert.equal(hashValue(edit.oldValue), edit.oldHash);
        assert.deepEqual(edit.newValue, value(view.content, edit.target));
        if (edit.target === "title") {
            assert.equal(recorded.newValue, protection.title);
            assert.equal(edit.newValue, protection.title);
        } else {
            assert.equal(edit.target, `section:${protection.noteSectionId}`);
            assert.equal(recorded.newValue.details.note, protection.note);
            assert.equal(edit.newValue.details.note, protection.note);
        }
    }
}

export async function resolveOwnedFixtureConflict(
    client,
    corpusId,
    record,
    protection,
    protectedTargets,
    hashValue,
) {
    assert.equal(record.purpose, "owned-T1-title-overlap");
    assert.equal(record.corpusId, corpusId);
    assert.equal(record.viewId, protection.viewId);
    assert.ok(protection.actor);
    const job = await client.getViewBuild({ corpusId, jobId: record.jobId });
    assert.equal(job.jobId, record.jobId);
    assert.equal(job.actor, record.jobActor);
    assert.equal(job.state, "failed");
    assert.equal(job.results.length, 1);
    const result = job.results[0];
    assert.equal(result.viewId, record.viewId);
    assert.equal(result.state, "conflicted");
    assert.equal(result.conflictId, record.conflictId);
    assert.equal(result.snapshot.fingerprint, record.inputFingerprint);
    assert.equal(result.snapshot.actor, record.inputActor);
    const conflict = await client.getViewConflict({
        corpusId,
        conflictId: record.conflictId,
    });
    assert.equal(conflict.conflictId, record.conflictId);
    assert.equal(conflict.corpusId, corpusId);
    assert.equal(conflict.jobId, record.jobId);
    assert.equal(conflict.viewId, record.viewId);
    assert.equal(record.generatorActor, "memory-view-generator");
    assert.equal(conflict.actor, record.generatorActor);
    assert.equal(conflict.state, "pending");
    assert.deepEqual(conflict.targets, ["title"]);
    assert.equal(conflict.input.fingerprint, record.inputFingerprint);
    assert.equal(conflict.input.actor, record.inputActor);
    assert.equal(conflict.expectedRevisionId, record.expectedRevisionId);
    const current = await client.getView({ corpusId, viewId: record.viewId });
    assert.equal(current.version, record.expectedVersion);
    assert.equal(current.version, conflict.human.version);
    assert.equal(current.revisionId, record.expectedRevisionId);
    assert.equal(current.actor, "memory-view-generator");
    assert.deepEqual(current.edits, conflict.human.edits);
    assert.deepEqual(current.generation, conflict.human.generation);
    assertOwnedEditorialEdits(current, protection, protectedTargets, hashValue);
    assert.equal(current.content.title, protection.title);
    const annotation = (version) =>
        version.content.sections.find(
            (section) => section.id === protection.noteSectionId,
        )?.details.note;
    assert.equal(annotation(current), protection.note);
    const beforeProtection = protectedTargets(current).sort();
    assert.ok(beforeProtection.includes("title"));
    assert.ok(
        beforeProtection.includes(`section:${protection.noteSectionId}:note`),
    );
    const humanSummaryChoice =
        hashValue(conflict.candidate.content.summary) !==
        hashValue(current.content.summary);
    const afterProtection = [
        ...beforeProtection,
        ...(humanSummaryChoice ? ["summary"] : []),
    ].sort();
    const choiceAdditions = (version) => {
        const originals = new Set(
            protection.authoredEdits.map((edit) => edit.id),
        );
        const added = version.edits.filter(
            (edit) => !originals.has(edit.id) && edit.status !== "cleared",
        );
        assert.equal(added.length, humanSummaryChoice ? 1 : 0);
        for (const edit of added) {
            assert.equal(edit.target, "summary");
            assert.equal(edit.actor, protection.actor);
            assert.equal(
                edit.operation,
                current.content.summary === undefined ? "delete" : "set",
            );
            assert.equal(
                edit.oldHash,
                hashValue(conflict.candidate.content.summary),
            );
            assert.equal(hashValue(edit.oldValue), edit.oldHash);
            assert.deepEqual(edit.newValue, current.content.summary);
            assert.equal(edit.generatedBaseId, version.generation.candidateId);
            assert.equal(edit.baseFingerprint, version.generation.fingerprint);
            assert.deepEqual(protectedTargets({ edits: [edit] }), ["summary"]);
            assert.deepEqual(edit.unlockedTargets ?? [], []);
        }
        return added.map(({ id, actor, target }) => ({ id, actor, target }));
    };
    const request = {
        corpusId,
        conflictId: record.conflictId,
        expectedHead: (await client.listViews(corpusId)).head,
        expectedVersion: current.version,
        expectedRevisionId: current.revisionId,
        inputFingerprint: record.inputFingerprint,
        choice: "human",
    };
    const saved = await client.resolveViewConflict(request);
    const resolved = await client.getViewConflict({
        corpusId,
        conflictId: record.conflictId,
    });
    assert.equal(resolved.state, "resolved");
    assert.equal(resolved.resolutionRevisionId, saved.version.revisionId);
    assert.equal(saved.version.provenance, "human");
    assert.equal(saved.version.actor, protection.actor);
    assert.equal(saved.version.content.title, protection.title);
    assert.equal(annotation(saved.version), protection.note);
    assert.deepEqual(protectedTargets(saved.version).sort(), afterProtection);
    assertOwnedEditorialEdits(
        saved.version,
        protection,
        protectedTargets,
        hashValue,
        afterProtection,
    );
    const humanChoiceEdits = choiceAdditions(saved.version);
    const readBack = await client.getView({
        corpusId,
        viewId: record.viewId,
    });
    assert.equal(readBack.revisionId, saved.version.revisionId);
    assert.equal(readBack.content.title, protection.title);
    assert.equal(annotation(readBack), protection.note);
    assert.deepEqual(protectedTargets(readBack).sort(), afterProtection);
    assertOwnedEditorialEdits(
        readBack,
        protection,
        protectedTargets,
        hashValue,
        afterProtection,
    );
    assert.deepEqual(choiceAdditions(readBack), humanChoiceEdits);
    return {
        ...record,
        request,
        state: resolved.state,
        resolutionRevisionId: saved.version.revisionId,
        protectedTargets: afterProtection,
        priorProtectedTargets: beforeProtection,
        humanChoiceEdits,
        sourceInputs: result.snapshot.inputs.map(
            ({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            }),
        ),
        reason: result.reason,
        actor: saved.version.actor,
        authoredEditIds: protection.authoredEdits.map((edit) => edit.id),
        authoredEditsVerified: true,
        scope: "Explicit authenticated synthetic fixture human choice only; authoritative fresh source/index recapture in public resolveViewConflict",
    };
}

export function assertTerminalJobs(jobs, resolution) {
    for (const job of jobs) {
        if (job.state === "running") continue;
        assert.ok(!job.error, `Unexpected job error ${job.jobId}`);
        if (job.state === "complete") {
            assert.ok(
                job.results.every(
                    (result) =>
                        successfulTerminalResult(result) &&
                        (!result.wikiConsolidation ||
                            result.wikiConsolidation.stage === "ready"),
                ),
                `Unexpected terminal result in ${job.jobId}`,
            );
            continue;
        }
        assert.ok(resolution, `Unexpected failed job ${job.jobId}`);
        assert.equal(resolution.state, "resolved");
        assert.ok(resolution.resolutionRevisionId);
        assert.equal(job.jobId, resolution.jobId);
        assert.equal(job.state, "failed");
        assert.equal(job.results.length, 1);
        const result = job.results[0];
        assert.equal(result.viewId, resolution.viewId);
        assert.equal(result.state, "conflicted");
        assert.equal(result.conflictId, resolution.conflictId);
        assert.equal(result.reason, resolution.reason);
        assert.deepEqual(
            result.snapshot.inputs.map(({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            })),
            resolution.sourceInputs,
        );
    }
}

export function offlineMechanismSetStatus(timeline, canonical) {
    return timelineMechanismsVerified(timeline) &&
        canonicalMechanismsVerified(canonical)
        ? "PASS_OFFLINE_MECHANISMS_ONLY_LIVE_SEMANTICS_PENDING"
        : "BLOCKED";
}

function timelineMechanismsVerified(timeline) {
    const timelineOutcomes = [
        "OFFLINE_T1_T2_MECHANISMS_VERIFIED_SEMANTICS_PENDING",
        "OFFLINE_T1_T2_TIMELINE_VERIFIED_CANONICAL_NOT_EXERCISED_SEMANTICS_PENDING",
    ];
    const checks = [
        "authenticated-protection-and-real-overlap",
        "privacy-over-protection-and-held-late-result",
        "actual-read-but-not-cited-topic-influence-forget-late-denial",
        "exact-settled-restart-unchanged-repeat",
        "actual-RPC-facade-read-and-forget-denial",
    ];
    return (
        timelineOutcomes.includes(timeline?.outcome) &&
        timeline.close?.completed &&
        timeline.checkpointGuard?.afterVerified &&
        ["READY", "NOT_EXERCISED"].includes(
            timeline.actions?.naturalCanonical?.status,
        ) &&
        ownedConflictResolutionVerified(timeline.actions.conflictResolution) &&
        timelineSourceCountsVerified(timeline.stages) &&
        handledRequestDiagnostics(
            timeline.errors,
            timeline.successfulRequestReturns,
        ) &&
        finalSnapshotHasParity(timeline.beforeClose) &&
        timeline.snapshotQualification?.maxHydrations <= 1 &&
        checks.every((name) =>
            timeline.checks.some(
                (check) =>
                    check.name === name && check.status === "PASS_OFFLINE",
            ),
        ) &&
        timeline.checks.find(
            (check) => check.name === "exact-settled-restart-unchanged-repeat",
        )?.restarts?.length === 2
    );
}

function timelineSourceCountsVerified(stages) {
    return (
        stages?.initial?.activeSources === 23 &&
        stages?.t1?.activeSources === 24 &&
        stages?.t2?.activeSources === 25 &&
        stages?.["t2-forgotten"]?.activeSources === 24
    );
}

function ownedConflictResolutionVerified(resolution) {
    return (
        resolution?.state === "resolved" &&
        resolution.resolutionRevisionId &&
        resolution.request?.choice === "human" &&
        resolution.request.inputFingerprint === resolution.inputFingerprint
    );
}

function finalSnapshotHasParity(snapshot) {
    return (
        snapshot?.readiness.ready &&
        !snapshot.citationErrors.length &&
        snapshot.originalIncidence === snapshot.maintainedIncidence
    );
}

function canonicalMechanismsVerified(canonical) {
    return (
        canonical?.outcome ===
            "PASS_OFFLINE_CANONICAL_PROCESS_CRASH_RECOVERY" &&
        canonical.checkpointGuard?.afterVerified &&
        canonical.close?.completed &&
        canonical.repeat?.sameHead &&
        canonical.repeat.sameRevisions &&
        canonical.repeat.extraModelCalls === 0 &&
        canonicalPublicReadWriteVerified(canonical.publicReadWrite) &&
        canonical.privacy?.canonicalAndAliasDenied &&
        canonical.privacy.historyAndJobSuppressed
    );
}

function canonicalPublicReadWriteVerified(publicReadWrite) {
    return (
        publicReadWrite?.registeredSections >= 2 &&
        publicReadWrite.observations.length === 6 &&
        publicReadWrite.guardedStaleWriteDenied &&
        publicReadWrite.actualEditRevisionId &&
        publicReadWrite.actualEditRevisionId ===
            publicReadWrite.actualEditReadRevisionId &&
        publicReadWrite.afterEditPublication?.indexState === "ready"
    );
}

export function selectGroundedC1View(
    snapshot,
    source,
    reference,
    query,
    currentHead,
    previousViewId,
    { currentSources = [source], defaultViewIds = [], diagnosticViewId } = {},
) {
    assert.equal(snapshot.head, currentHead, "C1 read head changed");
    assert.ok(typeof currentHead === "string" && currentHead.length);
    assert.equal(source?.sourceId, reference.sourceId, "C1 source mismatch");
    assert.equal(
        source.activeRevisionId,
        reference.revisionId,
        "C1 source revision is not current",
    );
    assert.equal(
        source.revisions.find(
            (revision) => revision.revisionId === reference.revisionId,
        )?.state,
        "ready",
        "C1 original source is not ready",
    );
    const normalize = (value) => value.trim().toLocaleLowerCase();
    const matches = snapshot.views.filter(
        (view) =>
            view.definition.kind === "wiki" &&
            view.definition.wiki &&
            normalize(view.definition.wiki.query) === normalize(query),
    );
    assert.ok(
        matches.length <= 1,
        "C1 scaffold ambiguity: multiple query matches",
    );
    if (!matches.length) {
        assert.equal(previousViewId, undefined, "C1 prior default disappeared");
        return undefined;
    }
    const view = matches[0];
    if (previousViewId)
        assert.equal(
            view.viewId,
            previousViewId,
            "C1 natural default ID changed",
        );
    assert.ok(
        !view.redirect && !["archived", "stale"].includes(view.state),
        "C1 matching default is not eligible",
    );
    assert.equal(view.definition.wiki.construction, "informational-wiki-v1");
    const naturalDefault = defaultViewIds.includes(view.viewId);
    if (diagnosticViewId !== undefined) {
        assert.equal(view.viewId, diagnosticViewId, "C1 diagnostic ID changed");
        assert.ok(
            !naturalDefault,
            "C1 diagnostic cannot become a natural scope",
        );
        assert.deepEqual(
            view.definition.selector,
            { kind: "sources", sources: [reference] },
            "C1 explicit diagnostic source/scope must not broaden",
        );
    } else {
        assert.ok(
            naturalDefault,
            "C1 matching page is not a natural family default",
        );
    }
    const input = view.generation?.input;
    assert.equal(input?.pipeline, "informational-wiki-v1");
    assert.ok(
        input.model.endsWith(":indexed-evidence-v2"),
        "C1 generation must retain the current indexed recipe",
    );
    assert.ok(
        Number.isInteger(view.version) &&
            view.version > 0 &&
            input.expectedVersion < view.version,
        "C1 accepted generation/version is unavailable",
    );
    assert.equal(view.definition.selector.kind, "sources");
    const members = view.definition.selector.sources;
    assert.ok(members.length, "C1 current grounded membership is empty");
    const key = (ref) => `${ref.sourceId}:${ref.revisionId}`;
    const scope = new Set(members.map(key));
    assert.equal(
        scope.size,
        members.length,
        "C1 duplicate grounded membership",
    );
    assert.ok(
        scope.has(key(reference)),
        "C1 expected original grounding is absent",
    );
    const refs = (values) => values.map(key).sort();
    assert.deepEqual(
        refs(input.inputs),
        refs(members),
        "C1 captured inputs differ from current grounded membership",
    );
    assert.deepEqual(
        input.definition.selector,
        view.definition.selector,
        "C1 captured selector differs from current grounded membership",
    );
    assert.deepEqual(input.definition.wiki, view.definition.wiki);
    for (const member of members) {
        assert.ok(
            !view.definition.wiki.excludedSourceIds.includes(member.sourceId),
            "C1 grounded member is excluded",
        );
        const matches = currentSources.filter(
            (candidate) => candidate.sourceId === member.sourceId,
        );
        assert.equal(matches.length, 1, "C1 grounded original is unavailable");
        const current = matches[0];
        assert.equal(
            current.activeRevisionId,
            member.revisionId,
            "C1 grounded original revision is obsolete",
        );
        const revision = current.revisions.find(
            (entry) => entry.revisionId === member.revisionId,
        );
        assert.equal(
            revision?.state,
            "ready",
            "C1 grounded original is not ready",
        );
        assert.equal(
            revision.synopsis?.status,
            "ready",
            "C1 grounded original synopsis is suppressed or unavailable",
        );
        const captured = input.inputs.find(
            (entry) => entry.sourceId === member.sourceId,
        );
        assert.equal(
            revision.contentHash,
            member.revisionId,
            "C1 original revision hash differs from the immutable document revision",
        );
        assert.ok(
            captured.passages?.length,
            "C1 captured indexed passages are absent",
        );
        for (const passage of captured.passages)
            assert.equal(
                key(passage),
                key(member),
                "C1 captured passage scope differs",
            );
    }
    assert.ok(view.content.citations.length, "C1 article citations are absent");
    for (const citation of view.content.citations)
        assert.ok(
            scope.has(key(citation)),
            "C1 article citation is outside current grounded membership",
        );
    assert.ok(
        view.content.citations.some(
            (citation) => key(citation) === key(reference),
        ),
        "C1 article lacks the named current original citation",
    );
    return view;
}

export function createInitialStopControl({ allPhases = false, expected } = {}) {
    let firstFailure;
    let frozen = false;
    const expectedOutcomes = [];
    return {
        expectedOutcomes,
        observe(phase, job, viewId, state, reason) {
            if (
                frozen ||
                (!allPhases && phase !== "initial") ||
                firstFailure ||
                ![
                    "failed",
                    "cancelled",
                    "stale",
                    "interrupted",
                    "blocked",
                    "conflicted",
                ].includes(state)
            )
                return;
            const mechanism = expected?.(phase, job, viewId, state);
            if (mechanism) {
                expectedOutcomes.push({
                    phase,
                    jobId: job.jobId,
                    viewId,
                    state,
                    reason,
                    mechanism,
                });
                return;
            }
            firstFailure = {
                phase,
                jobId: job.jobId,
                viewId,
                state,
                reason,
                category:
                    state === "failed" &&
                    reason ===
                        "Evidence-first synthesis exceeded 120 second limit"
                        ? "target-timeout"
                        : state === "cancelled"
                          ? "target-cancellation"
                          : state === "stale"
                            ? "target-stale"
                            : `target-${state}`,
                observedEpochMs: Date.now(),
                input: job.results?.find((result) => result.viewId === viewId)
                    ?.snapshot,
            };
        },
        failure() {
            return firstFailure;
        },
        freeze() {
            frozen = true;
        },
        check() {
            if (!firstFailure) return;
            const error = new Error(
                `Bounded ${allPhases ? "offline" : "initial"} stop: ${firstFailure.category}: ${firstFailure.reason}`,
            );
            error.name = "InitialQualificationStop";
            throw error;
        },
    };
}

export async function closeOwnedService(service) {
    const started = Date.now();
    try {
        await service.close();
        return { completed: true, elapsedMs: Date.now() - started };
    } catch (error) {
        return {
            completed: false,
            elapsedMs: Date.now() - started,
            error: { name: error.name, message: error.message },
        };
    }
}

export function installSnapshotQualification(
    ViewHistory,
    FileMemoryService,
    phase,
    previous,
) {
    const context = new AsyncLocalStorage();
    const summary = previous
        ? structuredClone(previous)
        : {
              maxHydrations: 0,
              operations: 0,
              hydrations: 0,
              violations: [],
              phases: {},
          };
    const read = ViewHistory.prototype.read;
    ViewHistory.prototype.read = function (...args) {
        const operation = context.getStore();
        if (operation?.active) operation.hydrations++;
        return Reflect.apply(read, this, args);
    };
    const restores = [
        () => {
            ViewHistory.prototype.read = read;
        },
    ];
    for (const method of ["listViews", "readConsolidationPairs"]) {
        const original = FileMemoryService.prototype[method];
        assert.equal(typeof original, "function");
        FileMemoryService.prototype[method] = function (...args) {
            const operation = {
                phase: phase(),
                method,
                hydrations: 0,
                active: true,
            };
            return context.run(operation, async () => {
                try {
                    return await Reflect.apply(original, this, args);
                } finally {
                    operation.active = false;
                    const bucket = (summary.phases[
                        `${operation.phase}/${method}`
                    ] ??= { operations: 0, hydrations: 0, maxHydrations: 0 });
                    for (const item of [summary, bucket]) {
                        item.operations++;
                        item.hydrations += operation.hydrations;
                        item.maxHydrations = Math.max(
                            item.maxHydrations,
                            operation.hydrations,
                        );
                    }
                    if (operation.hydrations > 1)
                        summary.violations.push(operation);
                }
            });
        };
        restores.push(() => {
            FileMemoryService.prototype[method] = original;
        });
    }
    return {
        summary,
        restore: () => restores.reverse().forEach((restore) => restore()),
    };
}
export const phases = [
    "baseline",
    "meeting-orders",
    "correction",
    "initial",
    "t1",
    "t2",
];

export function validateSpec(spec) {
    assert.equal(
        spec.mode,
        "offline",
        "No configured-model execution in preparation",
    );
    assert.ok(path.isAbsolute(spec.productRoot));
    assert.ok(path.isAbsolute(spec.fixtureRoot));
    assert.ok(path.isAbsolute(spec.runDirectory));
    assert.ok(
        [spec.startupAllowanceMs, spec.workAllowanceMs].every(
            (value) =>
                Number.isSafeInteger(value) && value > 0 && value <= 5_400_000,
        ),
        "Allowances must be positive integer milliseconds, at most 90 minutes",
    );
    assert.ok(typeof spec.receiptId === "string" && spec.receiptId.length);
    assert.ok(
        spec.p6 === undefined || typeof spec.p6 === "boolean",
        "P6 mode must be boolean",
    );
    assert.ok(
        spec.performance === undefined || typeof spec.performance === "boolean",
    );
    assert.ok(
        spec.qualification === undefined ||
            typeof spec.qualification === "boolean",
    );
    if (spec.performance || spec.qualification || spec.expectedCheckpoint)
        assertCheckpoint(
            spec.expectedCheckpoint?.hashes,
            spec.expectedCheckpoint,
        );
    if (spec.qualification)
        assert.ok(
            spec.p6 && !spec.performance && spec.nativeProfile === false,
            "Full offline qualification requires P6, native-off and no initial-only performance scope",
        );
    assert.ok(
        spec.nativeProfile === undefined ||
            typeof spec.nativeProfile === "boolean",
    );
    assert.ok(
        spec.stopInitialFailure === undefined ||
            typeof spec.stopInitialFailure === "boolean",
    );
    if (spec.stopInitialFailure)
        assert.ok(
            spec.performance,
            "Bounded initial failure stop requires fresh initial-only performance scope",
        );
    if (spec.performance)
        assert.ok(
            spec.p6 && !spec.resume && !spec.crashStage,
            "Performance scope is fresh P6 initial-only, no crash/holds/resume",
        );
    assert.ok(
        spec.crashStage === undefined || spec.crashStage === "t1",
        "The optional crash probe is bounded to T1: P6 post-canonical or historical P5 post-index",
    );
}

export async function loadPlan(fixtureRoot) {
    const profile = JSON.parse(
        await readFile(
            path.join(
                fixtureRoot,
                "fixtures",
                "second-brain-maintenance",
                "profile.json",
            ),
            "utf8",
        ),
    );
    const operations = [];
    const latest = new Map();
    const uniqueFiles = new Set();
    for (const phase of phases) {
        for (const entry of profile.sources.filter(
            (source) => source.phase === phase,
        )) {
            const relative = entry.projections["content-only"].markdown;
            assert.equal(
                typeof relative,
                "string",
                "One canonical Markdown projection required",
            );
            const file = path.resolve(fixtureRoot, ...relative.split("/"));
            assert.ok(
                file.startsWith(`${path.resolve(fixtureRoot)}${path.sep}`),
            );
            assert.ok(
                !uniqueFiles.has(file),
                "Never ingest alternative or duplicate files",
            );
            uniqueFiles.add(file);
            assert.equal(
                entry.replacesRevision,
                latest.get(entry.sourceKey) ?? null,
                "Fixture prior revision must match ordered guarded delta",
            );
            latest.set(entry.sourceKey, entry.revision);
            const content = await readFile(file, "utf8");
            assert.ok(!content.includes("MAINTENANCE_EVALUATOR_ONLY"));
            operations.push({ ...entry, phase, file, sha256: sha(content) });
        }
    }
    assert.equal(
        operations.filter((entry) => entry.phase === "baseline").length,
        16,
    );
    assert.equal(operations.length, 33);
    assert.equal(latest.size, 25);
    return operations;
}

export async function runOffline(spec) {
    validateSpec(spec);
    const runDirectory = await realpath(spec.runDirectory);
    const ownership = JSON.parse(
        await readFile(path.join(runDirectory, "ownership.json"), "utf8"),
    );
    assert.equal(ownership.receiptId, spec.receiptId);
    assert.equal(await realpath(ownership.runDirectory), runDirectory);
    const store = path.join(runDirectory, "isolated-store");
    assert.equal(path.dirname(store), runDirectory);
    const receiptPath = path.join(runDirectory, "receipt.json");
    const loadReceipt = async () => {
        let receipt;
        if (spec.resume) {
            receipt = JSON.parse(await readFile(receiptPath, "utf8"));
            assert.equal(receipt.receiptId, spec.receiptId);
            assert.equal(receipt.store, store);
            receipt.resumes.push({ epochMs: Date.now(), pid: process.pid });
            receipt.outcome = "IN_PROGRESS";
        } else {
            receipt = {
                receiptId: spec.receiptId,
                mode: "offline",
                store,
                pid: process.pid,
                startedEpochMs: Date.now(),
                resumes: [],
                stages: {},
                operations: [],
                mappings: {},
                actions: {},
                checks: [],
                errors: [],
                pending: [
                    ...(!spec.p6
                        ? [
                              "P6 canonical consolidation, stable redirects, scope choices and crash boundaries",
                          ]
                        : []),
                    "Independent C1-C11 semantic review after later authorized configured-role run",
                ],
                counters: {
                    extraction: 0,
                    article: 0,
                    topic: 0,
                    synopsis: 0,
                    assessment: 0,
                    editorial: 0,
                    network: 0,
                    unexpectedCompletion: 0,
                    unexpectedValidation: 0,
                },
                outcome: "IN_PROGRESS",
            };
        }
        return receipt;
    };
    const receipt = await loadReceipt();
    const persist = async () => {
        receipt.updatedEpochMs = Date.now();
        await writeJson(receiptPath, receipt);
    };
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        receipt.counters.network++;
        throw new Error("Offline preflight prohibits network");
    };
    const priorEmbedding = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    assert.equal(
        receipt.p6 ?? false,
        spec.resume ? !!spec.p6 : false,
        "Resume cannot change qualification mode",
    );
    receipt.p6 = !!spec.p6;
    const controls = {
        p6: !!spec.p6,
        recoveringConsolidation: spec.p6
            ? receipt.actions.crash?.consolidation
            : undefined,
    };
    if (spec.resume && spec.qualification)
        await rename(
            path.join(runDirectory, "performance-events.jsonl"),
            path.join(
                runDirectory,
                `performance-events-before-resume-${spec.spawnedEpochMs}.jsonl`,
            ),
        );
    const performanceTrace =
        spec.performance || spec.qualification
            ? createPerformanceTrace(
                  runDirectory,
                  spec.receiptId,
                  () => receipt.phase ?? "startup",
              )
            : undefined;
    controls.tracer = performanceTrace;
    controls.onEvent =
        performanceTrace?.event ??
        ((event, edge, data) =>
            appendFileSync(
                path.join(runDirectory, "phase-events.jsonl"),
                JSON.stringify({
                    epochMs: Date.now(),
                    pid: process.pid,
                    phase: receipt.phase,
                    event,
                    edge,
                    ...data,
                }) + "\n",
            ));
    let service;
    let restoreCrash;
    let restoreTrace;
    let releaseHeld;
    let workDeadline;
    let snapshotQualification;
    let restoreInitialObserver;
    let captureBeforeClose;
    const initialStop =
        spec.stopInitialFailure || spec.qualification
            ? createInitialStopControl({
                  allPhases: !!spec.qualification,
                  expected: (phase, job, viewId, state) => {
                      if (
                          phase === "t1" &&
                          controls.overlapQuery === "lease" &&
                          viewId === receipt.actions.protection?.viewId &&
                          state === "conflicted"
                      )
                          return "asserted-protected-title-overlap";
                      if (
                          phase === "external-forget" &&
                          job.jobId === controls.expectedForgetJobId &&
                          ["cancelled", "stale", "interrupted"].includes(state)
                      )
                          return "authorized-forget-held-late-denial";
                      if (
                          phase === "separate-read-not-cited-privacy-probe" &&
                          job.jobId === controls.expectedPrivacyJobId &&
                          ["cancelled", "stale", "interrupted"].includes(state)
                      )
                          return "authorized-uncited-influence-forget";
                  },
              })
            : undefined;
    receipt.compiledHashes ??= {};
    const load = async (relative) => {
        const file = path.join(spec.productRoot, relative);
        const hash =
            (spec.performance || spec.qualification) &&
            receipt.compiledHashes[relative]
                ? receipt.compiledHashes[relative]
                : sha(await readFile(file));
        if (receipt.compiledHashes[relative])
            assert.equal(
                receipt.compiledHashes[relative],
                hash,
                "Compiled checkpoint changed; request serialized runtime handoff, do not rebuild",
            );
        receipt.compiledHashes[relative] = hash;
        return import(pathToFileURL(file).href);
    };
    const bindCheckpoint = async () => {
        if (spec.performance || spec.qualification) {
            const currentHashes = await snapshotCompiledCheckpoint(
                spec.productRoot,
            );
            if (spec.resume) {
                assert.deepEqual(
                    currentHashes,
                    receipt.compiledHashes,
                    "Resume must retain the exact admitted compiled checkpoint",
                );
                assert.equal(
                    receipt.checkpointGuard?.expectationHash,
                    checkpointExpectationHash(spec.expectedCheckpoint),
                    "Resume cannot change the explicit checkpoint expectation",
                );
            }
            receipt.compiledHashes = currentHashes;
            assertCheckpoint(receipt.compiledHashes, spec.expectedCheckpoint);
            receipt.checkpointGuard = {
                expected: spec.expectedCheckpoint,
                expectationHash: checkpointExpectationHash(
                    spec.expectedCheckpoint,
                ),
                compiledFiles: Object.keys(receipt.compiledHashes).length,
                compiledHashesHash: sha(JSON.stringify(receipt.compiledHashes)),
                verifiedEpochMs: Date.now(),
            };
            await writeJson(
                path.join(runDirectory, "checkpoint-bound.json"),
                receipt.checkpointGuard,
            );
            receipt.harnessHashes = {};
            for (const name of [
                "harness.mjs",
                "performance-trace.mjs",
                "offline-models.mjs",
                "p6-preflight.mjs",
                "watchdog.mjs",
                "../../packages/benchmarks/src/memoryBench/shared/checkpoint.mjs",
                "../../packages/benchmarks/src/memoryBench/shared/supervisor.mjs",
            ])
                receipt.harnessHashes[name] = sha(
                    await readFile(path.join(import.meta.dirname, name)),
                );
            receipt.performanceScope = {
                node: process.version,
                productTargetMs: 120000,
                stopAfter: spec.qualification ? "t2-and-mechanisms" : "initial",
                hashesBoundOnce: true,
                startupAllowanceMs: spec.startupAllowanceMs,
                workAllowanceMs: spec.workAllowanceMs,
                cleanupReserveMs: 120000,
                checkpoint: spec.expectedCheckpoint.name,
                nativeCpuIntervalUs:
                    spec.nativeProfile === false ? null : 10000,
                nativeProfile: spec.nativeProfile !== false,
                stopInitialFailure: !!spec.stopInitialFailure,
                coverage:
                    "sparse target/phase/role/queue spans; history/Git constant-size rollups",
            };
        }
    };
    try {
        await bindCheckpoint();
        const { FileMemoryService } = await load(
            "packages\\memory\\service\\dist\\fileMemoryService.js",
        );
        const { waitForMemoryJob, createMemoryServiceRpcFacade } = await load(
            "packages\\memory\\service\\dist\\rpcFacade.js",
        );
        const { TypedViewStore } = await load(
            "packages\\memory\\service\\dist\\viewStore.js",
        );
        const { ViewBuildStaleError } = await load(
            "packages\\memory\\service\\dist\\viewBuilds.js",
        );
        const { derivedDefinitionInput, authoredRelationships } = await load(
            "packages\\memory\\service\\dist\\viewRelationships.js",
        );
        const { editorialProtection } = await load(
            "packages\\memory\\service\\dist\\viewEditorial.js",
        );
        const { viewHash } = await load(
            "packages\\memory\\service\\dist\\viewMerge.js",
        );
        const { parseIndexedLocator, indexedLocator } = await load(
            "packages\\memory\\service\\dist\\indexedFragments.js",
        );
        const options = await createOfflineOptions(
            load,
            receipt.counters,
            controls,
        );
        const installRuntimeHooks = async () => {
            if (performanceTrace)
                await installProductPerformance(
                    performanceTrace,
                    load,
                    FileMemoryService,
                    TypedViewStore,
                );
            if (spec.stopInitialFailure || spec.qualification) {
                const { ViewHistory } = await load(
                    "packages\\memory\\service\\dist\\viewHistory.js",
                );
                const { ViewBuildRunner } = await load(
                    "packages\\memory\\service\\dist\\viewBuilds.js",
                );
                snapshotQualification = installSnapshotQualification(
                    ViewHistory,
                    FileMemoryService,
                    () => receipt.phase,
                    spec.resume ? receipt.snapshotQualification : undefined,
                );
                const originalResult = ViewBuildRunner.prototype.result;
                ViewBuildRunner.prototype.result = async function (
                    job,
                    viewId,
                    state,
                    reason,
                    ...args
                ) {
                    const value = await Reflect.apply(originalResult, this, [
                        job,
                        viewId,
                        state,
                        reason,
                        ...args,
                    ]);
                    initialStop.observe(
                        receipt.phase,
                        job,
                        viewId,
                        state,
                        reason,
                    );
                    return value;
                };
                restoreInitialObserver = () => {
                    ViewBuildRunner.prototype.result = originalResult;
                };
            }
            if (spec.p6) {
                await installP6Options(
                    options,
                    load,
                    receipt.counters,
                    controls,
                );
                installOfflineTrace(options, controls);
                if (!performanceTrace)
                    restoreTrace = installStoreTrace(TypedViewStore, controls);
                if (spec.crashStage)
                    restoreCrash = installCanonicalCrash(
                        TypedViewStore,
                        controls,
                        receipt,
                        persist,
                        async (crash) => {
                            if (snapshotQualification)
                                receipt.snapshotQualification = structuredClone(
                                    snapshotQualification.summary,
                                );
                            await writeJson(
                                path.join(runDirectory, "crash-receipt.json"),
                                crash,
                            );
                        },
                    );
            }
            if (spec.crashStage && !spec.p6) {
                options.viewPublicationCheckpoint = async (point) => {
                    if (
                        point !== "index" ||
                        receipt.phase !== spec.crashStage ||
                        receipt.actions.crash
                    )
                        return;
                    const views = new TypedViewStore(store);
                    const current = await views.listViews(receipt.corpusId);
                    const candidates = current.views.filter(
                        (view) =>
                            !receipt.stages.initial.revisions.includes(
                                view.revisionId,
                            ),
                    );
                    for (const candidate of candidates) {
                        const publication = await views.getViewPublication({
                            corpusId: receipt.corpusId,
                            viewId: candidate.viewId,
                        });
                        if (
                            publication.publishedRevisionId !==
                                candidate.revisionId ||
                            publication.indexState === "ready"
                        )
                            continue;
                        receipt.actions.crash = {
                            boundary:
                                "P5 accepted canonical content and physical derivative index, before index acknowledgement",
                            phase: receipt.phase,
                            epochMs: Date.now(),
                            workerPid: process.pid,
                            viewId: candidate.viewId,
                            revisionId: candidate.revisionId,
                            version: candidate.version,
                            head: current.head,
                            publication,
                            targetSynthesisCalls:
                                receipt.counters.callsByView[candidate.viewId],
                        };
                        receipt.outcome = "INTERRUPTED_AFTER_ACCEPTANCE";
                        await writeJson(
                            path.join(runDirectory, "crash-receipt.json"),
                            receipt.actions.crash,
                        );
                        await persist();
                        process.exit(86);
                    }
                    throw new Error(
                        "Crash hook reached without an accepted pending derivative receipt",
                    );
                };
            }
        };
        await installRuntimeHooks();
        const indexes = new Map();
        captureBeforeClose = async () => {
            const corpusId = receipt.corpusId;
            if (!corpusId) return;
            const views = new TypedViewStore(store);
            const [snapshot, stored, jobs, sources, topic] = await Promise.all([
                service.listViews(corpusId),
                views.listViews(corpusId),
                service.listViewBuilds(corpusId),
                service.listSources(corpusId),
                views.getTopicState(corpusId),
            ]);
            const collectIndexDiagnostics = async () => {
                const sourceIds = new Set(
                    sources.map((source) => source.sourceId),
                );
                const indexWork = [];
                let originalOccurrences = [];
                for (const [directory, index] of [
                    ...indexes.entries(),
                ].reverse()) {
                    if (
                        directory.includes("view-search-index") ||
                        directory.includes("event-search-index")
                    )
                        continue;
                    indexWork.push({
                        directory,
                        messages: index.memory?.messages.length,
                        semanticRefs: index.memory?.semanticRefs.length,
                    });
                    const occurrences =
                        await index.getTopicOccurrences(sourceIds);
                    if (
                        !originalOccurrences.length &&
                        occurrences.length &&
                        occurrences.every(
                            (entry) =>
                                sources.find(
                                    (source) =>
                                        source.sourceId === entry.sourceId,
                                )?.activeRevisionId === entry.revisionId,
                        )
                    )
                        originalOccurrences = occurrences;
                }
                return { indexWork, originalOccurrences };
            };
            const { indexWork, originalOccurrences } =
                await collectIndexDiagnostics();
            const collectCitationDiagnostics = async () => {
                let exactCitations = 0;
                const citationErrors = [];
                for (const view of snapshot.views)
                    for (const citation of view.content.citations) {
                        try {
                            const content = await service.getSourceContent({
                                corpusId,
                                sourceId: citation.sourceId,
                                revisionId: citation.revisionId,
                                indexedLocator: citation.locator,
                            });
                            assert.equal(content.content, citation.excerpt);
                            exactCitations++;
                        } catch (error) {
                            citationErrors.push({
                                viewId: view.viewId,
                                sourceId: citation.sourceId,
                                name: error.name,
                                message: error.message,
                            });
                        }
                    }
                return { exactCitations, citationErrors };
            };
            const { exactCitations, citationErrors } =
                await collectCitationDiagnostics();
            const compareFailedInput = async () => {
                const failure = initialStop?.failure();
                let comparison;
                if (failure?.input) {
                    const { viewHash } = await load(
                        "packages\\memory\\service\\dist\\viewMerge.js",
                    );
                    const input = failure.input;
                    const current = stored.views.find(
                        (view) => view.viewId === failure.viewId,
                    );
                    comparison = {
                        capturedFingerprint: input.fingerprint,
                        currentGenerationFingerprint:
                            current?.generation?.input?.fingerprint,
                        expectedVersion: input.expectedVersion,
                        currentVersion: current?.version,
                        targetRevisionId: input.targetRevisionId,
                        currentRevisionId: current?.revisionId,
                        definitionRevisionId: input.definitionRevisionId,
                        currentDefinitionRevisionId:
                            current?.definition.revisionId,
                        capturedDefinitionHash: viewHash(input.definition),
                        currentDefinitionHash: current
                            ? viewHash(current.definition)
                            : undefined,
                        capturedSelectionFingerprint:
                            input.selectionFingerprint,
                        currentSelectionFingerprint:
                            current?.generation?.input?.selectionFingerprint,
                        inputs: input.inputs.map((retained) => {
                            const source = sources.find(
                                (entry) => entry.sourceId === retained.sourceId,
                            );
                            const revision = source?.revisions.find(
                                (entry) =>
                                    entry.revisionId === retained.revisionId,
                            );
                            return {
                                sourceId: retained.sourceId,
                                capturedRevisionId: retained.revisionId,
                                activeRevisionId: source?.activeRevisionId,
                                currentState: revision?.state,
                                capturedContentHash: retained.contentHash,
                                currentContentHash: revision
                                    ? viewHash(
                                          service.corpora
                                              .get(corpusId)
                                              .manifest.sources.find(
                                                  (entry) =>
                                                      entry.sourceId ===
                                                      retained.sourceId,
                                              )
                                              .revisions.find(
                                                  (entry) =>
                                                      entry.revisionId ===
                                                      retained.revisionId,
                                              ).content,
                                      )
                                    : undefined,
                            };
                        }),
                    };
                }
                return comparison;
            };
            const comparison = await compareFailedInput();
            const stateCounts = {};
            const targetCounts = {};
            for (const job of jobs) {
                stateCounts[job.state] = (stateCounts[job.state] ?? 0) + 1;
                for (const result of job.results)
                    targetCounts[result.state] =
                        (targetCounts[result.state] ?? 0) + 1;
            }
            const diagnostic = {
                epochMs: Date.now(),
                phase: receipt.phase,
                outcome: receipt.outcome,
                head: stored.head,
                sourceCount: sources.length,
                jobs: stateCounts,
                targets: targetCounts,
                readiness: initialReadiness(snapshot, jobs, sources, topic),
                comparison,
                exactCitations,
                citationErrors,
                indexWork,
                originalIncidence: originalOccurrences.length,
                maintainedIncidence: topic.snapshot?.occurrences.length ?? 0,
                topicNodes: topic.snapshot?.nodes.length ?? 0,
                counters: structuredClone(receipt.counters),
                readOperations: snapshotQualification?.summary,
            };
            receipt.beforeClose = diagnostic;
            await writeJson(
                path.join(runDirectory, "initial-stop-snapshot.json"),
                {
                    ...diagnostic,
                    snapshot,
                    stored,
                    buildJobs: jobs,
                    sources,
                    topic,
                    originalOccurrences,
                },
            );
        };
        const factory = options.indexFactory;
        options.indexFactory = (id, directory) => {
            const index = factory(id, directory);
            indexes.set(directory, index);
            return index;
        };
        const open = () => new FileMemoryService(store, options);
        const admitOfflineWork = async () => {
            service = open();
            await service.initialize();
            receipt.compiledContract = {
                topic: typeof service.queryTopics === "function",
                synopsis: typeof service.getSourceSynopsis === "function",
                consolidation: spec.p6
                    ? typeof TypedViewStore.prototype
                          .acceptWikiConsolidation === "function"
                    : "PENDING exact runtime contract and verified P6 checkpoint",
                scope: spec.p6
                    ? "Current verified P6 compiled output; no recompile"
                    : "Verified P5 compiled output; no recompile in preparation",
            };
            assert.ok(
                receipt.compiledContract.topic &&
                    receipt.compiledContract.synopsis,
            );
            if (!receipt.corpusId) {
                receipt.corpusId = (
                    await service.createCorpus(
                        "Isolated offline maintenance qualification",
                    )
                ).corpusId;
                await persist();
            }
            const corpusId = receipt.corpusId;
            const admittedEpochMs = Date.now();
            workDeadline = admittedEpochMs + spec.workAllowanceMs;
            await writeJson(path.join(runDirectory, "admitted.json"), {
                receiptId: spec.receiptId,
                workerPid: process.pid,
                admittedEpochMs,
                workDeadlineEpochMs: workDeadline,
                ...(receipt.checkpointGuard
                    ? {
                          checkpointExpectationHash:
                              receipt.checkpointGuard.expectationHash,
                          compiledHashesHash:
                              receipt.checkpointGuard.compiledHashesHash,
                      }
                    : {}),
            });
            return corpusId;
        };
        const corpusId = await admitOfflineWork();
        const checkDeadline = () => {
            performanceTrace?.check();
            initialStop?.check();
            if (snapshotQualification?.summary.violations.length)
                throw new Error(
                    "Snapshot qualification exceeded one hydration per chosen read operation",
                );
            if (Date.now() >= workDeadline - (performanceTrace ? 120000 : 0)) {
                const error = new Error(
                    "Admitted-work watchdog allowance exhausted; corpus limit not inferred",
                );
                error.name = "TimeoutError";
                throw error;
            }
        };
        const guard = (action) =>
            guardHeadRequest(action, {
                checkDeadline,
                isStale: (error) => error instanceof ViewBuildStaleError,
                onDiagnostic: (diagnostic) => receipt.errors.push(diagnostic),
                onSuccessfulReturn: (proof) =>
                    (receipt.successfulRequestReturns ??= []).push(proof),
            });
        const control = async (family, operation) =>
            guard(async () =>
                service.maintainViews({
                    corpusId,
                    family,
                    operation,
                    expectedHead: (await service.listViews(corpusId)).head,
                }),
            );
        const waitBuild = async (job) => {
            while (job.state === "running") {
                checkDeadline();
                await delay(30);
                job = await service.getViewBuild({
                    corpusId,
                    jobId: job.jobId,
                });
                assert.ok(job, "Admitted build missing unexpectedly");
            }
            return job;
        };
        const settled = async () => {
            let stable = 0;
            while (stable < 3) {
                checkDeadline();
                const snapshot = await service.listViews(corpusId);
                const jobs = await service.listViewBuilds(corpusId);
                assertTerminalJobs(jobs, receipt.actions.conflictResolution);
                const sources = await service.listSources(corpusId);
                const topic = await new TypedViewStore(store).getTopicState(
                    corpusId,
                );
                const pending =
                    jobs.some((job) => job.state === "running") ||
                    (snapshot.wikiFamily?.enabled &&
                        snapshot.wikiFamily.pending) ||
                    (snapshot.projectFamily?.enabled &&
                        snapshot.projectFamily.pending) ||
                    (topic.family.enabled && topic.family.dirty) ||
                    sources.some(
                        (source) =>
                            source.revisions.find(
                                (revision) =>
                                    revision.revisionId ===
                                    source.activeRevisionId,
                            )?.synopsis?.status === "pending",
                    );
                const readiness = initialReadiness(
                    snapshot,
                    jobs,
                    sources,
                    topic,
                );
                if (
                    initialStop &&
                    (spec.qualification || receipt.phase === "initial")
                ) {
                    initialStop.check();
                    receipt.initialReadiness = readiness;
                    if (readiness.errors.length || !readiness.enabled)
                        throw new Error(
                            `Maintenance status is not ready: ${JSON.stringify(readiness)}`,
                        );
                }
                stable = pending ? 0 : stable + 1;
                controls.onEvent("settle", "OBSERVED", {
                    pending,
                    stable,
                    wiki: snapshot.wikiFamily,
                    projects: snapshot.projectFamily,
                    topic: topic.family,
                    jobs: jobs
                        .filter((job) => job.state === "running")
                        .map((job) => ({
                            jobId: job.jobId,
                            results: job.results.map((result) => ({
                                viewId: result.viewId,
                                state: result.state,
                                reason: result.reason,
                                stage: result.wikiConsolidation?.stage,
                            })),
                            sourceCount: sources.length,
                            terminalResults: jobs
                                .filter((job) => job.state !== "running")
                                .map((job) => ({
                                    jobId: job.jobId,
                                    state: job.state,
                                    results: job.results.map((result) => ({
                                        viewId: result.viewId,
                                        state: result.state,
                                        reason: result.reason,
                                    })),
                                })),
                        })),
                });
                await delay(50);
            }
        };
        const recoverCanonicalCrash = async () => {
            if (
                spec.p6 &&
                receipt.actions.crash &&
                !receipt.actions.crashRecovery
            ) {
                const crash = receipt.actions.crash;
                await settled();
                const recovered = await verifyConsolidation(service, corpusId);
                assert.equal(recovered.jobId, crash.jobId);
                assert.equal(recovered.currentRevisionId, crash.revisionId);
                const history = await service.getViewHistory({
                    corpusId,
                    viewId: crash.viewId,
                });
                assert.equal(
                    history.filter(
                        (entry) =>
                            entry.version.revisionId === crash.revisionId,
                    ).length,
                    1,
                    "Committed canonical revision must recover exactly once",
                );
                assert.equal(
                    receipt.counters.callsByView[crash.viewId],
                    crash.targetSynthesisCalls,
                    "Committed survivor must not be synthesized again during recovery",
                );
                assert.equal(
                    receipt.counters.consolidationActual,
                    crash.counters.consolidationActual,
                    "Accepted output must not be judged again during recovery",
                );
                const snapshot = await service.listViews(corpusId);
                const counts = structuredClone(receipt.counters);
                const revisions = snapshot.views
                    .map((view) => view.revisionId)
                    .sort();
                await service.close();
                service = open();
                await service.initialize();
                await settled();
                const second = await service.listViews(corpusId);
                assert.equal(second.head, snapshot.head);
                assert.deepEqual(
                    second.views.map((view) => view.revisionId).sort(),
                    revisions,
                );
                assert.deepEqual(
                    receipt.counters,
                    counts,
                    "Second settled recovery must make zero extra model calls",
                );
                receipt.actions.crashRecovery = {
                    boundary: crash.boundary,
                    ...recovered,
                    exactAcceptedRevisionCount: 1,
                    recoveredBeforeFurtherSourceChanges: true,
                    committedSurvivorExtraSynthesisCalls: 0,
                    committedOutputExtraJudgmentCalls: 0,
                    committedPairExtraPurposeCalls: 0,
                    otherPendingWorkPurposeCalls:
                        counts.consolidationPurpose -
                        crash.counters.consolidationPurpose,
                    secondRestart: {
                        sameHead: true,
                        sameRevisions: true,
                        extraModelCalls: 0,
                    },
                };
                receipt.checks.push({
                    name: "actual-process-crash-canonical-before-alias-index-ack-recovery",
                    cases: ["C4", "C11"],
                    status: "PASS_OFFLINE",
                    ...receipt.actions.crashRecovery,
                });
                await persist();
            }
        };
        await recoverCanonicalCrash();
        const snapshotStage = async (phase) => {
            await settled();
            const sources = await service.listSources(corpusId);
            const snapshot = await service.listViews(corpusId);
            const jobs = await service.listViewBuilds(corpusId);
            const viewStore = new TypedViewStore(store);
            const topic = await viewStore.getTopicState(corpusId);
            const scene = await service.queryTopics({
                corpusId,
                pageSize: 1,
                depth: 0,
            });
            const complete = await service.queryTopics({
                corpusId,
                pageSize: 200,
                depth: 0,
            });
            const publications = [];
            const citations = [];
            const sourceIds = new Set(sources.map((source) => source.sourceId));
            for (const view of snapshot.views) {
                publications.push(
                    await service.getViewPublication({
                        corpusId,
                        viewId: view.viewId,
                    }),
                );
                for (const citation of view.content.citations) {
                    checkDeadline();
                    assert.ok(sourceIds.has(citation.sourceId));
                    const content = await service.getSourceContent({
                        corpusId,
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                        indexedLocator: citation.locator,
                    });
                    assert.equal(content.content, citation.excerpt);
                    citations.push({
                        viewId: view.viewId,
                        ...citation,
                        exact: true,
                    });
                }
            }
            const wiki = await viewStore.getWikiFamily(corpusId);
            const project = await viewStore.getWikiFamily(corpusId, "projects");
            const runtimeIndexes = [...indexes.entries()].filter(
                ([directory]) =>
                    !directory.includes("view-search-index") &&
                    !directory.includes("event-search-index"),
            );
            const subjects = [];
            let originalOccurrences = [];
            for (const [_directory, index] of runtimeIndexes.reverse()) {
                const occurrences = await index.getTopicOccurrences(sourceIds);
                if (
                    occurrences.length &&
                    occurrences.every(
                        (entry) =>
                            sources.find(
                                (source) => source.sourceId === entry.sourceId,
                            )?.activeRevisionId === entry.revisionId,
                    )
                ) {
                    originalOccurrences = occurrences;
                    let offset = 0;
                    while (true) {
                        const page = await index.listSubjects(
                            offset,
                            48,
                            sourceIds,
                        );
                        subjects.push(...page.items);
                        offset += page.items.length;
                        if (offset >= page.total || !page.items.length) break;
                    }
                    break;
                }
            }
            if (topic.snapshot) {
                assert.deepEqual(
                    topic.snapshot.occurrences.map((entry) => entry.id).sort(),
                    originalOccurrences.map((entry) => entry.id).sort(),
                    "Maintained occurrence IDs must match complete actual current index",
                );
                assert.equal(scene.totalNodes, topic.snapshot.nodes.length);
                assert.equal(complete.totalNodes, scene.totalNodes);
                for (const node of topic.snapshot.nodes)
                    for (const citation of node.citations) {
                        const source = await service.getSourceContent({
                            corpusId,
                            sourceId: citation.sourceId,
                            revisionId: citation.revisionId,
                            indexedLocator: citation.locator,
                        });
                        assert.equal(source.content, citation.excerpt);
                    }
            }
            const data = {
                phase,
                activeSources: sources.length,
                sourceIds: [...sourceIds],
                snapshot,
                jobs,
                publications,
                citations,
                topic,
                scene,
                originalOccurrences,
                familyStates: { wiki, projects: project },
                wikiProgress: measureProgress(
                    wiki,
                    jobs,
                    publications,
                    subjects,
                ),
                projectProgress: measureProgress(
                    project,
                    jobs.filter((job) =>
                        job.results.some(
                            (result) =>
                                result.snapshot.definition.projectSummary,
                        ),
                    ),
                    publications,
                    subjects,
                ),
                counters: structuredClone(receipt.counters),
                indexWorkSize: runtimeIndexes.map(([directory, index]) => ({
                    directory,
                    messages: index.memory?.messages.length,
                    semanticRefs: index.memory?.semanticRefs.length,
                })),
            };
            await writeJson(path.join(runDirectory, `${phase}.json`), data);
            const stageReceipt = {
                activeSources: sources.length,
                views: snapshot.views.length,
                citations: citations.length,
                totalTopics: scene.totalNodes,
                displayedTopics: scene.nodes.length,
                head: snapshot.head,
                revisions: snapshot.views.map((view) => view.revisionId).sort(),
                wikiProgress: data.wikiProgress,
                counters: data.counters,
            };
            receipt.checks.push({
                name: `${phase}-exact-citations-and-complete-incidence`,
                cases: ["C1", "C3"],
                status: "PASS_OFFLINE",
                citations: citations.length,
                originalOccurrences: originalOccurrences.length,
                maintainedOccurrences: topic.snapshot?.occurrences.length ?? 0,
            });
            const worksheet = sources.find(
                (source) =>
                    source.sourceId ===
                    receipt.mappings["sb-pool-worksheet"]?.sourceId,
            );
            if (worksheet) {
                const synopsis = await service.getSourceSynopsis({
                    corpusId,
                    sourceId: worksheet.sourceId,
                });
                const occurrence = originalOccurrences.find(
                    (entry) =>
                        entry.sourceId === worksheet.sourceId &&
                        entry.citations
                            .map((citation) => citation.excerpt)
                            .join("")
                            .includes("Governing tail exception:"),
                );
                assert.ok(
                    occurrence,
                    "Governing worksheet tail must occur in actual indexed block",
                );
                const full = occurrence.citations[0];
                const blockText = occurrence.citations
                    .map((citation) => citation.excerpt)
                    .join("");
                let covered = 0;
                for (const citation of occurrence.citations) {
                    const part = parseIndexedLocator(citation.locator);
                    assert.equal(part.start, covered);
                    covered = part.end;
                }
                assert.equal(covered, blockText.length);
                const range = parseIndexedLocator(full.locator);
                assert.equal(
                    range.start,
                    0,
                    "Expected original full-block incidence citation",
                );
                const start = blockText.indexOf("Governing tail exception:");
                const end = start + 822;
                const locator = indexedLocator(
                    {
                        sourceId: full.sourceId,
                        revisionId: full.revisionId,
                        blockOrdinal: range.blockOrdinal,
                        text: blockText,
                        score: 1,
                    },
                    start,
                    end,
                );
                const resolved = await service.getSourceContent({
                    corpusId,
                    sourceId: full.sourceId,
                    revisionId: full.revisionId,
                    indexedLocator: locator,
                });
                assert.equal(resolved.content, blockText.slice(start, end));
                assert.equal(synopsis.status, "ready");
                assert.ok(
                    synopsis.overview.includes("Governing tail exception:"),
                );
                receipt.checks.push({
                    name: `${phase}-actual-indexed-tail-and-synopsis`,
                    cases: ["C1"],
                    status: "PASS_OFFLINE",
                    sourceId: worksheet.sourceId,
                    revisionId: worksheet.activeRevisionId,
                    locator,
                    indexedTailChars: resolved.content.length,
                    retainedScannedChars: synopsis.coverage.scannedChars,
                    limits: synopsis.limitations,
                });
            }
            receipt.stages[phase] = stageReceipt;
            await persist();
            return data;
        };
        const plan = await loadPlan(spec.fixtureRoot);
        const planHash = sha(JSON.stringify(plan));
        if (receipt.planHash)
            assert.equal(
                receipt.planHash,
                planHash,
                "Fixture plan changed; request a new isolated qualification checkpoint",
            );
        receipt.planHash = planHash;
        if (performanceTrace)
            await writeJson(
                path.join(runDirectory, "initial-operation-ledger.json"),
                plan.filter(
                    (entry) =>
                        phases.indexOf(entry.phase) <=
                        phases.indexOf("initial"),
                ),
            );
        const page = (data, query) => {
            const view = data.snapshot.views.find(
                (entry) =>
                    (
                        entry.definition.wiki ?? entry.definition.projectSummary
                    )?.query.toLowerCase() === query.toLowerCase(),
            );
            assert.ok(view, `Actual runtime ${query} page missing`);
            return view;
        };
        const save = async (view, content, extra = {}) =>
            guard(async () =>
                service.saveViewDraft({
                    corpusId,
                    viewId: view.viewId,
                    expectedVersion: view.version,
                    expectedHead: (await service.listViews(corpusId)).head,
                    definition: derivedDefinitionInput(view),
                    content,
                    relationships: authoredRelationships(view),
                    ...extra,
                }),
            );
        const build = async (view, suffix) => {
            const definition = derivedDefinitionInput(view);
            (definition.wiki ?? definition.projectSummary).aliases.push(suffix);
            return waitBuild(
                await guard(async () =>
                    service.buildViews({
                        corpusId,
                        expectedHead: (await service.listViews(corpusId)).head,
                        targets: [
                            { definition, expectedVersion: view.version },
                        ],
                    }),
                ),
            );
        };
        const scopedTargets = async (phase) => {
            if (!["initial", "t1", "t2"].includes(phase)) return;
            receipt.actions.scopedTargets ??= { targets: {}, stages: {} };
            receipt.actions.scopedTargets.profiles ??= {};
            const definitions = [
                {
                    key: "worksheet",
                    sourceKey: "sb-pool-worksheet",
                    query: spec.p6
                        ? "Governing tail exception"
                        : "worksheet command governing tail exception",
                    aliases: [],
                    kind: "wiki",
                },
                {
                    key: "orders",
                    sourceKey: "sb-overlap-handoff",
                    query: "Orders",
                    kind: "projectBrief",
                },
                {
                    key: "identity",
                    sourceKey: "sb-overlap-handoff",
                    query: "Identity",
                    kind: "projectBrief",
                },
            ];
            const accepted = [];
            for (const target of definitions) {
                if (phase === "initial" && target.kind === "projectBrief") {
                    accepted.push({
                        key: target.key,
                        status: "PENDING_SCOPE_CLARIFICATION",
                        scope: "Initial handoff does not name either project; no unsupported scoped project input is invented",
                    });
                    continue;
                }
                const ref = receipt.mappings[target.sourceKey];
                const profile =
                    receipt.actions.scopedTargets.profiles[target.key];
                const reuseNaturalWorksheet = async () => {
                    if (
                        spec.p6 &&
                        target.key === "worksheet" &&
                        profile?.kind !== "explicit-diagnostic"
                    ) {
                        const snapshot = await service.listViews(corpusId);
                        const currentSources =
                            await service.listSources(corpusId);
                        const source = currentSources.find(
                            (entry) => entry.sourceId === ref.sourceId,
                        );
                        const family = await new TypedViewStore(
                            store,
                        ).getWikiFamily(corpusId);
                        const matchingMembers = new Set(
                            snapshot.views
                                .filter(
                                    (view) =>
                                        view.definition.wiki?.query.toLocaleLowerCase() ===
                                        target.query.toLocaleLowerCase(),
                                )
                                .flatMap(
                                    (view) => view.definition.selector.sources,
                                )
                                .map((entry) => entry.sourceId),
                        );
                        for (const member of currentSources)
                            if (matchingMembers.has(member.sourceId)) {
                                const synopsis =
                                    await service.getSourceSynopsis({
                                        corpusId,
                                        sourceId: member.sourceId,
                                    });
                                assert.equal(
                                    synopsis.status,
                                    "ready",
                                    "C1 member is suppressed",
                                );
                                assert.equal(
                                    synopsis.revisionId,
                                    member.activeRevisionId,
                                );
                            }
                        const currentHead = (await service.listViews(corpusId))
                            .head;
                        const natural = selectGroundedC1View(
                            snapshot,
                            source,
                            ref,
                            target.query,
                            currentHead,
                            receipt.actions.scopedTargets.targets[target.key],
                            {
                                currentSources,
                                defaultViewIds: family.descriptors.map(
                                    (entry) => entry.viewId,
                                ),
                            },
                        );
                        if (natural) {
                            const definitionBefore = structuredClone(
                                natural.definition,
                            );
                            const publication =
                                await service.getViewPublication({
                                    corpusId,
                                    viewId: natural.viewId,
                                });
                            assert.equal(publication.indexState, "ready");
                            assert.equal(
                                publication.indexedRevisionId,
                                natural.revisionId,
                            );
                            const entry = plan.find(
                                (operation) =>
                                    operation.sourceKey === target.sourceKey &&
                                    operation.phase === phase,
                            );
                            assert.ok(
                                entry,
                                "C1 immutable current worksheet fixture missing",
                            );
                            assert.equal(entry.sha256, ref.revisionId);
                            assert.equal(
                                sha(await readFile(entry.file, "utf8")),
                                entry.sha256,
                            );
                            for (const citation of [
                                ...natural.content.citations,
                                ...natural.generation.input.inputs.flatMap(
                                    (input) => input.passages,
                                ),
                            ]) {
                                const resolved = await service.getSourceContent(
                                    {
                                        corpusId,
                                        sourceId: citation.sourceId,
                                        revisionId: citation.revisionId,
                                        indexedLocator: citation.locator,
                                    },
                                );
                                assert.equal(
                                    resolved.content,
                                    citation.excerpt,
                                );
                            }
                            const tail = await verifyTailArticle(
                                service,
                                corpusId,
                                natural.viewId,
                                entry.file,
                                ref,
                            );
                            assert.equal(tail.sourceId, ref.sourceId);
                            assert.equal(tail.sourceRevisionId, ref.revisionId);
                            assert.equal(
                                (await service.listViews(corpusId)).head,
                                snapshot.head,
                            );
                            assert.deepEqual(
                                natural.definition,
                                definitionBefore,
                            );
                            const after = await service.getView({
                                corpusId,
                                viewId: natural.viewId,
                            });
                            assert.equal(after.version, natural.version);
                            assert.equal(after.revisionId, natural.revisionId);
                            assert.deepEqual(
                                after.protectedTargets,
                                natural.protectedTargets,
                            );
                            receipt.actions.scopedTargets.profiles[target.key] =
                                {
                                    kind: "natural-default",
                                    viewId: natural.viewId,
                                    sourceKey: target.sourceKey,
                                };
                            receipt.actions.scopedTargets.targets[target.key] =
                                natural.viewId;
                            accepted.push({
                                key: target.key,
                                viewId: natural.viewId,
                                revisionId: natural.revisionId,
                                sourceId: ref.sourceId,
                                sourceRevisionId: ref.revisionId,
                                tailMarker: true,
                                defaultReused: true,
                                definitionUnchanged: true,
                                sourceFollowedNaturally: true,
                                profile: "natural-default",
                                memberCount:
                                    natural.definition.selector.sources.length,
                                scope: "Unique grounded natural default; read-only current article/citation assertion, no explicit build or definition write",
                            });
                            receipt.checks.push({
                                name: `${phase}-actual-article-full-tail-and-resolved-original-citation`,
                                cases: ["C1"],
                                status: "PASS_OFFLINE",
                                defaultReused: true,
                                definitionUnchanged: true,
                                ...tail,
                            });
                            return true;
                        }
                    }
                    return false;
                };
                if (await reuseNaturalWorksheet()) continue;
                const viewId = (receipt.actions.scopedTargets.targets[
                    target.key
                ] ??= randomUUID());
                receipt.actions.scopedTargets.profiles[target.key] = {
                    kind: "explicit-diagnostic",
                    viewId,
                    sourceKey: target.sourceKey,
                };
                const current = await new TypedViewStore(store).getView({
                    corpusId,
                    viewId,
                });
                const selector = {
                    construction:
                        target.kind === "wiki"
                            ? "informational-wiki-v1"
                            : "informational-project-summary-v1",
                    query: target.query,
                    aliases: target.aliases ?? [],
                    excludedSourceIds: [],
                };
                const definition = {
                    viewId,
                    kind: target.kind,
                    selector: {
                        kind: "sources",
                        sources: [
                            {
                                sourceId: ref.sourceId,
                                revisionId: ref.revisionId,
                            },
                        ],
                    },
                    ...(target.kind === "wiki"
                        ? { wiki: selector }
                        : { projectSummary: selector }),
                };
                const job = await waitBuild(
                    await guard(async () =>
                        service.buildViews({
                            corpusId,
                            expectedHead: (await service.listViews(corpusId))
                                .head,
                            targets: [
                                {
                                    definition,
                                    expectedVersion: current?.version ?? 0,
                                },
                            ],
                        }),
                    ),
                );
                const result = job.results.find(
                    (entry) => entry.viewId === viewId,
                );
                assert.ok(
                    [
                        "draft",
                        "merged",
                        "published",
                        "searchable",
                        "skipped",
                    ].includes(result.state),
                    JSON.stringify({
                        target: target.key,
                        state: result.state,
                        reason: result.reason,
                    }),
                );
                const view = await service.getView({ corpusId, viewId });
                assert.ok(view);
                assert.ok(
                    view.content.citations.every(
                        (citation) =>
                            citation.sourceId === ref.sourceId &&
                            citation.revisionId === ref.revisionId,
                    ),
                );
                const prose = view.content.sections
                    .map((section) => section.body)
                    .join("\n");
                accepted.push({
                    key: target.key,
                    viewId,
                    revisionId: view.revisionId,
                    jobId: job.jobId,
                    sourceId: ref.sourceId,
                    sourceRevisionId: ref.revisionId,
                    tailMarker: prose.includes("Governing tail exception:"),
                    median38Text: prose.includes("38 ms"),
                    median41Text: prose.includes("41 ms"),
                    withdrawalText: prose.includes("withdrawn"),
                    scope: "Explicit API selector and copied supplied indexed evidence; semantic interpretation PENDING",
                });
                if (spec.p6 && target.key === "worksheet") {
                    const entry = plan.find(
                        (operation) =>
                            operation.sourceKey === target.sourceKey &&
                            operation.phase === phase,
                    );
                    const tail = await verifyTailArticle(
                        service,
                        corpusId,
                        viewId,
                        entry.file,
                    );
                    receipt.checks.push({
                        name: `${phase}-actual-article-full-tail-and-resolved-original-citation`,
                        cases: ["C1"],
                        status: "PASS_OFFLINE",
                        ...tail,
                    });
                }
            }
            receipt.actions.scopedTargets.stages[phase] = accepted;
            const worksheet = accepted.find(
                (target) => target.key === "worksheet",
            );
            if (worksheet && !worksheet.tailMarker) {
                const pending =
                    "C1 scoped article selected-evidence tail not exercised; indexed tail/synopsis are verified separately";
                if (!receipt.pending.includes(pending))
                    receipt.pending.push(pending);
            }
            await persist();
        };
        const executeFixtureTimeline = async () => {
            for (const phase of phases) {
                if (
                    spec.performance &&
                    phases.indexOf(phase) > phases.indexOf("initial")
                )
                    break;
                if (
                    receipt.stages[phase] &&
                    (phase !== "initial" || receipt.actions.protection) &&
                    (phase !== "t1" || receipt.actions.conflict)
                )
                    continue;
                receipt.phase = phase;
                controls.onEvent("phase", "ENTER", {
                    stage: phase,
                    counters: structuredClone(receipt.counters),
                });
                await persist();
                for (const family of families) await control(family, "pause");
                const applyPhaseSources = async () => {
                    for (const entry of plan.filter(
                        (operation) => operation.phase === phase,
                    )) {
                        checkDeadline();
                        const prior = receipt.mappings[entry.sourceKey];
                        if (prior?.fixtureRevision === entry.revision) {
                            const actual = await service.getSource(
                                corpusId,
                                prior.sourceId,
                            );
                            assert.equal(
                                actual?.activeRevisionId,
                                prior.revisionId,
                                "Resume mapping must match actual retained active revision",
                            );
                            continue;
                        }
                        assert.equal(
                            prior?.fixtureRevision ?? null,
                            entry.replacesRevision,
                        );
                        const text = await readFile(entry.file, "utf8");
                        assert.equal(sha(text), entry.sha256);
                        const actualMatches = (
                            await service.listSources(corpusId)
                        ).filter(
                            (source) =>
                                source.canonicalUri === entry.canonicalUri,
                        );
                        assert.ok(
                            actualMatches.length <= 1,
                            "Canonical source identity is not unique",
                        );
                        const actualSource = actualMatches[0];
                        const actualRevision = actualSource?.revisions.find(
                            (revision) =>
                                revision.revisionId ===
                                actualSource.activeRevisionId,
                        );
                        if (actualRevision?.contentHash === entry.sha256) {
                            assert.equal(
                                actualRevision.state,
                                "ready",
                                "Resume must not treat a partial indexed revision as applied",
                            );
                            receipt.mappings[entry.sourceKey] = {
                                sourceId: actualSource.sourceId,
                                revisionId: actualRevision.revisionId,
                                fixtureRevision: entry.revision,
                                canonicalUri: entry.canonicalUri,
                            };
                            receipt.operations.push({
                                phase,
                                sourceKey: entry.sourceKey,
                                fixtureRevision: entry.revision,
                                previousRevisionId: prior?.revisionId,
                                sourceId: actualSource.sourceId,
                                revisionId: actualRevision.revisionId,
                                fixtureSha256: entry.sha256,
                                recovery:
                                    "Actual ready source commit recovered before audit acknowledgement; no repeated ingestion",
                            });
                            await persist();
                            continue;
                        }
                        const source = {
                            sourceType: "markdown",
                            title: path.basename(entry.file, ".md"),
                            canonicalUri: entry.canonicalUri,
                            text,
                        };
                        const admitted = prior
                            ? await service.replaceSource({
                                  corpusId,
                                  sourceId: prior.sourceId,
                                  expectedActiveRevisionId: prior.revisionId,
                                  source,
                              })
                            : await service.ingestDocument({
                                  corpusId,
                                  source,
                              });
                        const job = await waitForMemoryJob(
                            service,
                            admitted.jobId,
                            {
                                signal: AbortSignal.timeout(
                                    Math.max(1, workDeadline - Date.now()),
                                ),
                                pollIntervalMs: 20,
                            },
                        );
                        assert.equal(
                            job.state,
                            "complete",
                            JSON.stringify(job),
                        );
                        receipt.mappings[entry.sourceKey] = {
                            sourceId: admitted.sourceId,
                            revisionId: admitted.revisionId,
                            fixtureRevision: entry.revision,
                            canonicalUri: entry.canonicalUri,
                        };
                        receipt.operations.push({
                            phase,
                            sourceKey: entry.sourceKey,
                            fixtureRevision: entry.revision,
                            previousRevisionId: prior?.revisionId,
                            ...admitted,
                            fixtureSha256: entry.sha256,
                        });
                        await persist();
                    }
                };
                await applyPhaseSources();
                for (const family of families) await control(family, "resume");
                await settled();
                await scopedTargets(phase);
                const data = await snapshotStage(phase);
                controls.onEvent("phase", "SNAPSHOT", {
                    stage: phase,
                    activeSources: data.activeSources,
                    indexWorkSize: data.indexWorkSize,
                    counters: structuredClone(receipt.counters),
                });
                const qualifyPhaseActions = async () => {
                    if (spec.p6 && phase === "t1") {
                        const gate = await readCanonicalQualification(
                            service,
                            corpusId,
                        );
                        receipt.actions.naturalCanonical = gate;
                        if (gate.status === "READY") {
                            receipt.actions.p6Consolidation = gate.evidence;
                            receipt.checks.push({
                                name: "actual-P6-same-purpose-merge-old-ID-anchor-exact-citations-ready",
                                cases: ["C4", "C11"],
                                status: "PASS_OFFLINE",
                                ...gate.evidence,
                            });
                        } else {
                            receipt.pending.push(
                                "Natural full-corpus canonical merge NOT_EXERCISED; separate positive mechanism and real-model semantics are distinct gates",
                            );
                            receipt.checks.push({
                                name: "natural-full-corpus-canonical",
                                cases: ["C4", "C11"],
                                status: "NOT_EXERCISED",
                                ...gate,
                            });
                        }
                        await persist();
                    }
                    if (phase === "initial") {
                        const lease = page(data, "lease");
                        const edited = structuredClone(lease.content);
                        edited.title = "My deliberate isolated lease review";
                        edited.sections[0].details.note =
                            "Personal synthetic review annotation";
                        const accepted = await save(lease, edited);
                        assert.equal(accepted.version.provenance, "human");
                        assert.ok(
                            editorialProtection(accepted.version).includes(
                                "title",
                            ),
                        );
                        receipt.actions.protection =
                            recordOwnedFixtureProtection(
                                accepted.version,
                                edited.sections[0].id,
                                editorialProtection,
                            );
                        await persist();
                    }
                    if (phase === "t1") {
                        const lease = page(data, "lease");
                        assert.equal(
                            lease.content.title,
                            receipt.actions.protection.title,
                        );
                        assert.equal(
                            lease.content.sections[0].details.note,
                            receipt.actions.protection.note,
                        );
                        controls.overlapQuery = "lease";
                        const conflictJob = await build(
                            lease,
                            "offline genuine protected overlap",
                        );
                        delete controls.overlapQuery;
                        const result = conflictJob.results.find(
                            (entry) => entry.conflictId,
                        );
                        assert.ok(
                            result,
                            JSON.stringify(
                                conflictJob.results.map((entry) => ({
                                    state: entry.state,
                                    reason: entry.reason,
                                })),
                            ),
                        );
                        const conflict = await service.getViewConflict({
                            corpusId,
                            conflictId: result.conflictId,
                        });
                        assert.ok(conflict.targets.includes("title"));
                        receipt.actions.conflict = {
                            purpose: "owned-T1-title-overlap",
                            corpusId,
                            viewId: lease.viewId,
                            jobId: conflictJob.jobId,
                            jobActor: conflictJob.actor,
                            inputActor: conflict.input.actor,
                            generatorActor: "memory-view-generator",
                            conflictId: result.conflictId,
                            inputFingerprint: conflict.input.fingerprint,
                            expectedVersion: conflict.human.version,
                            expectedRevisionId: conflict.expectedRevisionId,
                            targets: conflict.targets,
                            independentChangedViews: data.snapshot.views
                                .filter(
                                    (view) =>
                                        !receipt.stages.initial.revisions.includes(
                                            view.revisionId,
                                        ) && view.viewId !== lease.viewId,
                                )
                                .map((view) => view.viewId),
                        };
                        assert.ok(
                            receipt.actions.conflict.independentChangedViews
                                .length,
                        );
                        await persist();
                        receipt.actions.conflictResolution =
                            await resolveOwnedFixtureConflict(
                                createMemoryServiceRpcFacade(service),
                                corpusId,
                                receipt.actions.conflict,
                                receipt.actions.protection,
                                editorialProtection,
                                viewHash,
                            );
                        await settled();
                        receipt.checks.push({
                            name: "authenticated-protection-and-real-overlap",
                            cases: ["C7"],
                            status: "PASS_OFFLINE",
                            ...receipt.actions.conflict,
                            resolution: receipt.actions.conflictResolution,
                        });
                        await persist();
                    }
                };
                await qualifyPhaseActions();
                controls.onEvent("phase", "EXIT", {
                    stage: phase,
                    counters: structuredClone(receipt.counters),
                });
                if (spec.performance && phase === "initial") {
                    if (initialStop) await settled();
                    checkDeadline();
                    if (initialStop)
                        assert.equal(
                            receipt.initialReadiness?.ready,
                            true,
                            "Initial completion requires all enabled families ready",
                        );
                    receipt.outcome =
                        "OFFLINE_FULL_INITIAL_DIAGNOSTIC_COMPLETED";
                    receipt.pending.push(
                        "T1/T2/full final qualification outside performance diagnosis scope",
                    );
                    await persist();
                    return true;
                }
            }
            return false;
        };
        if (await executeFixtureTimeline()) return receipt;
        const qualifyExternalForget = async () => {
            if (!receipt.stages["t2-forgotten"]) {
                receipt.phase = "external-forget";
                if (receipt.actions.forget) {
                    const forgotten = receipt.actions.forget;
                    assert.equal(
                        await service.getSource(corpusId, forgotten.sourceId),
                        undefined,
                    );
                    assert.equal(
                        await service.getView({
                            corpusId,
                            viewId: forgotten.viewId,
                        }),
                        undefined,
                    );
                    assert.deepEqual(
                        await service.getViewHistory({
                            corpusId,
                            viewId: forgotten.viewId,
                        }),
                        [],
                    );
                    assert.equal(
                        await service.getViewBuild({
                            corpusId,
                            jobId: forgotten.heldJobId,
                        }),
                        undefined,
                    );
                    await snapshotStage("t2-forgotten");
                    receipt.checks.push({
                        name: "authorized-forget-acknowledgement-resume",
                        cases: ["C8"],
                        status: "PASS_OFFLINE",
                        sourceId: forgotten.sourceId,
                        repeatedForgetCalls: 0,
                    });
                    await persist();
                } else {
                    const before = await snapshotStage("t2-before-forget");
                    const routing = page(before, "routing");
                    const protectedContent = structuredClone(routing.content);
                    protectedContent.sections[0].details.note =
                        "Protected synthetic routing annotation";
                    const protectedRouting = (
                        await save(routing, protectedContent)
                    ).version;
                    controls.holdQuery = "routing";
                    controls.hold = new Promise((resolve) => {
                        releaseHeld = resolve;
                    });
                    const definition = derivedDefinitionInput(protectedRouting);
                    definition.wiki.aliases.push(
                        "offline held late routing result",
                    );
                    const heldJob = await guard(async () =>
                        service.buildViews({
                            corpusId,
                            expectedHead: (await service.listViews(corpusId))
                                .head,
                            targets: [
                                {
                                    definition,
                                    expectedVersion: protectedRouting.version,
                                },
                            ],
                        }),
                    );
                    while (!controls.entered) {
                        checkDeadline();
                        await delay(20);
                    }
                    const temporary = receipt.mappings["sb-temporary-handoff"];
                    const actualHeld = await service.getViewBuild({
                        corpusId,
                        jobId: heldJob.jobId,
                    });
                    const heldInput = actualHeld.results.find(
                        (result) => result.viewId === routing.viewId,
                    ).snapshot;
                    assert.ok(
                        [
                            ...heldInput.inputs,
                            ...(heldInput.influenceSources ?? []),
                        ].some(
                            (source) =>
                                source.sourceId === temporary.sourceId &&
                                source.revisionId === temporary.revisionId,
                        ),
                        "Held privacy target must actually read the current original being forgotten, not merely carry broad retrieval metadata",
                    );
                    controls.expectedForgetJobId = heldJob.jobId;
                    const preview = await service.previewForgetSource(
                        corpusId,
                        temporary.sourceId,
                    );
                    const forgotten = await service.forgetSource({
                        corpusId,
                        sourceId: temporary.sourceId,
                        confirmationToken: preview.confirmationToken,
                    });
                    receipt.actions.forget = {
                        sourceId: temporary.sourceId,
                        revisionId: temporary.revisionId,
                        viewId: routing.viewId,
                        heldJobId: heldJob.jobId,
                        deletedRevisionCount: forgotten.deletedRevisionCount,
                        indexVersion: forgotten.indexVersion,
                        actionOutcome: "authorized product action completed",
                    };
                    await assert.rejects(
                        service.getSourceContent({
                            corpusId,
                            sourceId: temporary.sourceId,
                        }),
                    );
                    assert.equal(
                        await service.getView({
                            corpusId,
                            viewId: routing.viewId,
                        }),
                        undefined,
                    );
                    releaseHeld();
                    releaseHeld = undefined;
                    delete controls.holdQuery;
                    await settled();
                    assert.equal(
                        await service.getView({
                            corpusId,
                            viewId: routing.viewId,
                        }),
                        undefined,
                    );
                    assert.deepEqual(
                        await service.getViewHistory({
                            corpusId,
                            viewId: routing.viewId,
                        }),
                        [],
                    );
                    const after = await snapshotStage("t2-forgotten");
                    assert.ok(
                        !JSON.stringify(after.topic).includes(
                            temporary.sourceId,
                        ),
                    );
                    receipt.checks.push({
                        name: "privacy-over-protection-and-held-late-result",
                        cases: ["C8"],
                        status: "PASS_OFFLINE",
                        ...receipt.actions.forget,
                    });
                    await persist();
                }
            }
        };
        await qualifyExternalForget();
        const qualifyHistoricalRecovery = async () => {
            assertExactCounts(receipt.stages);
            if (
                Object.values(receipt.actions.scopedTargets?.stages ?? {}).some(
                    (targets) =>
                        targets.some(
                            (target) =>
                                target.key === "worksheet" &&
                                !target.tailMarker,
                        ),
                )
            ) {
                const pending =
                    "C1 scoped article selected-evidence tail not exercised; indexed tail/synopsis are verified separately";
                if (!receipt.pending.includes(pending))
                    receipt.pending.push(pending);
            }
            if (receipt.actions.crash && !receipt.actions.crashRecovery) {
                const crash = receipt.actions.crash;
                const history = await service.getViewHistory({
                    corpusId,
                    viewId: crash.viewId,
                });
                assert.equal(
                    history.filter(
                        (entry) =>
                            entry.version.revisionId === crash.revisionId,
                    ).length,
                    1,
                    "Accepted crash-boundary revision must not be duplicated",
                );
                const publication = await service.getViewPublication({
                    corpusId,
                    viewId: crash.viewId,
                });
                assert.equal(publication.indexState, "ready");
                // Later source revisions legitimately rebuild this target; T1 recovery is recorded separately.
                const t1 = JSON.parse(
                    await readFile(path.join(runDirectory, "t1.json"), "utf8"),
                );
                const recovered = t1.snapshot.views.find(
                    (view) => view.viewId === crash.viewId,
                );
                assert.equal(recovered.revisionId, crash.revisionId);
                assert.equal(
                    t1.counters.callsByView[crash.viewId],
                    crash.targetSynthesisCalls,
                );
                receipt.actions.crashRecovery = {
                    viewId: crash.viewId,
                    acceptedRevisionId: crash.revisionId,
                    exactAcceptedRevisionCount: 1,
                    t1SynthesisCallsForAcceptedTarget: 0,
                    publication,
                };
                receipt.checks.push({
                    name: "actual-process-crash-post-index-preack-recovery",
                    cases: ["C11"],
                    status: "PASS_OFFLINE",
                    ...receipt.actions.crashRecovery,
                });
            }
        };
        await qualifyHistoricalRecovery();
        const qualifyUncitedInfluencePrivacy = async () => {
            if (!receipt.actions.readNotCited) {
                receipt.phase = "separate-read-not-cited-privacy-probe";
                const name =
                    "Separate isolated read-not-cited privacy API probe";
                const priorCorpus = (await service.listCorpora()).find(
                    (corpus) => corpus.name === name,
                );
                const privacyCorpusId =
                    priorCorpus?.corpusId ??
                    (await service.createCorpus(name)).corpusId;
                receipt.actions.readNotCitedSetup = {
                    corpusId: privacyCorpusId,
                };
                await persist();
                const privacyStore = new TypedViewStore(store);
                for (const family of families)
                    await guard(async () =>
                        service.maintainViews({
                            corpusId: privacyCorpusId,
                            family,
                            operation: "pause",
                            expectedHead: (
                                await service.listViews(privacyCorpusId)
                            ).head,
                        }),
                    );
                controls.contextOnlyNeedle = "violet queue";
                const references = {};
                for (const key of [
                    "sb-pool-worksheet",
                    "sb-temporary-handoff",
                ]) {
                    const entry = plan.find(
                        (operation) =>
                            operation.sourceKey === key &&
                            operation.phase === "initial",
                    );
                    const text = await readFile(entry.file, "utf8");
                    const existing = (
                        await service.listSources(privacyCorpusId)
                    ).find(
                        (source) => source.title === path.basename(entry.file),
                    );
                    if (existing) {
                        references[key] = {
                            sourceId: existing.sourceId,
                            revisionId: existing.activeRevisionId,
                        };
                        continue;
                    }
                    const admitted = await service.ingestDocument({
                        corpusId: privacyCorpusId,
                        source: {
                            sourceType: "markdown",
                            title: path.basename(entry.file),
                            text,
                        },
                    });
                    const job = await waitForMemoryJob(
                        service,
                        admitted.jobId,
                        {
                            signal: AbortSignal.timeout(
                                Math.max(1, workDeadline - Date.now()),
                            ),
                            pollIntervalMs: 20,
                        },
                    );
                    assert.equal(job.state, "complete", JSON.stringify(job));
                    references[key] = admitted;
                }
                const worksheetRef = references["sb-pool-worksheet"];
                const contextRef = references["sb-temporary-handoff"];
                controls.topicHold = new Promise((resolve) => {
                    releaseHeld = resolve;
                });
                const resumed = await guard(async () =>
                    service.maintainViews({
                        corpusId: privacyCorpusId,
                        family: "topics",
                        operation: "resume",
                        expectedHead: (await service.listViews(privacyCorpusId))
                            .head,
                    }),
                );
                assert.ok(
                    resumed.job,
                    "Resumed isolated privacy topic family must admit its job",
                );
                const admitted = resumed.job;
                controls.expectedPrivacyJobId = admitted.jobId;
                while (!controls.topicEntered) {
                    checkDeadline();
                    await delay(20);
                }
                const baseline =
                    await privacyStore.getTopicState(privacyCorpusId);
                assert.ok(baseline.snapshot);
                assert.ok(
                    baseline.snapshot.influenceSources.some(
                        (source) => source.sourceId === contextRef.sourceId,
                    ),
                );
                assert.ok(baseline.snapshot.nodes.length);
                assert.ok(
                    baseline.snapshot.nodes.every((node) =>
                        node.citations.every(
                            (citation) =>
                                citation.sourceId === worksheetRef.sourceId,
                        ),
                    ),
                    "Held artifact reads context, but cites only original worksheet evidence",
                );
                const preview = await service.previewForgetSource(
                    privacyCorpusId,
                    contextRef.sourceId,
                );
                const forgotten = await service.forgetSource({
                    corpusId: privacyCorpusId,
                    sourceId: contextRef.sourceId,
                    confirmationToken: preview.confirmationToken,
                });
                releaseHeld();
                releaseHeld = undefined;
                delete controls.topicHold;
                delete controls.contextOnlyNeedle;
                delete controls.topicEntered;
                while (true) {
                    checkDeadline();
                    const jobs = await service.listViewBuilds(privacyCorpusId);
                    const topicState =
                        await privacyStore.getTopicState(privacyCorpusId);
                    if (
                        !jobs.some((job) => job.state === "running") &&
                        !topicState.family.dirty
                    )
                        break;
                    await delay(30);
                }
                assert.equal(
                    await service.getViewBuild({
                        corpusId: privacyCorpusId,
                        jobId: admitted.jobId,
                    }),
                    undefined,
                );
                await assert.rejects(
                    service.getSourceSynopsis({
                        corpusId: privacyCorpusId,
                        sourceId: contextRef.sourceId,
                    }),
                );
                const finalState =
                    await privacyStore.getTopicState(privacyCorpusId);
                assert.ok(
                    !JSON.stringify(finalState).includes(contextRef.sourceId),
                );
                assert.equal(
                    (await service.listSources(privacyCorpusId)).length,
                    1,
                );
                receipt.actions.readNotCited = {
                    corpusId: privacyCorpusId,
                    sourceId: contextRef.sourceId,
                    originalInfluence: baseline.snapshot.influenceSources,
                    acceptedBaselineGeneration: baseline.snapshot.generation,
                    heldJobId: admitted.jobId,
                    deletedRevisionCount: forgotten.deletedRevisionCount,
                    actualSourceCounts: [2, 1],
                    scope: "Separate deterministic extractor control omits context topics; actual API capture/cancel/purge, not model extraction qualification",
                };
                receipt.checks.push({
                    name: "actual-read-but-not-cited-topic-influence-forget-late-denial",
                    cases: ["C8"],
                    status: "PASS_OFFLINE",
                    ...receipt.actions.readNotCited,
                });
                await persist();
            }
        };
        await qualifyUncitedInfluencePrivacy();
        const qualifyUnlockAndRestart = async () => {
            receipt.phase = "unlock-restart-noop";
            const current = await service.listViews(corpusId);
            const lease = current.views.find(
                (entry) => entry.viewId === receipt.actions.protection.viewId,
            );
            assert.ok(lease);
            if (!receipt.actions.unlock) {
                const unlocked = await save(lease, lease.content, {
                    unlockProtection: ["title"],
                });
                assert.equal(unlocked.version.provenance, "human");
                await settled();
                const following = await service.getView({
                    corpusId,
                    viewId: lease.viewId,
                });
                assert.ok(!editorialProtection(following).includes("title"));
                assert.ok(
                    editorialProtection(following).includes(
                        `section:${receipt.actions.protection.noteSectionId}:note`,
                    ),
                );
                assert.equal(
                    following.content.sections.find(
                        (section) =>
                            section.id ===
                            receipt.actions.protection.noteSectionId,
                    )?.details.note,
                    receipt.actions.protection.note,
                );
                receipt.actions.unlock = {
                    viewId: lease.viewId,
                    protectedTargets: editorialProtection(following),
                };
                await persist();
            }
            const beforeRestart = await service.listViews(corpusId);
            const countersBefore = structuredClone(receipt.counters);
            const restarts = [];
            let afterRestart;
            for (let ordinal = 1; ordinal <= 2; ordinal++) {
                await service.close();
                indexes.clear();
                service = open();
                await service.initialize();
                await settled();
                for (const family of families) await control(family, "update");
                await settled();
                afterRestart = await service.listViews(corpusId);
                assert.deepEqual(
                    afterRestart.views.map((view) => view.revisionId).sort(),
                    beforeRestart.views.map((view) => view.revisionId).sort(),
                );
                for (const role of [
                    "article",
                    "topic",
                    "synopsis",
                    "assessment",
                    "editorial",
                    ...(spec.p6
                        ? ["consolidationPurpose", "consolidationActual"]
                        : []),
                ])
                    assert.equal(
                        receipt.counters[role],
                        countersBefore[role],
                        `${role} repeated on settled restart/no-op ${ordinal}`,
                    );
                restarts.push({
                    ordinal,
                    beforeHead: beforeRestart.head,
                    afterHead: afterRestart.head,
                    unchangedRevisions: true,
                    extraModelCalls: 0,
                });
            }
            receipt.checks.push({
                name: "exact-settled-restart-unchanged-repeat",
                cases: ["C11"],
                status: "PASS_OFFLINE",
                revisions: afterRestart.views
                    .map((view) => view.revisionId)
                    .sort(),
                synthesisCalls: 0,
                countersBefore,
                countersAfter: structuredClone(receipt.counters),
                restarts,
            });
            const facade = createMemoryServiceRpcFacade(service);
            await assert.rejects(
                facade.getSourceContent({
                    corpusId,
                    sourceId: receipt.actions.forget.sourceId,
                }),
            );
            const facadeTopics = await facade.queryTopics({
                corpusId,
                pageSize: 1,
            });
            assert.equal(
                facadeTopics.nodes.length,
                Math.min(1, facadeTopics.totalNodes),
            );
            receipt.checks.push({
                name: "actual-RPC-facade-read-and-forget-denial",
                cases: ["C3", "C8"],
                status: "PASS_OFFLINE",
            });
        };
        await qualifyUnlockAndRestart();
        assert.equal(receipt.counters.network, 0);
        assert.equal(receipt.counters.unexpectedCompletion, 0);
        assert.equal(receipt.counters.unexpectedValidation, 0);
        receipt.outcome = completedOfflineOutcome(spec, receipt);
    } catch (error) {
        receipt.outcome =
            error.name === "InitialQualificationStop"
                ? "INITIAL_TARGET_STOPPED"
                : error.name === "TimeoutError"
                  ? "BOUNDED_INCOMPLETE"
                  : "FAILED";
        if (initialStop?.failure()) {
            const { input, ...failure } = initialStop.failure();
            receipt.firstFailure = {
                ...failure,
                inputFingerprint: input?.fingerprint,
            };
        }
        receipt.errors.push({
            phase: receipt.phase,
            ...classifyRequestError(error),
            message: error instanceof Error ? error.message : String(error),
            epochMs: Date.now(),
        });
        process.exitCode = 1;
    } finally {
        const finalizeOfflineRun = async () => {
            initialStop?.freeze();
            const captureFinalParity = async () => {
                if (
                    (spec.stopInitialFailure || spec.qualification) &&
                    service &&
                    captureBeforeClose
                ) {
                    try {
                        await captureBeforeClose();
                        if (
                            [
                                "OFFLINE_FULL_INITIAL_DIAGNOSTIC_COMPLETED",
                                "OFFLINE_T1_T2_MECHANISMS_VERIFIED_SEMANTICS_PENDING",
                                "OFFLINE_T1_T2_TIMELINE_VERIFIED_CANONICAL_NOT_EXERCISED_SEMANTICS_PENDING",
                            ].includes(receipt.outcome) &&
                            (!receipt.beforeClose?.readiness.ready ||
                                receipt.beforeClose.citationErrors.length ||
                                receipt.beforeClose.originalIncidence !==
                                    receipt.beforeClose.maintainedIncidence)
                        ) {
                            receipt.outcome = "INITIAL_FINAL_PARITY_FAILED";
                            process.exitCode = 1;
                        }
                    } catch (error) {
                        receipt.beforeCloseError = {
                            name: error.name,
                            message: error.message,
                        };
                        if (
                            [
                                "OFFLINE_FULL_INITIAL_DIAGNOSTIC_COMPLETED",
                                "OFFLINE_T1_T2_MECHANISMS_VERIFIED_SEMANTICS_PENDING",
                                "OFFLINE_T1_T2_TIMELINE_VERIFIED_CANONICAL_NOT_EXERCISED_SEMANTICS_PENDING",
                            ].includes(receipt.outcome)
                        ) {
                            receipt.outcome = "INITIAL_SNAPSHOT_FAILED";
                            process.exitCode = 1;
                        }
                    }
                }
            };
            await captureFinalParity();
            if (performanceTrace)
                await writeJson(
                    path.join(
                        runDirectory,
                        "performance-outstanding-before-close.json",
                    ),
                    {
                        phase: receipt.phase,
                        outcome: receipt.outcome,
                        pending: performanceTrace.pending(),
                        counters: receipt.counters,
                    },
                );
            releaseHeld?.();
            if (service) {
                receipt.close = await closeOwnedService(service);
                if (!receipt.close.completed) {
                    receipt.outcome = "CLEANUP_FAILED";
                    process.exitCode = 1;
                }
            }
            restoreInitialObserver?.();
            if (snapshotQualification) {
                receipt.snapshotQualification = snapshotQualification.summary;
                snapshotQualification.restore();
            }
            if (initialStop)
                receipt.expectedMechanismOutcomes =
                    initialStop.expectedOutcomes;
            restoreCrash?.();
            restoreTrace?.();
            if (performanceTrace) {
                receipt.performance = await performanceTrace.close();
                if (spec.nativeProfile === false)
                    receipt.performance.mode = "sparse-native-off";
                await writeJson(
                    path.join(runDirectory, "performance-summary.json"),
                    receipt.performance,
                );
                if (receipt.performance.status === "TRACE_FAILED") {
                    receipt.outcome = "TRACE_FAILED";
                    process.exitCode = 1;
                }
            }
            globalThis.fetch = nativeFetch;
            if (priorEmbedding === undefined)
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            else process.env.TYPEAGENT_EMBEDDING_PROVIDER = priorEmbedding;
            if (receipt.checkpointGuard) {
                const after = await snapshotCompiledCheckpoint(
                    spec.productRoot,
                );
                receipt.checkpointGuard.afterCompiledHashesHash = sha(
                    JSON.stringify(after),
                );
                receipt.checkpointGuard.afterCompiledFiles =
                    Object.keys(after).length;
                try {
                    assert.deepEqual(
                        after,
                        receipt.compiledHashes,
                        "Compiled checkpoint changed during admitted run",
                    );
                    receipt.checkpointGuard.afterVerified = true;
                } catch (error) {
                    receipt.checkpointGuard.afterVerified = false;
                    receipt.outcome = "CHECKPOINT_CHANGED";
                    receipt.errors.push({
                        phase: "after-close",
                        name: error.name,
                        message: error.message,
                    });
                    process.exitCode = 1;
                }
            }
            receipt.finishedEpochMs = Date.now();
            await persist();
        };
        await finalizeOfflineRun();
    }
    return receipt;
}

function completedOfflineOutcome(spec, receipt) {
    if (spec.qualification)
        return receipt.actions.naturalCanonical?.status === "NOT_EXERCISED"
            ? "OFFLINE_T1_T2_TIMELINE_VERIFIED_CANONICAL_NOT_EXERCISED_SEMANTICS_PENDING"
            : "OFFLINE_T1_T2_MECHANISMS_VERIFIED_SEMANTICS_PENDING";
    return spec.p6
        ? "OFFLINE_P6_STAGED_SMOKE_VERIFIED_ADDITIONAL_MECHANISMS_PENDING"
        : "OFFLINE_PREPARATION_VERIFIED_P6_GATE_PENDING";
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: { spec: { type: "string" }, help: { type: "boolean" } },
    });
    if (values.help) {
        process.stdout.write(
            "Offline worker: node harness.mjs --spec <absolute owned spec.json>. Launch through watchdog.mjs.\n",
        );
    } else {
        assert.ok(values.spec, "--spec is required; no default/global store");
        const receipt = await runOffline(
            JSON.parse(await readFile(values.spec, "utf8")),
        );
        process.stdout.write(
            JSON.stringify(
                {
                    receiptId: receipt.receiptId,
                    outcome: receipt.outcome,
                    store: receipt.store,
                    stages: Object.keys(receipt.stages),
                    counters: receipt.counters,
                    pending: receipt.pending,
                    errors: receipt.errors,
                },
                null,
                2,
            ) + "\n",
        );
    }
}
