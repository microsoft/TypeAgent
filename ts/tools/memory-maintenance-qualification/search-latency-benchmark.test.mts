// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    answerOutcomeStatus,
    benchmarkOptions,
    intervalUnionMs,
    modelResponseDiagnostic,
    providerUsage,
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

test("Responses API diagnostics and usage retain only bounded output and metrics", () => {
    const response = {
        model: "gpt-6.1-terra",
        output: [
            {
                type: "message",
                content: [
                    { type: "output_text", text: '{"status":"noAnswer"}' },
                ],
            },
        ],
        input: "private prompt not retained",
        headers: { authorization: "not retained" },
        usage: {
            input_tokens: 123,
            output_tokens: 45,
            input_tokens_details: { cached_tokens: 100 },
            output_tokens_details: { reasoning_tokens: 12 },
        },
    };
    const diagnostic = modelResponseDiagnostic(response);
    assert.equal(diagnostic.truncated, false);
    assert.deepEqual(JSON.parse(diagnostic.text), {
        model: response.model,
        output: response.output,
    });
    assert.deepEqual(providerUsage(response), {
        model: "gpt-6.1-terra",
        inputTokens: 123,
        outputTokens: 45,
        cachedTokens: 100,
        reasoningTokens: 12,
    });
    assert.equal(
        modelResponseDiagnostic({ output_text: "x".repeat(70 * 1024) })
            .truncated,
        true,
    );
    assert.deepEqual(
        providerUsage({
            usage: {
                prompt_tokens: 123,
                completion_tokens: 45,
                prompt_tokens_details: { cached_tokens: 100 },
                completion_tokens_details: { reasoning_tokens: 12 },
            },
        }),
        {
            inputTokens: 123,
            outputTokens: 45,
            cachedTokens: 100,
            reasoningTokens: 12,
        },
    );
});

test("benchmark role options are independent and reject empty explicit models", () => {
    const required = [
        "--store",
        "source",
        "--out",
        "output",
        "--cases",
        "cases.json",
        "--allow-model-calls",
    ];
    const options = benchmarkOptions([
        ...required,
        "--fast-model",
        "gpt_5_4_mini",
        "--initial-reader-model",
        "gpt_6_1_terra",
        "--answer-model",
        "gpt_6_1_terra",
    ]);
    assert.equal(options.values["fast-model"], "gpt_5_4_mini");
    assert.equal(options.values["initial-reader-model"], "gpt_6_1_terra");
    assert.equal(options.values["answer-model"], "gpt_6_1_terra");
    assert.equal(benchmarkOptions(required).values["answer-model"], undefined);
    for (const flag of ["fast-model", "initial-reader-model", "answer-model"])
        assert.throws(() => benchmarkOptions([...required, `--${flag}`, " "]));
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
