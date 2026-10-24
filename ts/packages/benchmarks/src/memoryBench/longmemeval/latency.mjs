// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { writeJson } from "../shared/checkpoint.mjs";
import { percentile } from "./runner.mjs";
import { benchmarkProgress } from "./state.mjs";

const timingPrefix = "[memory-search-timing] ";
const metrics = [
    "driverElapsedMs",
    "jobElapsedMs",
    "productTotalMs",
    "readWaitMs",
    "writeWaitMs",
    "maxReadWaitMs",
    "maxWriteWaitMs",
    "readHoldMs",
    "writeHoldMs",
    "maxReadHoldMs",
    "maxWriteHoldMs",
];

export function collectLatencyTiming(jobs, event, priorityTotals) {
    if (
        !["access.queue.wait", "access.work", "ingestion.total"].includes(
            event.stage,
        )
    )
        return;
    assert.equal(typeof event.traceId, "string");
    assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
    const row = jobs.get(event.traceId) ?? {};
    if (event.stage === "ingestion.total") row.productTotalMs = event.elapsedMs;
    else {
        assert.ok(["read", "write"].includes(event.metadata?.access));
        const kind = event.stage === "access.queue.wait" ? "Wait" : "Hold";
        const priority = event.metadata.priority;
        assert.ok(
            ["critical", "interactive", "ingestion", "maintenance"].includes(
                priority,
            ),
        );
        if (priorityTotals) {
            const key = `${priority}:${event.metadata.access}:${kind}`;
            const total = priorityTotals.get(key) ?? {
                priority,
                access: event.metadata.access,
                kind,
                count: 0,
                totalMs: 0,
                maxMs: 0,
            };
            total.count++;
            total.totalMs += event.elapsedMs;
            total.maxMs = Math.max(total.maxMs, event.elapsedMs);
            priorityTotals.set(key, total);
        }
        // Maintenance can inherit an ingestion trace ID without being ingestion work.
        if (priority !== "ingestion") return;
        const field = `${event.metadata.access}${kind}Ms`;
        const maximum = `max${event.metadata.access === "read" ? "Read" : "Write"}${kind}Ms`;
        row[field] = (row[field] ?? 0) + event.elapsedMs;
        row[maximum] = Math.max(row[maximum] ?? 0, event.elapsedMs);
        const count = `${event.metadata.access}${kind}Count`;
        row[count] = (row[count] ?? 0) + 1;
    }
    jobs.set(event.traceId, row);
}

function summarize(rows) {
    return Object.fromEntries(
        metrics.map((key) => {
            const values = rows.map((row) => row[key]).filter(Number.isFinite);
            return [
                key,
                {
                    samples: values.length,
                    p50Ms: percentile(values, 0.5),
                    p95Ms: percentile(values, 0.95),
                    maxMs: values.length ? Math.max(...values) : null,
                },
            ];
        }),
    );
}

function cohorts(rows) {
    const first = rows.slice(0, 5);
    const last = rows.slice(-5);
    return {
        nonOverlappingCohorts: rows.length >= 10,
        firstFive: summarize(first),
        lastFive: summarize(last),
        firstFiveMedianSourceBytes: percentile(
            first.map((row) => row.sourceBytes).filter(Number.isFinite),
            0.5,
        ),
        lastFiveMedianSourceBytes: percentile(
            last.map((row) => row.sourceBytes).filter(Number.isFinite),
            0.5,
        ),
    };
}

export function latencyProgress(
    construction,
    state,
    attempt,
    jobs,
    now = Date.now(),
) {
    const histories = [];
    const questions = [];
    let cumulativeSourceBytes = 0;
    for (const id of attempt.questionIds) {
        const record = state.cases[id];
        let corpusSourceBytes = 0;
        const rows = (record?.operations ?? []).map((operation, index) => {
            corpusSourceBytes =
                Number.isFinite(operation.sourceBytes) &&
                corpusSourceBytes !== null
                    ? corpusSourceBytes + operation.sourceBytes
                    : null;
            cumulativeSourceBytes =
                Number.isFinite(operation.sourceBytes) &&
                cumulativeSourceBytes !== null
                    ? cumulativeSourceBytes + operation.sourceBytes
                    : null;
            return {
                ...Object.fromEntries(
                    [
                        ...metrics,
                        "readWaitCount",
                        "writeWaitCount",
                        "readHoldCount",
                        "writeHoldCount",
                    ].map((key) => [key, null]),
                ),
                questionId: id,
                corpusId: record.corpusId,
                history: index + 1,
                cumulativeRunHistories: histories.length + index + 1,
                cumulativeCorpusSourceBytes: corpusSourceBytes,
                cumulativeRunSourceBytes: cumulativeSourceBytes,
                jobId: operation.jobId ?? null,
                sourceBytes: operation.sourceBytes ?? null,
                ...operation.latency,
                ...jobs.get(operation.jobId),
            };
        });
        histories.push(...rows);
        questions.push({
            questionId: id,
            completedHistories: rows.length,
            answerMilliseconds: record?.answerMilliseconds ?? null,
            all: summarize(rows),
            ...cohorts(rows),
        });
    }
    const current = state.cases[state.currentQuestionId]?.inFlight;
    return {
        schemaVersion: 1,
        workerPid: process.pid,
        updatedAt: new Date(now).toISOString(),
        updatePolicy:
            "15-second single-flight snapshots and final flush; grading progress remains transition-driven",
        traceEnabled: process.env.TYPEAGENT_MEMORY_SEARCH_TRACE === "1",
        interpretation:
            "Elapsed nonexclusive timings; do not sum nested stages. Early/late cohorts differ in source size and content. Not a causal speedup or UI SLO claim.",
        progress: benchmarkProgress(construction, state, attempt),
        completedHistories: histories.length,
        completedSourceBytes: cumulativeSourceBytes,
        currentOperation: current
            ? {
                  jobId: current.jobId ?? null,
                  sourceBytes: current.sourceBytes ?? null,
                  elapsedMs: Number.isFinite(current.startedEpochMs)
                      ? now - current.startedEpochMs
                      : null,
                  observedTimings: jobs.get(current.jobId) ?? null,
              }
            : null,
        memoryBytes: process.memoryUsage(),
        all: summarize(histories),
        ...cohorts(histories),
        questions,
        histories,
    };
}

export function createLatencyReporter({
    runDirectory,
    construction,
    state,
    attempt,
}) {
    const jobs = new Map();
    const priorityTotals = new Map();
    const original = console.warn;
    let failure;
    let writing;
    const rememberFailure = (error) => {
        if (failure) return;
        failure = error;
        process.stderr.write(
            "LongMemEval latency reporting failed; the next persistence boundary will fail the run.\n",
        );
    };
    const observe = (...args) => {
        original.apply(console, args);
        if (typeof args[0] !== "string" || !args[0].startsWith(timingPrefix))
            return;
        try {
            collectLatencyTiming(
                jobs,
                JSON.parse(args[0].slice(timingPrefix.length)),
                priorityTotals,
            );
        } catch {
            rememberFailure(new Error("Invalid product latency timing record"));
        }
    };
    console.warn = observe;
    const snapshot = () => ({
        ...latencyProgress(construction, state, attempt, jobs),
        accessByPriority: [...priorityTotals.values()],
    });
    const report = () => {
        writing ??= Promise.resolve()
            .then(() =>
                writeJson(
                    path.join(runDirectory, "latency-progress.json"),
                    snapshot(),
                ),
            )
            .catch(rememberFailure)
            .finally(() => {
                writing = undefined;
            });
        return writing;
    };
    const timer = setInterval(() => {
        void report();
    }, 15_000);
    timer.unref();
    return {
        timings: (jobId) => jobs.get(jobId),
        flush: report,
        assertHealthy: () => {
            if (failure) throw failure;
        },
        async close() {
            clearInterval(timer);
            try {
                await writing;
                if (failure) throw failure;
                await report();
                if (failure) throw failure;
            } finally {
                if (console.warn === observe) console.warn = original;
            }
        },
    };
}
