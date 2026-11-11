// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { runStorageWriteBenchmark } from "./storage-write-benchmark.mjs";

test("batch group experiments count actual commits and retain every searchable source", async () => {
    for (const [groupSize, memberCount, expectedGroups] of [
        [2, 8, 4],
        [8, 8, 1],
        [16, 51, 5],
    ]) {
        const result = await runStorageWriteBenchmark(1, "batch", {
            groupSize,
            memberCount,
        });
        const workload = Object.values(result.workloads)[0];
        assert.equal(workload.memberCount, memberCount);
        assert.equal(workload.groupSize, groupSize);
        assert.equal(workload.batchRequestCount, Math.ceil(memberCount / 50));
        const observation = workload.observations[0];
        assert.equal(observation.indexCopies, expectedGroups);
        assert.equal(observation.manifestWrites, expectedGroups);
        assert.equal(observation.providerBatches, expectedGroups);
        assert.equal(observation.providerDocuments, memberCount);
        assert.ok(observation.firstMemberReadyMs > 0);
        assert.ok(observation.firstMemberReadyMs <= observation.elapsedMs);
    }
});

test("invalid experiment configuration fails before creating a workload", async () => {
    await assert.rejects(runStorageWriteBenchmark(0), /Samples must be 1-100/);
    await assert.rejects(
        runStorageWriteBenchmark(1, "unknown"),
        /Invalid storage workload/,
    );
    await assert.rejects(
        runStorageWriteBenchmark(1, "batch", { groupSize: 101 }),
        /at most 100/,
    );
    await assert.rejects(
        runStorageWriteBenchmark(1, "batch", { memberCount: 513 }),
        /Batch member count must be 1-512/,
    );
    await assert.rejects(
        runStorageWriteBenchmark(1, "replace", { groupSize: 8 }),
        /Group options require/,
    );
});
