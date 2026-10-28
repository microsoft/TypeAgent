// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    intervalUnionMs,
    readCases,
    summarize,
} from "./search-latency-benchmark.mts";

test("overlapping provider intervals are counted once without mutating inputs", () => {
    const intervals: [number, number][] = [
        [4, 8],
        [1, 5],
        [12, 14],
        [2, 3],
    ];
    assert.equal(intervalUnionMs(intervals), 9);
    assert.deepEqual(intervals[0], [4, 8]);
    assert.equal(intervalUnionMs([]), 0);
    assert.throws(() => intervalUnionMs([[3, 2]]));
});

test("nearest-rank quantiles retain extreme samples and empty groups", () => {
    assert.deepEqual(summarize([30, 10, 20]), {
        count: 3,
        minMs: 10,
        p50Ms: 20,
        p95Ms: 30,
        maxMs: 30,
    });
    assert.equal(summarize([]).p50Ms, null);
});

test("case manifests reject duplicates and malformed inputs before a live run", () => {
    const item = { id: "one", corpusId: "corpus", question: "Which date?" };
    assert.deepEqual(readCases({ cases: [item] }), [item]);
    assert.throws(() => readCases({ cases: [item, item] }));
    assert.throws(() => readCases({ cases: [{ ...item, question: " " }] }));
    assert.throws(() =>
        readCases({ cases: [{ ...item, understand: "true" }] }),
    );
});
