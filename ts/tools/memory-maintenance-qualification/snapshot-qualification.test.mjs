// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    assertCheckpoint,
    checkpointExpectationHash,
    closeOwnedService,
    createInitialStopControl,
    initialReadiness,
    installSnapshotQualification,
    validateSpec,
} from "./harness.mjs";
import { validateAdmission, workerArguments } from "./watchdog.mjs";

const productRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
);
const hashes = Object.fromEntries(
    ["indexedFragments.js", "informationalView.js", "fileMemoryService.js"].map(
        (name, index) => [
            path.join("packages", "memory", "service", "dist", name),
            String(index + 1).repeat(64),
        ],
    ),
);
const checkpoint = { name: "explicit-control-checkpoint", hashes };
const now = Date.now();
const spec = {
    mode: "offline",
    productRoot,
    fixtureRoot: path.join(
        productRoot,
        "packages",
        "memory",
        "service",
        "test",
        "fixtures",
        "memoryDemo",
    ),
    runDirectory: productRoot,
    receiptId: "control",
    spawnedEpochMs: now,
    startupAllowanceMs: 120000,
    workAllowanceMs: 900000,
    p6: true,
    performance: true,
    nativeProfile: false,
    stopInitialFailure: true,
    expectedCheckpoint: checkpoint,
};

test("explicit checkpoint rejects missing expectations, mismatches and forged admission binding", () => {
    assertCheckpoint(hashes, checkpoint);
    validateSpec(spec);
    assert.throws(() =>
        validateSpec({ ...spec, expectedCheckpoint: undefined }),
    );
    assert.throws(
        () =>
            assertCheckpoint(
                { ...hashes, [Object.keys(hashes)[0]]: "f".repeat(64) },
                checkpoint,
            ),
        /checkpoint mismatch/,
    );
    assert.throws(() =>
        assertCheckpoint(hashes, { name: "missing", hashes: {} }),
    );
    const ack = {
        receiptId: "control",
        workerPid: 1234,
        admittedEpochMs: now,
        workDeadlineEpochMs: now + spec.workAllowanceMs,
        checkpointExpectationHash: checkpointExpectationHash(checkpoint),
        compiledHashesHash: "a".repeat(64),
    };
    validateAdmission(ack, spec, 1234, now);
    assert.throws(() =>
        validateAdmission(
            { ...ack, checkpointExpectationHash: "b".repeat(64) },
            spec,
            1234,
            now,
        ),
    );
});

test("sparse native-off preserves worker spec but never starts a native profiler", () => {
    const args = workerArguments(spec, "worker.mjs", "spec.json");
    assert.deepEqual(args, ["worker.mjs", "--spec", "spec.json"]);
    assert.ok(
        workerArguments(
            { ...spec, nativeProfile: true },
            "worker.mjs",
            "spec.json",
        ).includes("--cpu-prof"),
    );
});

test("initial first timeout, cancellation and stale stop stay distinct and preserve first failure", () => {
    const job = {
        jobId: "job",
        results: [{ viewId: "target", snapshot: { fingerprint: "actual" } }],
    };
    for (const [state, reason, category] of [
        [
            "failed",
            "Evidence-first synthesis exceeded 120 second limit",
            "target-timeout",
        ],
        ["cancelled", "Caller cancelled", "target-cancellation"],
        ["stale", "Actual input fingerprint changed", "target-stale"],
        ["failed", "Exact citation unavailable", "target-failed"],
    ]) {
        const stop = createInitialStopControl();
        stop.observe("baseline", job, "target", state, reason);
        stop.observe("initial", job, "target", "draft", "ready");
        assert.equal(stop.failure(), undefined);
        stop.observe("initial", job, "target", state, reason);
        assert.equal(stop.failure().category, category);
        assert.equal(stop.failure().jobId, "job");
        assert.equal(stop.failure().viewId, "target");
        assert.equal(stop.failure().input.fingerprint, "actual");
        assert.throws(() => stop.check(), /Bounded initial stop/);
        stop.observe(
            "initial",
            job,
            "other",
            "cancelled",
            "close cancellation",
        );
        assert.equal(stop.failure().viewId, "target");
        stop.freeze();
        assert.equal(stop.failure().reason, reason);
    }
});

test("23 sources alone are not initial ready: pending, disabled and error statuses remain distinct", () => {
    const snapshot = {
        wikiFamily: { enabled: true, pending: false },
        projectFamily: { enabled: true, pending: false },
    };
    const topic = { family: { enabled: true, dirty: false } };
    const sources = Array.from({ length: 23 }, (_, id) => ({
        sourceId: String(id),
        activeRevisionId: "r",
        revisions: [{ revisionId: "r", synopsis: { status: "ready" } }],
    }));
    assert.equal(initialReadiness(snapshot, [], sources, topic).ready, true);
    assert.equal(
        initialReadiness(snapshot, [{ state: "running" }], sources, topic)
            .pending,
        true,
    );
    const errored = initialReadiness(
        {
            ...snapshot,
            wikiFamily: {
                ...snapshot.wikiFamily,
                error: "technical target parked",
            },
        },
        [],
        sources,
        topic,
    );
    assert.equal(errored.pending, false);
    assert.equal(errored.ready, false);
    assert.deepEqual(errored.errors, ["technical target parked"]);
    assert.equal(
        initialReadiness(snapshot, [], sources, {
            family: { enabled: false, dirty: false },
        }).ready,
        false,
    );
    assert.equal(
        initialReadiness(snapshot, [], sources, {
            family: { enabled: true, dirty: true },
        }).ready,
        false,
    );
});

test("chosen operation hydration observer preserves results, records exact bound and restores hooks", async () => {
    class History {
        async read() {
            return { head: "committed", state: {} };
        }
    }
    class Service {
        async listViews() {
            return new History().read();
        }
        async readConsolidationPairs() {
            await new History().read();
            return [];
        }
    }
    const original = History.prototype.read;
    const qualified = installSnapshotQualification(
        History,
        Service,
        () => "initial",
    );
    try {
        assert.equal((await new Service().listViews()).head, "committed");
        assert.deepEqual(await new Service().readConsolidationPairs(), []);
        assert.equal(qualified.summary.operations, 2);
        assert.equal(qualified.summary.hydrations, 2);
        assert.equal(qualified.summary.maxHydrations, 1);
        assert.deepEqual(qualified.summary.violations, []);
    } finally {
        qualified.restore();
    }
    assert.equal(History.prototype.read, original);
    const recovered = installSnapshotQualification(
        History,
        Service,
        () => "t1",
        qualified.summary,
    );
    try {
        await new Service().listViews();
        assert.equal(recovered.summary.operations, 3);
        assert.equal(recovered.summary.hydrations, 3);
        assert.equal(recovered.summary.maxHydrations, 1);
        assert.equal(qualified.summary.operations, 2);
    } finally {
        recovered.restore();
    }
});

test("supported actual close exits without model work and close errors never become success", async () => {
    const root = await mkdtemp(
        path.join(productRoot, ".snapshot-close-control-"),
    );
    const { FileMemoryService } = await import(
        pathToFileURL(
            path.join(
                productRoot,
                "packages",
                "memory",
                "service",
                "dist",
                "fileMemoryService.js",
            ),
        ).href
    );
    const service = new FileMemoryService(root, {
        viewDrafts: false,
        informationalViews: false,
        sourceSynopses: false,
        viewSynthesisAdapter: {
            model: "offline-control",
            generate() {
                throw new Error("No inference permitted");
            },
        },
    });
    try {
        await service.initialize();
        assert.equal((await closeOwnedService(service)).completed, true);
        assert.equal(service.closed, true);
        const failed = await closeOwnedService({
            close() {
                throw new Error("close failure");
            },
        });
        assert.equal(failed.completed, false);
        assert.equal(failed.error.message, "close failure");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
