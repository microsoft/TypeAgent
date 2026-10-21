// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test(
    "macro runtime runner verifies warm reuse and bounded read concurrency",
    { timeout: 60_000 },
    async () => {
        const runner = fileURLToPath(
            new URL(
                "../../memory-maintenance-qualification/macro-runtime-benchmark.mjs",
                import.meta.url,
            ),
        );
        const { stdout } = await promisify(execFile)(
            process.execPath,
            [runner, "--samples", "1"],
            { timeout: 55_000 },
        );
        const result = JSON.parse(stdout);
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.mode, "owned-reusable-workers");
        assert.equal(result.configuration.provider, "offline-stubs");
        for (const hash of Object.values(result.checkpoint))
            assert.match(hash, /^[a-f0-9]{64}$/);
        assert.deepEqual(Object.keys(result.workloads), [
            "single",
            "parallel-reads",
            "concurrent-4",
            "concurrent-8",
        ]);
        for (const workload of Object.values(result.workloads)) {
            assert.equal(workload.observations.length, 2);
            assert.equal(workload.observations[0].phase, "cold");
            const warm = workload.observations[1];
            assert.equal(warm.phase, "warm");
            assert.ok(warm.workerReused.every((value) => value === true));
            assert.ok(
                warm.queueMs.every(
                    (value) => Number.isFinite(value) && value >= 0,
                ),
            );
            assert.equal(workload.warmElapsedMs.samples.length, 1);
            assert.ok(
                warm.maxActiveCalls <= (workload.parallel ? 4 : workload.width),
            );
        }
        assert.equal(
            result.workloads["parallel-reads"].observations[1].maxActiveCalls,
            4,
        );
    },
);
