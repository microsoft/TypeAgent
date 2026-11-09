// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    readConversationDataFromFile,
    writeConversationDataToFile,
} from "../packages/knowPro/dist/serialization.js";
import { collectJsonSegments } from "../packages/knowPro/dist/segmentedJson.js";
import { StageProfiler } from "./agent-session-qualification/profile.mjs";

const dimensions = 1536;
const stages = [128, 160, 192];
const identity = {
    schemaVersion: 1,
    provider: "synthetic",
    model: "storage-regression",
    revision: "1",
    dimensions,
    task: "document",
    prompt: "",
    pooling: "mean",
    normalization: "l2",
    preprocessing: "fixed-storage-v1",
    artifactHash: "a".repeat(64),
};

function fixture() {
    return Array.from({ length: stages.at(-1) }, (_, ordinal) => {
        const values = Array.from({ length: dimensions }, (_, lane) =>
            Math.sin((ordinal + 1) * (lane + 1) * 0.017),
        );
        const norm = Math.sqrt(values.reduce((n, x) => n + x * x, 0));
        return {
            message: {
                textChunks: [
                    `Fixed extracted record ${ordinal}: ${"grounded task knowledge ".repeat(32)}`,
                ],
                tags: ["storage-regression"],
            },
            vector: new Float32Array(values.map((x) => x / norm)),
        };
    });
}

async function inventory(directory) {
    let files = 0;
    let bytes = 0;
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, item.name);
        if (item.isDirectory()) {
            const child = await inventory(target);
            files += child.files;
            bytes += child.bytes;
        } else {
            files++;
            bytes += (await fs.stat(target)).size;
        }
    }
    return { files, bytes };
}

async function measure(name, operation) {
    const profiler = new StageProfiler();
    profiler.installFilesystem();
    let result;
    try {
        await profiler.measure(name, "benchmark", 10, operation);
    } finally {
        result = profiler.close();
    }
    return result;
}

export async function benchmark(output) {
    await fs.mkdir(output, { recursive: true });
    const state = path.join(output, "state");
    await fs.mkdir(state, { recursive: false });
    const records = fixture();
    const inputHash = createHash("sha256");
    for (const record of records) {
        inputHash.update(JSON.stringify(record.message));
        const bytes = Buffer.alloc(record.vector.length * 4);
        record.vector.forEach((value, index) =>
            bytes.writeFloatLE(value, index * 4),
        );
        inputHash.update(bytes);
    }
    const result = {
        schemaVersion: 1,
        recipe: "fixed-storage-v1",
        dimensions,
        vectorCounts: stages,
        inputHash: inputHash.digest("hex"),
        qualification:
            "Deterministic synthetic storage comparison, not a model or production-scale evaluation.",
        layouts: [],
    };
    for (const segmented of [true, false]) {
        const layout = segmented ? "segmented" : "binary-snapshot";
        const root = path.join(state, layout);
        const steps = [];
        for (const count of stages) {
            const selected = records.slice(0, count);
            const data = {
                nameTag: "fixed-storage",
                tags: [],
                semanticRefs: [],
                messages: selected.map((x) => x.message),
                messageIndexData: {
                    messageCount: count,
                    indexData: {
                        embeddings: selected.map((x) => x.vector),
                        textLocations: selected.map((_, messageOrdinal) => ({
                            messageOrdinal,
                            chunkOrdinal: 0,
                        })),
                    },
                },
            };
            const directory = path.join(root, `generation-${count}`);
            await fs.mkdir(directory, { recursive: true });
            const write = await measure("storage.write", () =>
                writeConversationDataToFile(
                    data,
                    directory,
                    "corpus",
                    { embeddingSize: dimensions },
                    { message: identity },
                    segmented,
                ),
            );
            const read = await measure("storage.read", async () => {
                const loaded = await readConversationDataFromFile(
                    directory,
                    "corpus",
                    dimensions,
                    { message: identity },
                );
                assert.deepEqual(loaded.messages, data.messages);
                assert.equal(
                    loaded.messageIndexData.indexData.embeddings.length,
                    count,
                );
                selected.forEach((record, index) =>
                    assert.deepEqual(
                        loaded.messageIndexData.indexData.embeddings[index],
                        record.vector,
                    ),
                );
            });
            const collection = segmented
                ? await measure("storage.collection", () =>
                      collectJsonSegments(root),
                  )
                : undefined;
            steps.push({ count, write, read, collection });
        }
        result.layouts.push({
            layout,
            steps,
            inventory: await inventory(root),
        });
    }
    await fs.writeFile(
        path.join(output, "receipt.json"),
        JSON.stringify(result, null, 2) + "\n",
    );
    return result;
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    const output = process.argv[2];
    if (!output) throw new Error("An unused output directory is required");
    benchmark(path.resolve(output)).then(
        (result) =>
            process.stdout.write(
                JSON.stringify({
                    inputHash: result.inputHash,
                    layouts: result.layouts.map(({ layout, inventory }) => ({
                        layout,
                        ...inventory,
                    })),
                }) + "\n",
            ),
        (error) => {
            console.error(error);
            process.exitCode = 1;
        },
    );
}
