// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { hashValue } from "./replay-artifacts.mjs";

export async function replayIndexStorage(source, samples, output) {
    const {
        isSegmentedJson,
        clearJsonSegmentCache,
        readSegmentedJson,
        writeSegmentedJson,
    } = await import("../../packages/knowPro/dist/segmentedJson.js");
    const descriptor = JSON.parse(await readFile(source, "utf8"));
    assert.ok(
        isSegmentedJson(descriptor),
        "Expected a segmented index manifest",
    );
    clearJsonSegmentCache(path.dirname(path.dirname(source)));
    const started = performance.now();
    const value = await readSegmentedJson(source, descriptor);
    const loadMs = performance.now() - started;
    const writes = [];
    for (let sample = 0; sample < samples; sample++) {
        const scratch = await mkdtemp(path.join(output, "index-storage-"));
        try {
            const generation = path.join(scratch, "generation");
            await mkdir(generation);
            const target = path.join(generation, "corpus_data.json");
            const timed = async () => {
                let newArtifacts = 0;
                const cpu = process.cpuUsage(),
                    start = performance.now();
                await writeSegmentedJson(
                    target,
                    value,
                    descriptor.metadata,
                    async (point) => {
                        if (point === "segment-written") newArtifacts++;
                    },
                );
                const used = process.cpuUsage(cpu);
                return {
                    elapsedMs: performance.now() - start,
                    cpuMs: (used.user + used.system) / 1000,
                    newArtifacts,
                };
            };
            const cold = await timed(),
                unchanged = await timed();
            const saved = JSON.parse(await readFile(target, "utf8"));
            assert.deepEqual(
                await readSegmentedJson(target, saved),
                value,
                "Index persistence changed the retained payload",
            );
            assert.equal(unchanged.newArtifacts, 0);
            writes.push({ cold, unchanged });
        } finally {
            clearJsonSegmentCache(scratch);
            await rm(scratch, { recursive: true, force: true });
        }
    }
    return {
        sourceManifestHash: hashValue(descriptor),
        metadata: descriptor.metadata,
        loadMs,
        writes,
        payloadParity: true,
    };
}

export async function replayViewStorage(state, samples, output) {
    assert.ok(state, "Storage mode requires a retained --history state");
    const { ViewHistory } = await import(
        "../../packages/memory/service/dist/viewHistory.js"
    );
    const commits = [];
    for (let sample = 0; sample < samples; sample++) {
        const scratch = await mkdtemp(path.join(output, "view-storage-"));
        try {
            const history = new ViewHistory(
                path.join(scratch, "views"),
                () => ({ views: {} }),
            );
            const started = performance.now();
            await history.commit(
                null,
                structuredClone(state),
                {},
                "offline-replay",
                "Frozen topic persistence replay",
            );
            const retained = await history.read();
            assert.deepEqual(
                retained.state,
                state,
                "View persistence changed the retained payload",
            );
            commits.push(performance.now() - started);
        } finally {
            await rm(scratch, { recursive: true, force: true });
        }
    }
    return {
        commits,
        stateBytes: Buffer.byteLength(JSON.stringify(state)),
        payloadParity: true,
    };
}
