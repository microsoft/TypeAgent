// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    runTopicWorkBenchmark,
    runContinuousTopicReplay,
} from "./topic-work-benchmark.mjs";

test("continuous append replay counts repeated work without changing latest dispositions", async () => {
    const result = await runContinuousTopicReplay(2);
    for (const { baseline, candidate } of result.pairs) {
        assert.equal(baseline.waves.length, 8);
        assert.equal(candidate.waves.length, 8);
        assert.ok(candidate.attempts < baseline.attempts);
        assert.ok(candidate.repeatedNodes < baseline.repeatedNodes);
        assert.deepEqual(
            candidate.waves.map(({ outputDigest }) => outputDigest),
            baseline.waves.map(({ outputDigest }) => outputDigest),
        );
    }
});

test("append-only packet treatment measures against whole-input reuse and preserves exact latest output", async () => {
    const result = await runTopicWorkBenchmark(2, true);
    assert.equal(result.workloads.length, 1);
    assert.equal(result.workloads[0].change, "append");
    for (const { baseline, candidate } of result.workloads[0].pairs) {
        assert.equal(baseline.providerAttempts, 6);
        assert.equal(candidate.providerAttempts, 2);
        assert.equal(candidate.replayedPackets, 1);
        assert.equal(candidate.replayedRawNodes, 48);
        assert.equal(candidate.accounting.deferred, 56);
        assert.equal(candidate.outputDigest, baseline.outputDigest);
    }
});

test("offline paired work benchmark has exact disposition parity and never hides zero-adoption outcomes", async () => {
    const result = await runTopicWorkBenchmark(2);
    assert.match(
        result.identity.files[
            "packages/memory/service/dist/topicCurationSettings.js"
        ],
        /^[a-f0-9]{64}$/,
    );
    assert.equal(result.workloads.length, 2);
    for (const workload of result.workloads) {
        assert.deepEqual(
            workload.pairs.map(({ order }) => order),
            [
                [false, true],
                [true, false],
            ],
        );
        for (const { baseline, candidate } of workload.pairs) {
            assert.equal(baseline.providerAttempts, 6);
            assert.equal(candidate.providerAttempts, 0);
            assert.equal(candidate.reusedDecisions, 55);
            assert.equal(baseline.outputDigest, candidate.outputDigest);
            assert.equal(candidate.accounting.admitted, 0);
            assert.equal(candidate.accounting.deferred, 55);
            assert.equal(candidate.accounting.unassigned, 0);
        }
    }
    await assert.rejects(runTopicWorkBenchmark(0), /Samples must be 1-100/);
});
