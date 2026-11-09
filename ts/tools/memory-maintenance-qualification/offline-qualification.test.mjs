// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOfflineOptions } from "./offline-models.mjs";
import { generateSourceSynopsis } from "../../packages/memory/service/dist/sourceSynopsis.js";
import {
    checkpointExpectationHash,
    assertTerminalJobs,
    classifyCanonicalEvidence,
    createInitialStopControl,
    guardHeadRequest,
    handledRequestDiagnostics,
    initialReadiness,
    offlineMechanismSetStatus,
    readCanonicalQualification,
    recordOwnedFixtureProtection,
    resolveOwnedFixtureConflict,
    selectGroundedC1View,
    validateSpec,
} from "./harness.mjs";
import { validateAdmission, workerArguments } from "./watchdog.mjs";
import { verifyTailArticle } from "./p6-preflight.mjs";
import { viewHash } from "../../packages/memory/service/dist/viewMerge.js";
import { editorialProtection } from "../../packages/memory/service/dist/viewEditorial.js";

const fixtureRoot = fileURLToPath(
    new URL(
        "../../packages/memory/service/test/fixtures/memoryDemo/",
        import.meta.url,
    ),
);

test("offline synopsis uses supplied evidence identities and preserves composed qualifications", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const counters = { synopsis: 0 };
    const { sourceSynopsisModel: model } = await createOfflineOptions(
        (relative) => import(pathToFileURL(path.join(root, relative)).href),
        counters,
    );
    const first =
        "Governing tail exception: cohort A requires a separate review.";
    const second =
        "Governing tail exception: cohort B is not approved for release.";
    const content = `${first}\n${"Additional technical context. ".repeat(120)}\n${second}`;
    const synopsis = await generateSourceSynopsis(
        {
            corpusId: "offline-fixture",
            sourceId: "source",
            title: "Synthetic review boundaries",
            sourceType: "document",
            canonicalUri: "fixture:review-boundaries",
            tags: [],
        },
        {
            sourceId: "source",
            revisionId: "revision",
            contentHash: createHash("sha256").update(content).digest("hex"),
            mimeType: "text/plain",
            capturedAt: "2026-10-24T00:00:00Z",
        },
        content,
        model,
        new AbortController().signal,
    );
    assert.ok(
        counters.synopsis > 1,
        "Fixture must exercise bounded composition",
    );
    assert.ok(synopsis.overview.includes(first));
    assert.ok(synopsis.overview.includes(second));
    for (const evidence of synopsis.evidence)
        assert.equal(
            content.slice(evidence.start, evidence.end),
            evidence.excerpt,
        );
    await assert.rejects(
        () =>
            model.complete(
                `Fixture\n${JSON.stringify({
                    text: first,
                    start: 0,
                    evidence: [{ id: "unrelated", start: 1000, end: 1100 }],
                })}`,
                new AbortController().signal,
            ),
        /requires bounded supplied evidence/,
    );
});

function ownedConflictControl() {
    const originalContent = {
        title: "Generated title",
        sections: [
            {
                id: "section",
                body: "Initial evidence",
                details: { kind: "page" },
            },
        ],
    };
    const original = {
        viewId: "own",
        version: 2,
        revisionId: "original-human",
        actor: "fixture",
        provenance: "human",
        generation: {
            candidateId: "original-base",
            content: originalContent,
            fingerprint: viewHash(originalContent),
        },
        content: {
            title: "Human title",
            sections: [
                {
                    id: "section",
                    body: "Initial evidence",
                    details: { kind: "page", note: "Human annotation" },
                },
            ],
        },
        targets: ["title", "section:section:note"],
    };
    original.edits = ["title", "section:section"].map((target, i) => {
        const oldValue = i
            ? originalContent.sections[0]
            : originalContent.title;
        return {
            id: `human-edit-${i}`,
            actor: "fixture",
            target,
            createdAt: "created",
            operation: "set",
            status: "active",
            generatedBaseId: original.generation.candidateId,
            baseFingerprint: original.generation.fingerprint,
            oldValue,
            oldHash: viewHash(oldValue),
            newValue: i
                ? structuredClone(original.content.sections[0])
                : original.content.title,
            protection: [i ? "section:section:note" : "title"],
        };
    });
    const protectedTargets = editorialProtection;
    const protection = recordOwnedFixtureProtection(
        original,
        "section",
        protectedTargets,
    );
    const record = {
        purpose: "owned-T1-title-overlap",
        corpusId: "corpus",
        viewId: "own",
        jobId: "job",
        jobActor: "fixture",
        inputActor: "fixture",
        generatorActor: "memory-view-generator",
        conflictId: "conflict",
        inputFingerprint: "captured",
        expectedVersion: 3,
        expectedRevisionId: "before",
    };
    const current = {
        ...structuredClone(original),
        version: 3,
        revisionId: "before",
        actor: "memory-view-generator",
        provenance: "merged",
    };
    current.generation.candidateId = "current-base";
    current.generation.content.sections[0].body = "Current generated evidence";
    current.generation.fingerprint = viewHash(current.generation.content);
    current.content.sections[0].body = "Current generated evidence";
    for (const edit of current.edits) {
        edit.generatedBaseId = current.generation.candidateId;
        edit.baseFingerprint = current.generation.fingerprint;
        edit.oldValue =
            edit.target === "title"
                ? current.generation.content.title
                : structuredClone(current.generation.content.sections[0]);
        edit.oldHash = viewHash(edit.oldValue);
        edit.newValue =
            edit.target === "title"
                ? current.content.title
                : structuredClone(current.content.sections[0]);
        edit.status = "merged";
    }
    const conflict = {
        ...record,
        actor: "memory-view-generator",
        state: "pending",
        targets: ["title"],
        input: { fingerprint: "captured", actor: "fixture" },
        human: current,
        candidate: { content: structuredClone(current.generation.content) },
    };
    const job = {
        jobId: "job",
        actor: "fixture",
        state: "failed",
        results: [
            {
                viewId: "own",
                state: "conflicted",
                conflictId: "conflict",
                reason: "Explicit edits require authenticated resolution",
                snapshot: {
                    fingerprint: "captured",
                    actor: "fixture",
                    inputs: [{ sourceId: "original", revisionId: "current" }],
                },
            },
        ],
    };
    const requests = [];
    let saved;
    const client = {
        getViewBuild: async () => job,
        getViewConflict: async () => conflict,
        getView: async () => saved ?? current,
        getViewHistory: async () => [],
        listViews: async () => ({ head: "current-head" }),
        resolveViewConflict: async (request) => {
            requests.push(request);
            assert.equal(request.choice, "human");
            assert.equal(request.expectedHead, "current-head");
            assert.equal(request.inputFingerprint, "captured");
            assert.equal(request.expectedRevisionId, "before");
            assert.equal(request.expectedVersion, 3);
            saved = {
                ...structuredClone(current),
                revisionId: "resolved",
                version: 4,
                actor: "fixture",
                provenance: "human",
            };
            saved.generation.candidateId = "resolved-base";
            saved.generation.content = structuredClone(
                conflict.candidate.content,
            );
            saved.generation.fingerprint = viewHash(saved.generation.content);
            for (const edit of saved.edits) {
                edit.generatedBaseId = saved.generation.candidateId;
                edit.baseFingerprint = saved.generation.fingerprint;
                edit.oldValue =
                    edit.target === "title"
                        ? saved.generation.content.title
                        : structuredClone(saved.generation.content.sections[0]);
                edit.oldHash = viewHash(edit.oldValue);
            }
            if (
                viewHash(current.content.summary) !==
                viewHash(conflict.candidate.content.summary)
            ) {
                saved.edits.push({
                    id: "human-choice-summary",
                    target: "summary",
                    actor: "fixture",
                    operation:
                        current.content.summary === undefined
                            ? "delete"
                            : "set",
                    status: "active",
                    oldValue: conflict.candidate.content.summary,
                    oldHash: viewHash(conflict.candidate.content.summary),
                    newValue: current.content.summary,
                    generatedBaseId: saved.generation.candidateId,
                    baseFingerprint: saved.generation.fingerprint,
                });
            }
            conflict.state = "resolved";
            conflict.resolutionRevisionId = saved.revisionId;
            return { version: saved };
        },
    };
    return {
        client,
        record,
        protection,
        current,
        conflict,
        job,
        requests,
        protectedTargets,
    };
}

test("owned human choice: exact recorded conflict is bound to current head/version/revision/fingerprint and preserves annotation/protection", async () => {
    const fixture = ownedConflictControl();
    const proof = await resolveOwnedFixtureConflict(
        fixture.client,
        "corpus",
        fixture.record,
        fixture.protection,
        fixture.protectedTargets,
        viewHash,
    );
    assert.equal(proof.state, "resolved");
    assert.equal(proof.request.expectedHead, "current-head");
    assert.equal(
        proof.request.inputFingerprint,
        fixture.record.inputFingerprint,
    );
    assert.deepEqual(proof.protectedTargets, ["section:section:note", "title"]);
    assert.equal(fixture.current.actor, "memory-view-generator");
    assert.equal(fixture.conflict.human.actor, "memory-view-generator");
    assert.equal(proof.authoredEditsVerified, true);
    assert.deepEqual(
        proof.authoredEditIds,
        fixture.protection.authoredEdits.map((edit) => edit.id),
    );
    assertTerminalJobs([fixture.job], proof);
    assert.throws(() => assertTerminalJobs([fixture.job]), /Unexpected failed/);
    const other = structuredClone(fixture.job);
    other.jobId = "unknown";
    assert.throws(() => assertTerminalJobs([other], proof));
    other.jobId = fixture.job.jobId;
    other.results[0].snapshot.inputs[0].revisionId = "unexpected";
    assert.throws(() => assertTerminalJobs([other], proof));
});

test("owned human choice: unknown/wrong job, target, actor, revision or fingerprint never invokes resolution", async () => {
    for (const change of [
        (f) => (f.record.purpose = "unknown"),
        (f) => (f.conflict.conflictId = "unknown"),
        (f) => (f.conflict.jobId = "unknown"),
        (f) => (f.conflict.targets = ["section:other"]),
        (f) => (f.conflict.actor = "other-user"),
        (f) => (f.conflict.input.fingerprint = "unexpected"),
        (f) => (f.current.revisionId = "unexpected"),
        (f) => (f.current.version = 4),
        (f) => (f.current.content.sections[0].details.note = "lost"),
        (f) => (f.current.edits[0].id = "unknown-edit"),
        (f) => (f.current.edits[0].actor = "other-human"),
        (f) => (f.current.edits[0].newValue = "fabricated title"),
        (f) => (f.current.edits[1].newValue.details.note = "fabricated note"),
        (f) => (f.current.edits[0].protection = []),
        (f) => (f.current.edits[0].generatedBaseId = "obsolete-base"),
        (f) => (f.current.edits[0].baseFingerprint = "obsolete"),
        (f) => f.current.edits.pop(),
    ]) {
        const fixture = ownedConflictControl();
        change(fixture);
        await assert.rejects(
            resolveOwnedFixtureConflict(
                fixture.client,
                "corpus",
                fixture.record,
                fixture.protection,
                fixture.protectedTargets,
                viewHash,
            ),
        );
        assert.equal(fixture.requests.length, 0);
    }
});

test("owned human choice: only independently predicted whole-human summary choice may add protection; unknown additions fail", async () => {
    const fixture = ownedConflictControl();
    fixture.current.content.summary = "Retained human choice";
    fixture.conflict.candidate.content.summary = "Proposed generated summary";
    const proof = await resolveOwnedFixtureConflict(
        fixture.client,
        "corpus",
        fixture.record,
        fixture.protection,
        fixture.protectedTargets,
        viewHash,
    );
    assert.deepEqual(proof.humanChoiceEdits, [
        {
            id: "human-choice-summary",
            actor: "fixture",
            target: "summary",
        },
    ]);
    assert.deepEqual(proof.protectedTargets, [
        "section:section:note",
        "summary",
        "title",
    ]);
    for (const changed of ["actor", "newValue", "target", "oldHash"]) {
        const bad = ownedConflictControl();
        bad.current.content.summary = "Retained";
        bad.conflict.candidate.content.summary = "Proposed";
        const resolve = bad.client.resolveViewConflict;
        bad.client.resolveViewConflict = async (request) => {
            const saved = await resolve(request);
            saved.version.edits.at(-1)[changed] = "unknown";
            return saved;
        };
        await assert.rejects(
            resolveOwnedFixtureConflict(
                bad.client,
                "corpus",
                bad.record,
                bad.protection,
                bad.protectedTargets,
                viewHash,
            ),
        );
    }
});

test("owned human choice: stale public resolution and annotation loss propagate as failure, pending is never ready", async () => {
    const fixture = ownedConflictControl();
    fixture.client.resolveViewConflict = async () => {
        throw new Error("Conflict resolution head/target/input guard changed");
    };
    await assert.rejects(
        resolveOwnedFixtureConflict(
            fixture.client,
            "corpus",
            fixture.record,
            fixture.protection,
            fixture.protectedTargets,
            viewHash,
        ),
        /guard changed/,
    );
    assert.equal(fixture.conflict.state, "pending");
    assert.equal(
        initialReadiness(
            {
                wikiFamily: {
                    enabled: true,
                    pending: true,
                    error: "user decision",
                },
                projectFamily: { enabled: true, pending: false },
            },
            [fixture.job],
            [],
            { family: { enabled: true, dirty: false } },
        ).ready,
        false,
    );
    const staleHead = ownedConflictControl();
    staleHead.client.listViews = async () => ({ head: "stale-head" });
    await assert.rejects(
        resolveOwnedFixtureConflict(
            staleHead.client,
            "corpus",
            staleHead.record,
            staleHead.protection,
            staleHead.protectedTargets,
            viewHash,
        ),
    );
    assert.equal(staleHead.conflict.state, "pending");
    const second = ownedConflictControl();
    const resolve = second.client.resolveViewConflict;
    second.client.resolveViewConflict = async (request) => {
        const result = await resolve(request);
        result.version.content.sections[0].details.note = "lost";
        return result;
    };
    await assert.rejects(
        resolveOwnedFixtureConflict(
            second.client,
            "corpus",
            second.record,
            second.protection,
            second.protectedTargets,
            viewHash,
        ),
    );
});

test("handled request diagnostics: only exact recognized retries with successful return proof are nonfatal", async () => {
    class Stale extends Error {}
    const errors = [],
        successes = [];
    let attempts = 0;
    const value = await guardHeadRequest(
        async () => {
            if (++attempts < 3) throw new Stale("head");
            return { acknowledged: true };
        },
        {
            checkDeadline() {},
            isStale: (error) => error instanceof Stale,
            onDiagnostic: (error) => errors.push(error),
            onSuccessfulReturn: (proof) => successes.push(proof),
            wait: async () => {},
        },
    );
    assert.equal(value.acknowledged, true);
    assert.equal(errors.length, 2);
    assert.equal(handledRequestDiagnostics(errors, successes), true);
    assert.equal(handledRequestDiagnostics(errors, []), false);
    for (const change of [
        (e) => (e.phase = "unknown"),
        (e) => (e.recognizedErrorType = "unknown"),
        (e) => (e.requestId = "unknown"),
        (e) => (e.attempt = 99),
    ]) {
        const invalid = structuredClone(errors);
        change(invalid[0]);
        assert.equal(handledRequestDiagnostics(invalid, successes), false);
    }
    const fatal = [...errors, { phase: "t2", name: "Error" }];
    assert.equal(handledRequestDiagnostics(fatal, successes), false);
    const noSuccess = [];
    await assert.rejects(
        guardHeadRequest(
            async () => {
                throw new Error("unknown fatal");
            },
            {
                checkDeadline() {},
                isStale: (error) => error instanceof Stale,
                onDiagnostic: (error) => errors.push(error),
                onSuccessfulReturn: (proof) => noSuccess.push(proof),
            },
        ),
        /unknown fatal/,
    );
    assert.equal(noSuccess.length, 0);
});

test("terminal jobs: known indexed-evidence noop is valid but unknown skips and incomplete canonical receipts fail", () => {
    const job = {
        jobId: "noop",
        state: "complete",
        results: [
            {
                state: "skipped",
                reason: "Unchanged indexed evidence and definition; no synthesis required",
            },
        ],
    };
    assertTerminalJobs([job]);
    assert.equal(classifyCanonicalEvidence([job]).status, "NOT_EXERCISED");
    job.results[0].reason = "unknown";
    assert.throws(() => assertTerminalJobs([job]));
    job.results[0] = {
        state: "merged",
        wikiConsolidation: { stage: "accepted" },
    };
    assert.throws(() => assertTerminalJobs([job]));
});

test("canonical gate: absent evidence continues timeline explicitly pending, not successful canonical verification", async () => {
    let reads = 0;
    const result = await readCanonicalQualification(
        {
            listViewBuilds: async () => {
                reads++;
                return [{ jobId: "ordinary", state: "complete", results: [] }];
            },
        },
        "corpus",
    );
    assert.equal(reads, 1);
    assert.equal(result.status, "NOT_EXERCISED");
    assert.equal(result.canonicalReceipts, 0);
    assert.equal(result.evidence, undefined);
});

test("canonical gate: partial receipts and unsettled/error/stale targets cannot become absent or successful", () => {
    const job = {
        jobId: "job",
        state: "complete",
        results: [{ viewId: "view", state: "merged" }],
    };
    for (const stage of ["prepared", "accepted", "retired", "indexed"]) {
        const current = structuredClone(job);
        current.results[0].wikiConsolidation = { stage };
        assert.throws(() => classifyCanonicalEvidence([current]), /incomplete/);
    }
    for (const state of [
        "failed",
        "stale",
        "cancelled",
        "blocked",
        "conflicted",
        "interrupted",
    ]) {
        const current = structuredClone(job);
        current.results[0].state = state;
        assert.throws(() => classifyCanonicalEvidence([current]), /target/);
    }
    for (const state of ["running", "failed", "cancelled"])
        assert.throws(
            () => classifyCanonicalEvidence([{ ...job, state }]),
            /unsettled/,
        );
    assert.throws(
        () => classifyCanonicalEvidence([{ ...job, error: "error" }]),
        /job error/,
    );
    const mixed = structuredClone(job);
    mixed.results[0].wikiConsolidation = { stage: "ready" };
    mixed.results.push({
        viewId: "other",
        state: "merged",
        wikiConsolidation: { stage: "accepted" },
    });
    assert.throws(() => classifyCanonicalEvidence([mixed]), /incomplete/);
});

function canonicalServiceControl() {
    const citation = {
        sourceId: "original",
        revisionId: "current",
        locator: "indexed",
        excerpt: "exact original",
    };
    const sections = [
        { id: "a", body: "grounded original A" },
        { id: "b", body: "grounded original B" },
    ];
    const canonical = {
        viewId: "canonical",
        revisionId: "accepted",
        content: { sections, citations: [citation] },
    };
    const alias = { ...canonical, redirect: { viewId: "canonical" } };
    const receipt = {
        stage: "ready",
        survivorViewId: "canonical",
        retiringViewId: "old",
        input: { targetRevisionId: "prior" },
        retiringRevisionId: "prior-old",
        output: { content: canonical.content },
        anchors: [{ to: "a" }],
        assessment: {
            criticalDistinctions: [{ statement: "grounded original" }],
        },
    };
    return {
        canonical,
        alias,
        receipt,
        listViewBuilds: async () => [
            {
                jobId: "job",
                state: "complete",
                results: [{ state: "merged", wikiConsolidation: receipt }],
            },
        ],
        getView: async ({ viewId, revisionId }) =>
            revisionId
                ? {
                      content: {
                          sections: [sections[viewId === "canonical" ? 0 : 1]],
                          citations: [citation],
                      },
                  }
                : viewId === "canonical"
                  ? canonical
                  : alias,
        getSourceContent: async () => ({ content: "exact original" }),
        getViewPublication: async () => ({
            indexState: "ready",
            indexedRevisionId: "accepted",
        }),
    };
}

test("canonical gate: ready evidence still enforces exact aliases, original sections/citations and publication", async () => {
    const verified = await readCanonicalQualification(
        canonicalServiceControl(),
        "corpus",
    );
    assert.equal(verified.status, "READY");
    assert.equal(verified.evidence.sections, 2);
    assert.equal(verified.evidence.preservedOriginalSections, 2);
    for (const change of [
        (service) => (service.alias.redirect.viewId = "wrong"),
        (service) => (service.receipt.anchors[0].to = "absent"),
        (service) =>
            (service.getSourceContent = async () => ({ content: "mismatch" })),
        (service) =>
            (service.getViewPublication = async () => ({
                indexState: "pending",
                indexedRevisionId: "prior",
            })),
    ]) {
        const service = canonicalServiceControl();
        change(service);
        await assert.rejects(readCanonicalQualification(service, "corpus"));
    }
});

test("mechanism status: canonical absence alone and separate failure never grant overall PASS", () => {
    const names = [
        "authenticated-protection-and-real-overlap",
        "privacy-over-protection-and-held-late-result",
        "actual-read-but-not-cited-topic-influence-forget-late-denial",
        "exact-settled-restart-unchanged-repeat",
        "actual-RPC-facade-read-and-forget-denial",
    ];
    const timeline = {
        outcome:
            "OFFLINE_T1_T2_TIMELINE_VERIFIED_CANONICAL_NOT_EXERCISED_SEMANTICS_PENDING",
        close: { completed: true },
        checkpointGuard: { afterVerified: true },
        actions: {
            naturalCanonical: { status: "NOT_EXERCISED" },
            conflictResolution: {
                state: "resolved",
                resolutionRevisionId: "resolved",
                inputFingerprint: "own",
                request: { choice: "human", inputFingerprint: "own" },
            },
        },
        stages: Object.fromEntries(
            [
                ["initial", 23],
                ["t1", 24],
                ["t2", 25],
                ["t2-forgotten", 24],
            ].map(([name, activeSources]) => [name, { activeSources }]),
        ),
        beforeClose: {
            readiness: { ready: true },
            citationErrors: [],
            originalIncidence: 70,
            maintainedIncidence: 70,
        },
        snapshotQualification: { maxHydrations: 1 },
        checks: names.map((name) => ({
            name,
            status: "PASS_OFFLINE",
            ...(name === "exact-settled-restart-unchanged-repeat"
                ? { restarts: [{}, {}] }
                : {}),
        })),
    };
    const canonical = {
        outcome: "PASS_OFFLINE_CANONICAL_PROCESS_CRASH_RECOVERY",
        close: { completed: true },
        checkpointGuard: { afterVerified: true },
        repeat: { sameHead: true, sameRevisions: true, extraModelCalls: 0 },
        publicReadWrite: {
            registeredSections: 2,
            observations: Array(6).fill({}),
            guardedStaleWriteDenied: true,
            actualEditRevisionId: "edit",
            actualEditReadRevisionId: "edit",
            afterEditPublication: { indexState: "ready" },
        },
        privacy: {
            canonicalAndAliasDenied: true,
            historyAndJobSuppressed: true,
        },
    };
    assert.equal(offlineMechanismSetStatus(timeline, undefined), "BLOCKED");
    assert.equal(
        offlineMechanismSetStatus(timeline, canonical),
        "PASS_OFFLINE_MECHANISMS_ONLY_LIVE_SEMANTICS_PENDING",
    );
    assert.equal(timeline.actions.naturalCanonical.status, "NOT_EXERCISED");
    const withDiagnostics = structuredClone(timeline);
    withDiagnostics.errors = [
        {
            phase: "optimistic-head-retry",
            recognizedErrorType: "ViewBuildStaleError",
            requestId: "request",
            attempt: 1,
            epochMs: 1,
        },
    ];
    withDiagnostics.successfulRequestReturns = [
        {
            requestId: "request",
            returned: true,
            handledDiagnosticCount: 1,
            completedAttempt: 2,
            returnedEpochMs: 2,
        },
    ];
    assert.equal(
        offlineMechanismSetStatus(withDiagnostics, canonical),
        "PASS_OFFLINE_MECHANISMS_ONLY_LIVE_SEMANTICS_PENDING",
    );
    withDiagnostics.successfulRequestReturns = [];
    assert.equal(
        offlineMechanismSetStatus(withDiagnostics, canonical),
        "BLOCKED",
    );
    withDiagnostics.errors[0].phase = "unknown";
    assert.equal(
        offlineMechanismSetStatus(withDiagnostics, canonical),
        "BLOCKED",
    );
    for (const change of [
        (value) => (value.outcome = "FAILED"),
        (value) => (value.close.completed = false),
        (value) => (value.checkpointGuard.afterVerified = false),
        (value) => (value.repeat.extraModelCalls = 1),
        (value) => (value.publicReadWrite.actualEditReadRevisionId = "wrong"),
        (value) => (value.publicReadWrite.registeredSections = 1),
        (value) => value.publicReadWrite.observations.pop(),
        (value) => (value.publicReadWrite.guardedStaleWriteDenied = false),
        (value) =>
            (value.publicReadWrite.afterEditPublication.indexState = "pending"),
        (value) => (value.privacy.canonicalAndAliasDenied = false),
        (value) => (value.privacy.historyAndJobSuppressed = false),
    ]) {
        const current = structuredClone(canonical);
        change(current);
        assert.equal(offlineMechanismSetStatus(timeline, current), "BLOCKED");
    }
    for (const change of [
        (value) => (value.actions.conflictResolution.state = "pending"),
        (value) => (value.actions.conflictResolution.resolutionRevisionId = ""),
        (value) =>
            (value.actions.conflictResolution.request.choice = "generated"),
        (value) =>
            (value.actions.conflictResolution.request.inputFingerprint =
                "wrong"),
        (value) => (value.beforeClose.readiness.ready = false),
        (value) =>
            value.beforeClose.citationErrors.push({ message: "bad citation" }),
        (value) => (value.beforeClose.maintainedIncidence = -1),
        (value) => (value.stages.initial.activeSources = 24),
        (value) => (value.stages.t1.activeSources = 25),
        (value) => (value.stages.t2.activeSources = 24),
    ]) {
        const current = structuredClone(timeline);
        change(current);
        assert.equal(offlineMechanismSetStatus(current, canonical), "BLOCKED");
    }
    const partial = structuredClone(timeline);
    partial.stages["t2-forgotten"].activeSources = 25;
    assert.equal(offlineMechanismSetStatus(partial, canonical), "BLOCKED");
    partial.stages["t2-forgotten"].activeSources = 24;
    partial.checks[3].restarts.pop();
    assert.equal(offlineMechanismSetStatus(partial, canonical), "BLOCKED");
});

const now = Date.now();
const checkpoint = {
    name: "frozen-offline-control",
    hashes: Object.fromEntries(
        [
            "indexedFragments.js",
            "informationalView.js",
            "fileMemoryService.js",
        ].map((name) => [
            path.join("packages", "memory", "service", "dist", name),
            "a".repeat(64),
        ]),
    ),
};
const spec = {
    mode: "offline",
    productRoot: process.cwd(),
    fixtureRoot: process.cwd(),
    runDirectory: process.cwd(),
    receiptId: "control",
    p6: true,
    qualification: true,
    nativeProfile: false,
    expectedCheckpoint: checkpoint,
    startupAllowanceMs: 120000,
    workAllowanceMs: 900000,
    spawnedEpochMs: now,
    crashStage: "t1",
};

test("normal full qualification requires an explicit checkpoint, supports owned crash resume and never profiles", () => {
    validateSpec(spec);
    validateSpec({ ...spec, resume: true });
    for (const change of [
        { expectedCheckpoint: undefined },
        { nativeProfile: true },
        { performance: true },
        { p6: false },
    ])
        assert.throws(() => validateSpec({ ...spec, ...change }));
    assert.deepEqual(workerArguments(spec, "worker", "spec"), [
        "worker",
        "--spec",
        "spec",
    ]);
    const admission = {
        receiptId: "control",
        workerPid: 1234,
        admittedEpochMs: now,
        workDeadlineEpochMs: now + spec.workAllowanceMs,
        checkpointExpectationHash: checkpointExpectationHash(checkpoint),
        compiledHashesHash: "b".repeat(64),
    };
    validateAdmission(admission, spec, 1234, now);
    assert.throws(() =>
        validateAdmission(
            {
                ...admission,
                checkpointExpectationHash: "c".repeat(64),
            },
            spec,
            1234,
            now,
        ),
    );
});

test("canonical worker explicit checkpoint also binds admission without performance/qualification mode", () => {
    const current = { ...spec, qualification: false };
    validateSpec(current);
    assert.throws(() =>
        validateSpec({ ...current, expectedCheckpoint: { name: "invalid" } }),
    );
    const admission = {
        receiptId: "control",
        workerPid: 1234,
        admittedEpochMs: now,
        workDeadlineEpochMs: now + spec.workAllowanceMs,
        checkpointExpectationHash: checkpointExpectationHash(checkpoint),
        compiledHashesHash: "b".repeat(64),
    };
    validateAdmission(admission, current, 1234, now);
    assert.throws(() =>
        validateAdmission(
            { ...admission, checkpointExpectationHash: "c".repeat(64) },
            current,
            1234,
            now,
        ),
    );
});

const reference = { sourceId: "original", revisionId: "current" };
const contentHash = (text) => createHash("sha256").update(text).digest("hex");
const source = {
    sourceId: "original",
    activeRevisionId: "current",
    revisions: [
        {
            revisionId: "current",
            state: "ready",
            contentHash: "current",
            synopsis: { status: "ready" },
        },
    ],
};
const natural = {
    viewId: "default",
    version: 1,
    state: "draft",
    definition: {
        kind: "wiki",
        selector: { kind: "sources", sources: [reference] },
        wiki: {
            construction: "informational-wiki-v1",
            query: "governing tail exception",
            aliases: [],
            excludedSourceIds: [],
        },
    },
    content: { citations: [reference] },
    generation: {
        input: {
            inputs: [
                {
                    ...reference,
                    content: "selected",
                    contentHash: contentHash("selected"),
                    passages: [
                        {
                            ...reference,
                            locator: "control",
                            excerpt: "selected",
                        },
                    ],
                },
            ],
            expectedVersion: 0,
            pipeline: "informational-wiki-v1",
            model: "control:indexed-evidence-v2",
        },
    },
};
natural.generation.input.definition = structuredClone(natural.definition);
const select = (views, head = "committed", prior, options = {}) =>
    selectGroundedC1View(
        { head: "committed", views },
        source,
        reference,
        "Governing tail exception",
        head,
        prior,
        { currentSources: [source], defaultViewIds: ["default"], ...options },
    );

test("C1 zero query matches alone allows the existing diagnostic creation path", () => {
    assert.equal(select([]), undefined);
    assert.throws(() => select([], "committed", "prior"), /disappeared/);
});

test("C1 unique grounded default is reused read-only and follows current revisions without pinning its definition", () => {
    const before = structuredClone(natural);
    assert.equal(select([natural]), natural);
    assert.deepEqual(natural, before);
    const next = structuredClone(natural);
    next.definition.selector.sources[0].revisionId = "next";
    next.content.citations[0].revisionId = "next";
    next.generation.input.inputs[0].revisionId = "next";
    next.generation.input.inputs[0].passages[0].revisionId = "next";
    next.generation.input.definition.selector.sources[0].revisionId = "next";
    const nextSource = {
        ...source,
        activeRevisionId: "next",
        revisions: [
            {
                revisionId: "next",
                state: "ready",
                contentHash: "next",
                synopsis: { status: "ready" },
            },
        ],
    };
    assert.equal(
        selectGroundedC1View(
            { head: "next-head", views: [next] },
            nextSource,
            { sourceId: "original", revisionId: "next" },
            "Governing tail exception",
            "next-head",
            "default",
            { currentSources: [nextSource], defaultViewIds: ["default"] },
        ),
        next,
    );
    assert.equal(natural.definition.selector.sources[0].revisionId, "current");
});

const multi = () => {
    const view = structuredClone(natural);
    const sources = [structuredClone(source)];
    for (const sourceId of ["worksheet", "vocabulary"]) {
        const ref = { sourceId, revisionId: "current" };
        const content = `selected:${sourceId}`;
        view.definition.selector.sources.push(ref);
        view.generation.input.inputs.push({
            ...ref,
            content,
            contentHash: contentHash(content),
            passages: [{ ...ref, locator: "control", excerpt: content }],
        });
        view.content.citations.push({ ...ref });
        sources.push({
            sourceId,
            activeRevisionId: "current",
            revisions: [
                {
                    revisionId: "current",
                    state: "ready",
                    contentHash: "current",
                    synopsis: { status: "ready" },
                },
            ],
        });
    }
    view.generation.input.definition = structuredClone(view.definition);
    return { view, sources };
};

test("C1 natural multisource default validates exact current captured grounding without mutation", () => {
    const { view, sources } = multi();
    const before = structuredClone(view);
    assert.equal(
        select([view], "committed", "default", { currentSources: sources }),
        view,
    );
    assert.deepEqual(view, before);
});

test("C1 natural default rejects missing named grounding and missing named article citation", () => {
    for (const remove of [
        (view) => {
            view.definition.selector.sources.shift();
            view.generation.input.definition.selector.sources.shift();
            view.generation.input.inputs.shift();
        },
        (view) => {
            view.content.citations.shift();
        },
    ]) {
        const { view, sources } = multi();
        remove(view);
        assert.throws(
            () =>
                select([view], "committed", "default", {
                    currentSources: sources,
                }),
            /expected original grounding is absent|named current original citation/,
        );
    }
});

test("C1 stale, unavailable, excluded, suppressed or hash-mismatched other member never passes", () => {
    for (const mutate of [
        (view, sources) => {
            sources[1].activeRevisionId = "newer";
        },
        (view, sources) => {
            sources.pop();
        },
        (view, sources) => {
            sources[1].revisions[0].state = "pending";
        },
        (view, sources) => {
            sources[1].revisions[0].synopsis.status = "empty";
        },
        (view, sources) => {
            sources[1].revisions[0].contentHash = "changed";
        },
        (view) => {
            view.definition.wiki.excludedSourceIds.push("worksheet");
        },
    ]) {
        const { view, sources } = multi();
        mutate(view, sources);
        assert.throws(() =>
            select([view], "committed", "default", { currentSources: sources }),
        );
    }
});

test("C1 mismatched or fabricated citation and mismatched captured membership fail", () => {
    for (const mutate of [
        (view) => {
            view.content.citations[1] = {
                sourceId: "worksheet",
                revisionId: "old",
            };
        },
        (view) => {
            view.content.citations.push({
                sourceId: "fabricated",
                revisionId: "current",
            });
        },
        (view) => {
            view.generation.input.inputs.pop();
        },
        (view) => {
            view.generation.input.definition.selector.sources.pop();
        },
        (view) => {
            view.generation.input.model = "control:obsolete-recipe";
        },
    ]) {
        const { view, sources } = multi();
        mutate(view);
        assert.throws(() =>
            select([view], "committed", "default", { currentSources: sources }),
        );
    }
});

test("C1 intentional diagnostic remains singleton scoped and unknown page cannot silently become default", () => {
    const diagnostic = structuredClone(natural);
    diagnostic.viewId = "diagnostic";
    const options = { defaultViewIds: [], diagnosticViewId: "diagnostic" };
    assert.equal(
        select([diagnostic], "committed", "diagnostic", options),
        diagnostic,
    );
    assert.throws(() => select([diagnostic]), /not a natural family default/);
    const { view, sources } = multi();
    view.viewId = "diagnostic";
    assert.throws(
        () =>
            select([view], "committed", "diagnostic", {
                ...options,
                currentSources: sources,
            }),
        /must not broaden/,
    );
});

test("C1 full-tail citation selection requires the named current original even when another excerpt matches", async () => {
    const file = path.join(
        fixtureRoot,
        "memory-import-second-brain-maintenance",
        "content-only",
        "initial",
        "document-020.md",
    );
    const original = await readFile(file, "utf8");
    const start = original.indexOf("Governing tail exception:");
    const tail = original.slice(start, start + 822);
    const named = { ...reference, locator: "named", excerpt: tail };
    const wrong = {
        sourceId: "other",
        revisionId: "current",
        locator: "other",
        excerpt: tail,
    };
    const view = {
        revisionId: "article",
        content: {
            sections: [{ body: `${tail}\nCoverage limits: control` }],
            citations: [wrong, named],
        },
    };
    const service = {
        getView: async () => view,
        getSourceContent: async (request) => {
            assert.equal(request.sourceId, reference.sourceId);
            assert.equal(request.revisionId, reference.revisionId);
            assert.equal(request.indexedLocator, "named");
            return { content: tail };
        },
    };
    assert.equal(
        (await verifyTailArticle(service, "corpus", "default", file, reference))
            .sourceId,
        "original",
    );
    view.content.citations = [wrong];
    await assert.rejects(
        verifyTailArticle(service, "corpus", "default", file, reference),
        /must cite the complete tail/,
    );
});

test("C1 multiple equal queries never select a record even with different eligibility", () => {
    const duplicate = { ...structuredClone(natural), viewId: "diagnostic" };
    assert.throws(() => select([natural, duplicate]), /ambiguity/);
    duplicate.state = "stale";
    assert.throws(() => select([natural, duplicate]), /ambiguity/);
});

test("C1 matching query with wrong scope/source/revision/head/eligibility fails rather than creating or overriding", () => {
    for (const mutate of [
        (view) => {
            view.definition.selector.sources[0].sourceId = "different";
        },
        (view) => {
            view.definition.selector.sources[0].revisionId = "old";
        },
        (view) => {
            view.definition.selector.sources.push({
                sourceId: "other",
                revisionId: "current",
            });
        },
        (view) => {
            view.definition.wiki.excludedSourceIds.push("original");
        },
        (view) => {
            view.content.citations[0].revisionId = "old";
        },
        (view) => {
            view.generation.input.inputs = [];
        },
        (view) => {
            view.state = "stale";
        },
        (view) => {
            view.redirect = { viewId: "canonical" };
        },
    ]) {
        const wrong = structuredClone(natural);
        mutate(wrong);
        assert.throws(() => select([wrong]));
    }
    assert.throws(() => select([natural], "changed"), /head changed/);
    assert.throws(
        () => select([natural], "committed", "wrong-id"),
        /ID changed/,
    );
});

test("full-stage stop preserves first unexpected failure while exact expected mechanisms remain assertions", () => {
    const job = { jobId: "actual", results: [{ viewId: "target" }] };
    for (const phase of [
        "baseline",
        "initial",
        "t1",
        "t2",
        "external-forget",
    ]) {
        const stop = createInitialStopControl({
            allPhases: true,
            expected: (p, j, viewId, state) =>
                p === "t1" &&
                j.jobId === "actual" &&
                viewId === "protected" &&
                state === "conflicted"
                    ? "asserted-protected-overlap"
                    : undefined,
        });
        stop.observe("t1", job, "protected", "conflicted", "Expected conflict");
        assert.equal(stop.failure(), undefined);
        assert.equal(stop.expectedOutcomes.length, 1);
        stop.observe(phase, job, "target", "stale", "Actual fingerprint drift");
        assert.equal(stop.failure().phase, phase);
        assert.equal(stop.failure().category, "target-stale");
        assert.throws(() => stop.check(), /Bounded offline stop/);
        stop.freeze();
        stop.observe("close", job, "target", "cancelled", "Cleanup");
        assert.equal(stop.failure().reason, "Actual fingerprint drift");
    }
    const stop = createInitialStopControl({ allPhases: true });
    stop.observe("t1", job, "target", "blocked", "Critical choice required");
    assert.equal(stop.failure().category, "target-blocked");
    assert.throws(() => stop.check());
});
