// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    collectLatencyTiming,
    createLatencyReporter,
    latencyProgress,
} from "../dist/memoryBench/longmemeval/latency.mjs";
import { recordBenchmarkArm } from "../dist/memoryBench/longmemeval/spec.mjs";

test("frozen benchmark arm records the observed admission policy and refuses policy drift", () => {
    const state = {};
    const capabilities = {
        accessAdmissionPolicy: "foreground-fair-v1",
        features: { sourceSynopses: true },
        derivedViews: { informationalWiki: true, drafts: true },
    };
    recordBenchmarkArm(state, capabilities, false);
    assert.equal(state.arm.accessAdmissionPolicy, "foreground-fair-v1");
    recordBenchmarkArm(state, capabilities, true);
    assert.throws(
        () =>
            recordBenchmarkArm(
                state,
                {
                    ...capabilities,
                    accessAdmissionPolicy: "changed",
                },
                true,
            ),
        /Product memory configuration changed/,
    );
});

function fixture() {
    return {
        construction: [
            { id: "q", sessions: Array.from({ length: 15 }, () => ({})) },
        ],
        state: {
            runId: "latency-test",
            outcome: "IN_PROGRESS",
            currentQuestionId: "q",
            cases: {
                q: {
                    corpusId: "corpus",
                    status: "ingesting",
                    operations: [],
                    inFlight: {
                        jobId: "active",
                        sourceBytes: 1024,
                        startedEpochMs: 1000,
                    },
                },
            },
        },
        attempt: { questionIds: ["q"] },
    };
}

function timing(stage, elapsedMs, priority = "ingestion") {
    return {
        stage,
        elapsedMs,
        traceId: "job",
        metadata: { access: "write", priority, query: "PRIVATE SOURCE TEXT" },
    };
}

test("job timings separate wait from hold, retain maxima and ignore overlapping legacy timings", () => {
    const jobs = new Map();
    const totals = new Map();
    for (const event of [
        timing("access.queue.wait", 20),
        timing("access.queue.wait", 30),
        timing("queue.wait", 5000),
        timing("access.work", 5),
        timing("access.work", 8),
        timing("ingestion.total", 90),
        timing("access.work", 1000, "maintenance"),
    ])
        collectLatencyTiming(jobs, event, totals);
    assert.deepEqual(jobs.get("job"), {
        writeWaitMs: 50,
        maxWriteWaitMs: 30,
        writeHoldMs: 13,
        maxWriteHoldMs: 8,
        productTotalMs: 90,
        writeWaitCount: 2,
        writeHoldCount: 2,
    });
    assert.equal(totals.get("maintenance:write:Hold").totalMs, 1000);
    assert.equal(totals.get("ingestion:write:Wait").count, 2);
    assert.equal(JSON.stringify([...jobs]).includes("PRIVATE"), false);
    assert.throws(() => collectLatencyTiming(jobs, timing("access.work", NaN)));
    assert.throws(() => collectLatencyTiming(jobs, timing("access.work", -1)));
    assert.throws(() =>
        collectLatencyTiming(jobs, timing("access.work", 1, "PRIVATE")),
    );
});

test("snapshot exposes exact per-corpus cohorts, bytes, memory and explicit missing measurements", () => {
    const { construction, state, attempt } = fixture();
    state.cases.q.operations = Array.from({ length: 12 }, (_, index) => ({
        jobId: `job-${index}`,
        sourceBytes: (index + 1) * 100,
        latency: { driverElapsedMs: (index + 1) * 10 },
    }));
    const report = latencyProgress(
        construction,
        state,
        attempt,
        new Map(),
        2000,
    );
    assert.equal(report.completedHistories, 12);
    assert.equal(report.completedSourceBytes, 7800);
    assert.equal(report.histories[11].cumulativeCorpusSourceBytes, 7800);
    assert.equal(report.histories[11].cumulativeRunHistories, 12);
    assert.equal(report.firstFive.driverElapsedMs.p50Ms, 30);
    assert.equal(report.lastFive.driverElapsedMs.p50Ms, 100);
    assert.equal(report.all.driverElapsedMs.p95Ms, 114.5);
    assert.equal(report.questions[0].firstFiveMedianSourceBytes, 300);
    assert.equal(report.questions[0].lastFiveMedianSourceBytes, 1000);
    assert.equal(report.questions[0].nonOverlappingCohorts, true);
    assert.equal(report.currentOperation.elapsedMs, 1000);
    assert.equal(report.currentOperation.observedTimings, null);
    assert.equal(report.histories[0].writeWaitMs, null);
    assert.equal(report.all.writeWaitMs.p95Ms, null);
    assert.equal(report.all.writeWaitMs.samples, 0);
    assert.ok(report.memoryBytes.rss > 0);
    assert.equal(report.workerPid, process.pid);
    assert.equal(report.progress.currentQuestion.historiesTotal, 15);
    assert.equal(report.progress.targetQuestions, 1);
    state.cases.q.operations = [];
    const empty = latencyProgress(
        construction,
        state,
        attempt,
        new Map(),
        2000,
    );
    assert.equal(empty.nonOverlappingCohorts, false);
    assert.equal(empty.firstFiveMedianSourceBytes, null);
});

test("periodic snapshots are single-flight, final flush is durable, and observer and timer are restored", async (context) => {
    const runDirectory = await mkdtemp(
        path.join(os.tmpdir(), "longmemeval-latency-"),
    );
    const original = console.warn;
    console.warn = () => {};
    const forwarded = console.warn;
    context.mock.timers.enable({ apis: ["setInterval"] });
    const reporter = createLatencyReporter({ runDirectory, ...fixture() });
    try {
        console.warn(
            `[memory-search-timing] ${JSON.stringify(timing("access.work", 7))}`,
        );
        context.mock.timers.tick(15000);
        const first = reporter.flush();
        context.mock.timers.tick(60000);
        assert.equal(reporter.flush(), first);
        await first;
        reporter.assertHealthy();
        await reporter.close();
        assert.equal(console.warn, forwarded);
        const text = await readFile(
            path.join(runDirectory, "latency-progress.json"),
            "utf8",
        );
        const report = JSON.parse(text);
        assert.equal(report.accessByPriority[0].totalMs, 7);
        assert.equal(text.includes("PRIVATE"), false);
        context.mock.timers.tick(60000);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
            await readFile(
                path.join(runDirectory, "latency-progress.json"),
                "utf8",
            ),
            text,
        );
    } finally {
        await reporter.close();
        context.mock.timers.reset();
        console.warn = original;
        await rm(runDirectory, { recursive: true, force: true });
    }
});

test("malformed timing records fail reporter health and still restore the observer", async () => {
    const runDirectory = await mkdtemp(
        path.join(os.tmpdir(), "longmemeval-latency-invalid-"),
    );
    const original = console.warn;
    console.warn = () => {};
    const forwarded = console.warn;
    const reporter = createLatencyReporter({ runDirectory, ...fixture() });
    try {
        console.warn("[memory-search-timing] invalid PRIVATE");
        assert.throws(
            () => reporter.assertHealthy(),
            /Invalid product latency timing/,
        );
        await assert.rejects(
            reporter.close(),
            /Invalid product latency timing/,
        );
        assert.equal(console.warn, forwarded);
    } finally {
        console.warn = original;
        await rm(runDirectory, { recursive: true, force: true });
    }
});

test("snapshot IO failures are explicit and cannot become success-shaped latency reports", async () => {
    const runDirectory = await mkdtemp(
        path.join(os.tmpdir(), "longmemeval-latency-io-"),
    );
    const blocked = path.join(runDirectory, "file-not-directory");
    await writeFile(blocked, "fixture");
    const reporter = createLatencyReporter({
        runDirectory: blocked,
        ...fixture(),
    });
    try {
        await reporter.flush();
        assert.throws(() => reporter.assertHealthy(), /ENOENT|ENOTDIR|EEXIST/);
    } finally {
        await assert.rejects(reporter.close(), /ENOENT|ENOTDIR|EEXIST/);
        await rm(runDirectory, { recursive: true, force: true });
    }
});
