// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    main,
    requestHash,
    summarizeWave,
    validateFrozenPackets,
} from "./topic-decision-sweep.mjs";

test("frozen waves reject request mutation and wrong accounting before inference", () => {
    const request = { state: "frozen", questions: {} };
    const frozen = {
        packets: [{ request, tokens: 20 }],
        requestHashes: [requestHash(request)],
    };
    const model = { model: "test", checkRequest: () => {} };
    validateFrozenPackets(frozen, model, () => 20);
    assert.throws(() => validateFrozenPackets(frozen, model, () => 21));
    frozen.packets[0].request.state = "changed";
    assert.throws(
        () => validateFrozenPackets(frozen, model, () => 20),
        /Frozen request changed/,
    );
});

test("wave metrics separate overlap, queueing and provider latency", () => {
    const rows = [
        {
            stage: "decision",
            outcome: "success",
            endedAtMs: 100,
            durationMs: 50,
            queueMs: 0,
            usage: { prompt_tokens: 100 },
        },
        {
            stage: "decision",
            outcome: "success",
            endedAtMs: 120,
            durationMs: 50,
            queueMs: 10,
            usage: { input_tokens: 200 },
        },
    ];
    const result = summarizeWave(rows, 70, 2);
    assert.equal(result.peakInFlight, 2);
    assert.equal(result.nativeMs, 100);
    assert.equal(result.durationMs, 70);
    assert.equal(result.meanQueueMs, 5);
    assert.equal(result.providerPromptTokens, 300);
    assert.throws(() => summarizeWave(rows, 70, 3), /all expected calls/);
});

test("sweep entrypoint refuses unauthorized inference before model or file loading", async () => {
    await assert.rejects(main([]), /authorization/);
});
