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
        "../../memory-maintenance-qualification/storage-write-benchmark.mjs",
        import.meta.url,
    ),
);

test(
    "storage runner verifies bounded changed-text writes, not a latency proxy",
    { timeout: 90_000 },
    async () => {
        const { stdout } = await execute(
            process.execPath,
            [runner, "--samples", "1"],
            { timeout: 85_000 },
        );
        const result = JSON.parse(stdout);
        assert.equal(result.configuration.provider, "offline-stubs");
        assert.match(result.commit, /^[a-f0-9]{40}$/);
        for (const hash of Object.values(result.checkpoint))
            assert.match(hash, /^[a-f0-9]{64}$/);
        for (const workload of Object.values(result.workloads)) {
            assert.equal(workload.observations.length, 1);
            const sample = workload.observations[0];
            assert.equal(sample.manifestWrites, 1);
            assert.equal(sample.textBlobWrites, 1);
            assert.ok(
                sample.textBlobBytes >= 65536 && sample.textBlobBytes < 66000,
            );
            assert.ok(sample.manifestBytes < workload.sourceCount * 2000);
            assert.equal(sample.providerDocuments, workload.sourceCount);
        }
    },
);

test(
    "batch runner verifies fewer copies/publications without skipping member provider work",
    { timeout: 60_000 },
    async () => {
        const { stdout } = await execute(
            process.execPath,
            [runner, "--workload", "batch", "--samples", "1"],
            { timeout: 55_000 },
        );
        const report = JSON.parse(stdout);
        const sample =
            report.workloads["batch-eight-new-sources"].observations[0];
        assert.equal(sample.providerDocuments, 8);
        assert.ok(sample.indexCopies >= 4 && sample.indexCopies < 8);
        assert.equal(sample.manifestWrites, sample.indexCopies);
        assert.equal(sample.providerBatches, sample.indexCopies);
    },
);

test("storage runner rejects invalid sample bounds", async () => {
    await assert.rejects(execute(process.execPath, [runner, "--samples", "0"]));
});

test(
    "delta runner verifies real extraction work and bounded segmented writes",
    { timeout: 90_000 },
    async () => {
        const { stdout } = await execute(
            process.execPath,
            [runner, "--workload", "delta", "--samples", "1"],
            { timeout: 85_000 },
        );
        const report = JSON.parse(stdout);
        assert.equal(
            report.workloads["replacement-full-rebuild"].observations[0]
                .providerDocuments,
            8,
        );
        assert.equal(
            report.workloads["replacement-delta"].observations[0]
                .providerDocuments,
            1,
        );
        const sample =
            report.workloads["segmented-append-1024"].observations[0];
        assert.ok(
            sample.segmentBytes + sample.descriptorBytes <
                sample.monolithicJsonBytes / 20,
        );
        assert.equal(sample.retainedSegmentsRewritten, 0);
    },
);
