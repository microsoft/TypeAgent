// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    reconciliationTasks,
    reconciliationComparison,
    runReconciliationDiagnostic,
    captureWindows,
    nativeWindow,
    recordDiagnosticCompletion,
    diagnosticSummary,
} from "./topic-reconciliation-diagnostic.mjs";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import { initialTopicNodes } from "../../packages/memory/service/dist/topicSnapshot.js";
import { getRuntimeConfigGeneration } from "../../packages/aiclient/dist/index.js";

function fixture(count = 3) {
    const occurrences = Array.from({ length: count }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${ordinal}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "The service requires explicit installation approval.",
                score: 1,
            },
            "Installation approval",
            0,
        ),
    );
    const nodes = initialTopicNodes("diagnostic", occurrences);
    const concept = (ids, id) => ({
        id,
        label: "Installation approval",
        scope: "Service",
        purpose: "Explain the installation approval requirement",
        memberIds: ids.map((index) => nodes[index].id),
        citations: ids.flatMap((index) => nodes[index].citations),
        salience: 4,
        summary: "",
        summaryState: "pending",
    });
    const snapshot = {
        schemaVersion: 1,
        corpusId: "diagnostic",
        generation: "test",
        inputFingerprint: "a".repeat(64),
        recipe: "fixture",
        generatedAt: "2026-11-13T23:05:58Z",
        occurrences,
        nodes,
        influenceSources: [],
        parents: [],
        related: [],
        limits: [],
    };
    const prior = concept([0], "concept:prior");
    const prepared = concept([1], "concept:prepared");
    const current = { concepts: [prior], deferred: [] };
    const window = {
        current,
        prepared: [
            {
                concepts: [prepared],
                deferred: [{ nodeId: nodes[2].id, reason: "Needs context" }],
            },
        ],
    };
    return { snapshot, window, nodes, prior, prepared };
}

test("reconciliation tasks expand raw group membership and reconsider every deferred raw", () => {
    const { snapshot, window, nodes } = fixture();
    const original = structuredClone(window);
    const tasks = reconciliationTasks(snapshot, window);
    assert.deepEqual(
        tasks.map((task) => task.candidate.node.id),
        [nodes[1].id, nodes[2].id],
    );
    assert(tasks.every((task) => task.candidate.complete));
    assert(tasks.every((task) => task.targets.length === 2));
    assert(
        tasks.every((task) => task.targets.every((target) => target.complete)),
    );
    assert.deepEqual(window, original);
    assert.equal(tasks[0].targets[0].concept.memberIds[0], nodes[0].id);
    assert.equal(tasks[0].targets[1].concept.memberIds[0], nodes[1].id);
});

test("reconciliation refuses lost raw IDs and overlapping committed membership", () => {
    const { snapshot, window } = fixture();
    const missing = structuredClone(window);
    missing.prepared[0].deferred[0].nodeId = "unknown";
    assert.throws(() => reconciliationTasks(snapshot, missing), /lost raw/);
    const overlap = structuredClone(window);
    overlap.prepared[0].concepts[0] = overlap.current.concepts[0];
    assert.throws(() => reconciliationTasks(snapshot, overlap), /overlaps/);
});

test("comparison preserves distributions and treats conflicting partitions and missing answers as uncertain", () => {
    const { window, nodes, prior, prepared } = fixture();
    const curation = {
        concepts: [prior, prepared],
        deferred: [{ nodeId: nodes[2].id, reason: "Needs context" }],
    };
    const detail = (choice) => ({
        type: "choice",
        choice,
        probabilities: { standalone_new: 0.6, uncertain_needs_synthesis: 0.4 },
    });
    const receipts = ["standalone_new", "uncertain_needs_synthesis"].map(
        (choice) => ({
            candidateIds: { n0: nodes[1].id },
            answerDetails: { disposition_n0: detail(choice) },
        }),
    );
    const rows = reconciliationComparison(window, curation, receipts);
    assert.equal(rows[0].outcome, "uncertain-partitions");
    assert.equal(rows[1].outcome, "uncertain-partitions");
    assert(rows.every((row) => !row.agreement));
    assert.equal(rows[0].answers[0].probabilities.standalone_new, 0.6);
    assert(!Object.hasOwn(rows[0].answers[0], "confidence"));
    assert.throws(
        () =>
            reconciliationComparison(
                window,
                { concepts: [], deferred: [] },
                receipts,
            ),
        /accounting/,
    );
});

test("a successful partition cannot hide a failed or missing target partition", () => {
    const { window, nodes, prior, prepared } = fixture();
    const curation = {
        concepts: [prior, prepared],
        deferred: [{ nodeId: nodes[2].id, reason: "Needs context" }],
    };
    const partial = {
        outcome: "success",
        candidateIds: { n0: nodes[1].id },
        targetExposure: [
            {
                nodeId: nodes[1].id,
                evaluatedTargetIds: [prior.id],
                unavailableTargetIds: [],
                candidateGrounding: "complete",
            },
        ],
        answerDetails: {
            disposition_n0: {
                type: "choice",
                choice: "standalone_new",
                probabilities: { standalone_new: 1 },
            },
        },
    };
    const failed = { outcome: "failed", candidateIds: { n0: nodes[1].id } };
    const rows = reconciliationComparison(window, curation, [partial, failed]);
    assert.equal(rows[0].outcome, "uncertain-partitions");
    assert.equal(rows[0].evaluatedTargets, 1);
    assert.equal(rows[0].expectedTargets, 2);
    const complete = structuredClone(partial);
    complete.targetExposure[0].evaluatedTargetIds.push(prepared.id);
    const accepted = reconciliationComparison(window, curation, [complete]);
    assert.equal(accepted[0].outcome, "admit");
    assert.equal(accepted[0].agreement, true);
});

test("live diagnostic refuses inference without explicit authorization", async () => {
    await assert.rejects(runReconciliationDiagnostic({}), /Explicit --live/);
    await assert.rejects(
        runReconciliationDiagnostic({ live: true, windows: "0" }),
        /Invalid windows/,
    );
    await assert.rejects(
        runReconciliationDiagnostic({ live: true, "max-calls": "-1" }),
        /Invalid max-calls/,
    );
    const store = await mkdtemp(path.join(os.tmpdir(), "topic-diagnostic-"));
    try {
        await assert.rejects(
            runReconciliationDiagnostic({
                live: true,
                history: path.join(store, "views", "view-history.git"),
                output: path.join(store, "capture"),
            }),
            /outside the original view-store/,
        );
    } finally {
        await rm(store, { recursive: true, force: true });
    }
});

test("parallel generative calls persist every start, completion and failure in order", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "topic-diagnostic-"),
    );
    try {
        const file = path.join(directory, "calls.json");
        const calls = [];
        let release;
        const barrier = new Promise((resolve) => {
            release = resolve;
        });
        const complete = recordDiagnosticCompletion(
            async (_rules, payload) => {
                if (payload.ordinal === 0) {
                    await barrier;
                    throw new Error("synthetic preparation failure");
                }
                release();
                return { ordinal: payload.ordinal };
            },
            file,
            calls,
        );
        const results = await Promise.allSettled([
            complete("rules", { ordinal: 0 }, {}, { phase: "preparation" }),
            complete("rules", { ordinal: 1 }, {}, { phase: "preparation" }),
        ]);
        assert.deepEqual(
            results.map((result) => result.status),
            ["rejected", "fulfilled"],
        );
        const saved = JSON.parse(await readFile(file, "utf8"));
        assert.deepEqual(
            saved.map((call) => call.outcome),
            ["failed", "success"],
        );
        assert(saved.every((call) => call.providerDurationMs >= 0));
        assert.match(saved[0].error, /synthetic preparation/);
        assert.deepEqual(saved[1].response, { ordinal: 1 });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("failed native calls preserve their failure receipts and remain uncertain", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "topic-diagnostic-"),
    );
    try {
        const { snapshot, window, prior, prepared, nodes } = fixture();
        const model = {
            provider: "test",
            model: "test",
            configGeneration: getRuntimeConfigGeneration(),
            decide: async () => ({
                success: false,
                message: "synthetic native failure",
                code: "transport",
            }),
        };
        const { receipts, failures } = await nativeWindow(
            snapshot,
            window,
            model,
            new AbortController().signal,
            directory,
        );
        assert.equal(receipts[0].outcome, "failed");
        assert.equal(failures.length, 1);
        const saved = JSON.parse(
            await readFile(
                path.join(directory, "native-receipts.json"),
                "utf8",
            ),
        );
        assert.equal(saved[0].code, "transport");
        const rows = reconciliationComparison(
            window,
            {
                concepts: [prior, prepared],
                deferred: [{ nodeId: nodes[2].id, reason: "Needs context" }],
            },
            receipts,
        );
        assert.equal(rows.length, 2);
        assert(rows.every((row) => row.outcome === "uncertain-partitions"));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("a consumed diagnostic budget rejects before dispatch", async () => {
    let dispatches = 0;
    const calls = [];
    const complete = recordDiagnosticCompletion(
        async () => {
            dispatches++;
        },
        "unused.json",
        calls,
        () => {
            throw new Error("budget exhausted");
        },
    );
    await assert.rejects(complete("rules", {}, {}), /budget exhausted/);
    assert.equal(dispatches, 0);
    assert.equal(calls.length, 0);
});

test("native budget interruption dispatches nothing further and accounts for every uncalled raw", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "topic-diagnostic-"),
    );
    try {
        const { snapshot, window, prior, prepared, nodes } = fixture();
        const controller = new AbortController();
        let dispatches = 0;
        const model = {
            provider: "test",
            model: "test",
            configGeneration: getRuntimeConfigGeneration(),
            decide: async () => {
                dispatches++;
            },
        };
        const interrupted = await nativeWindow(
            snapshot,
            window,
            model,
            controller.signal,
            directory,
            () => {
                controller.abort(new Error("synthetic call cap"));
                controller.signal.throwIfAborted();
            },
        );
        assert.match(interrupted.interruption, /synthetic call cap/);
        assert.equal(interrupted.failures[0].attempted, false);
        assert.equal(dispatches, 0);
        const curation = {
            concepts: [prior, prepared],
            deferred: [{ nodeId: nodes[2].id, reason: "Needs context" }],
        };
        const rows = reconciliationComparison(
            window,
            curation,
            interrupted.receipts,
        );
        const summary = diagnosticSummary(
            [window],
            [{ outcome: "interrupted", rows }],
            undefined,
            { maxCalls: 1, logicalCalls: 1 },
        );
        assert.equal(summary.status, "partial-or-failed");
        assert.equal(summary.expectedCandidates, 2);
        assert.equal(summary.answeredCandidates, 0);
        assert.equal(summary.dispositionAgreements, 0);
        const incomplete = diagnosticSummary(
            [window, window],
            [{ outcome: "complete", rows }],
            undefined,
            {},
        );
        assert.equal(incomplete.expectedCandidates, 4);
        assert.equal(incomplete.unobservedCandidates, 2);
        assert.equal(incomplete.status, "partial-or-failed");
        const missingRows = diagnosticSummary(
            [window],
            [{ outcome: "complete", rows: [] }],
            undefined,
            {},
        );
        assert.equal(missingRows.status, "partial-or-failed");
        assert.equal(missingRows.unobservedCandidates, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("native budget interruption retains earlier packet answers", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "topic-diagnostic-"),
    );
    try {
        const { snapshot, window, nodes, prior, prepared } = fixture(80);
        window.prepared[0].deferred = nodes.slice(2).map((node) => ({
            nodeId: node.id,
            reason: "Needs context",
        }));
        const controller = new AbortController();
        let reservations = 0;
        const model = {
            provider: "test",
            model: "test",
            configGeneration: getRuntimeConfigGeneration(),
            decide: async (request) => ({
                success: true,
                data: {
                    answers: Object.fromEntries(
                        Object.keys(request.questions).map((key) => [
                            key,
                            {
                                type: "choice",
                                choice: "standalone_new",
                                probabilities: { standalone_new: 1 },
                            },
                        ]),
                    ),
                },
            }),
        };
        const interrupted = await nativeWindow(
            snapshot,
            window,
            model,
            controller.signal,
            directory,
            () => {
                if (++reservations === 2) {
                    controller.abort(new Error("synthetic call cap"));
                    controller.signal.throwIfAborted();
                }
            },
        );
        assert.equal(reservations, 2);
        assert.equal(interrupted.receipts.length, 1);
        assert.match(interrupted.interruption, /synthetic call cap/);
        const rows = reconciliationComparison(
            window,
            {
                concepts: [prior, prepared],
                deferred: window.prepared[0].deferred,
            },
            interrupted.receipts,
        );
        assert.equal(rows.length, 79);
        assert(rows.some((row) => row.answers.length > 0));
        assert(rows.some((row) => row.answers.length === 0));
        const saved = JSON.parse(
            await readFile(
                path.join(directory, "native-receipts.json"),
                "utf8",
            ),
        );
        assert.equal(saved[0].outcome, "success");
        assert.equal(saved.length, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("a later generative failure retains completed diagnostic windows", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "topic-diagnostic-"),
    );
    try {
        const { snapshot } = fixture(50);
        let preparations = 0;
        const { windows, failure } = await captureWindows(
            snapshot,
            async (_rules, payload, _schema, call) => {
                if (call.phase === "preparation" && ++preparations === 3)
                    throw new Error("synthetic later-window failure");
                return {
                    concepts: [
                        {
                            label: "Installation approval",
                            scope: "Service",
                            purpose:
                                "Explain the installation approval requirement",
                            memberIds: payload.nodes.map((node) => node.id),
                            evidenceIds: [
                                ...new Set(
                                    payload.nodes.flatMap(
                                        (node) => node.evidenceIds,
                                    ),
                                ),
                            ],
                            salience: 4,
                        },
                    ],
                    deferred: [],
                };
            },
            new AbortController().signal,
            directory,
            5,
        );
        assert.equal(windows.length, 1);
        assert.match(failure, /synthetic later-window/);
        const saved = JSON.parse(
            await readFile(path.join(directory, "windows.json"), "utf8"),
        );
        assert.equal(saved[0].curation.concepts[0].memberIds.length, 48);
        const rejected = JSON.parse(
            await readFile(
                path.join(directory, "capture-failure.json"),
                "utf8",
            ),
        );
        assert.equal(rejected.completedWindows, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
