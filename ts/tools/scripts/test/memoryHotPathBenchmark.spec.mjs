// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const runner = fileURLToPath(
    new URL(
        "../../memory-maintenance-qualification/hot-path-benchmark.mjs",
        import.meta.url,
    ),
);

test(
    "offline hot-path runner emits checked, reproducible observations",
    { timeout: 60_000 },
    async () => {
        const { stdout } = await execute(
            process.execPath,
            [runner, "--samples", "1", "--warmups", "0"],
            { timeout: 55_000 },
        );
        const result = JSON.parse(stdout);
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.configuration.provider, "offline-stubs");
        assert.match(result.commit, /^[0-9a-f]{40}$/);
        for (const hash of Object.values(result.checkpoint))
            assert.match(hash, /^[0-9a-f]{64}$/);
        for (const workload of Object.values(result.workloads)) {
            assert.equal(workload.observations.length, 1);
            assert.ok(workload.elapsedMs.p50 >= 0);
            assert.ok(workload.elapsedMs.p95 >= workload.elapsedMs.p50);
        }
        assert.equal(
            result.workloads["topic-256k"].observations[0]
                .fullStateSerializations,
            0,
        );
        assert.equal(
            result.workloads["macro-4-capabilities"].observations[0].maxActive,
            4,
        );
        assert.equal(
            typeof result.workloads["reindex-concurrent-read"].observations[0]
                .readCompletedDuringPreparation,
            "boolean",
        );
    },
);

test("offline hot-path runner rejects invalid sample bounds", async () => {
    await assert.rejects(
        execute(process.execPath, [runner, "--samples", "0"]),
        /Command failed/,
    );
});
