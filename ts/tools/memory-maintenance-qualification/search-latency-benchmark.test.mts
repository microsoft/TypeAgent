// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    answerOutcomeStatus,
    intervalUnionMs,
    modelResponseDiagnostic,
    readCases,
    summarize,
} from "./search-latency-benchmark.mts";

test("private response diagnostics retain bounded model output, not unrelated fields", () => {
    const result = modelResponseDiagnostic({
        model: "test-model",
        choices: [{ message: { content: "x".repeat(70 * 1024) } }],
        unrelated: "not retained",
    });
    assert.equal(result.text.length, 64 * 1024);
    assert.equal(result.truncated, true);
    assert(!result.text.includes("not retained"));
    const short = modelResponseDiagnostic({
        model: "test-model",
        choices: [{ message: { content: '{"status":"noAnswer"}' } }],
    });
    assert.equal(short.truncated, false);
    assert.equal(JSON.parse(short.text).model, "test-model");
    assert.throws(() => modelResponseDiagnostic(null));
    assert.throws(() => modelResponseDiagnostic({}));
});

test("delivery labels do not invent a semantic outcome for integrated answers", () => {
    assert.equal(answerOutcomeStatus({}), "answer-returned");
    assert.equal(answerOutcomeStatus(undefined), "no-answer-returned");
    for (const status of [
        "answered",
        "partial",
        "needsClarification",
        "noAnswer",
    ])
        assert.equal(answerOutcomeStatus({ status }), status);
});

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
