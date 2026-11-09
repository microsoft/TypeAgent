// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMetrics, thresholds } from "./benchmark.mjs";

const metric = {
    pages: 100,
    byteHash: "fixture",
    artifactDigest: "artifact",
    loadMs: 100,
    extractionMs: 9800,
    preparationMs: 100,
    totalMs: 10000,
    heapGrowthMiB: 30,
    rssGrowthMiB: 40,
    maxTimerGapMs: 20,
    timerTicks: 200,
    pageBoundaryYields: 100,
    cancel: { latencyMs: 2 },
    postLastPageCancel: { latencyMs: 2 },
};

test("benchmark accepts valid metrics", () => checkMetrics(metric, metric));
test("fast extraction need not produce one 10ms sample per page", () =>
    checkMetrics({ ...metric, timerTicks: 1 }));
for (const field of [
    "loadMs",
    "extractionMs",
    "preparationMs",
    "heapGrowthMiB",
    "rssGrowthMiB",
    "maxTimerGapMs",
    "timerTicks",
    "pageBoundaryYields",
]) {
    test(`benchmark rejects missing or nonfinite ${field}`, () => {
        for (const value of [undefined, NaN, Infinity, -1])
            assert.throws(() => checkMetrics({ ...metric, [field]: value }));
    });
}
for (const [field, value] of [
    ["loadMs", thresholds.loadMs + 1],
    [
        "totalMs",
        thresholds.loadMs + thresholds.totalMsPerPage * metric.pages + 1,
    ],
    ["heapGrowthMiB", thresholds.heapGrowthMiB + 1],
    ["rssGrowthMiB", thresholds.rssGrowthMiB + 1],
    ["maxTimerGapMs", thresholds.maxTimerGapMs + 1],
    ["timerTicks", 0],
    ["pageBoundaryYields", metric.pages - 1],
    ["cancel", { latencyMs: thresholds.cancelMs + 1 }],
    ["postLastPageCancel", { latencyMs: thresholds.cancelMs + 1 }],
]) {
    test(`benchmark rejects breached ${field}`, () => {
        assert.throws(() => checkMetrics({ ...metric, [field]: value }));
    });
}
test("benchmark rejects incompatible content and relative performance regressions", () => {
    assert.throws(
        () => checkMetrics({ ...metric, byteHash: "changed" }, metric),
        /identical/,
    );
    assert.throws(
        () => checkMetrics({ ...metric, artifactDigest: "changed" }, metric),
        /content changed/,
    );
    for (const field of ["totalMs", "heapGrowthMiB", "rssGrowthMiB"])
        assert.throws(
            () =>
                checkMetrics(
                    { ...metric, [field]: metric[field] * 1.51 },
                    metric,
                ),
            /regression/,
        );
});
