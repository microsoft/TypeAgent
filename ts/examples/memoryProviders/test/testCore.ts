// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import os from "node:os";
import { createNormalized, ensureDir, NormalizedEmbedding } from "typeagent";
import { hasEnvSettings, openai } from "aiclient";
import * as knowLib from "knowledge-processor";

export function skipTest(name: string) {
    return test.skip(name, () => {});
}

export function testIf(
    name: string,
    runIf: () => boolean,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (!runIf()) {
        return test.skip(name, () => {});
    }
    return test(name, fn, testTimeout);
}

export function hasEmbeddingEndpoint(endpoint?: string | undefined) {
    return hasEnvSettings(
        process.env,
        openai.EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING,
        endpoint,
    );
}

export function createEmbeddingModel(
    endpoint?: string | undefined,
    dimensions?: number,
) {
    const settings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
        process.env,
        endpoint,
    );
    return openai.createEmbeddingModel(settings, dimensions);
}

export async function ensureTestDir() {
    return ensureDir(getRootDataPath());
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests/memoryProviders");
}

export function testFilePath(fileName: string): string {
    return path.join(getRootDataPath(), fileName);
}

export function generateTestEmbedding(
    value: number,
    length: number,
): NormalizedEmbedding {
    const embedding = new Array<number>(length);
    embedding.fill(value);
    return createNormalized(embedding);
}

export function generateRandomTestEmbedding(
    length: number,
): NormalizedEmbedding {
    const embedding: number[] = [];
    for (let i = 0; i < length; ++i) {
        embedding[i] = Math.random();
    }
    return createNormalized(embedding);
}

export function generateRandomTestEmbeddings(length: number, count: number) {
    const embeddings: NormalizedEmbedding[] = [];
    for (let i = 0; i < count; ++i) {
        embeddings.push(generateRandomTestEmbedding(length));
    }
    return embeddings;
}

export function composers(offset?: number) {
    const blocks: knowLib.TextBlock<number>[] = [
        {
            type: knowLib.TextBlockType.Raw,
            value: "Bach",
            sourceIds: [1, 3, 5, 7],
        },
        {
            type: knowLib.TextBlockType.Raw,
            value: "Debussy",
            sourceIds: [2, 3, 4, 7],
        },
        {
            type: knowLib.TextBlockType.Raw,
            value: "Gershwin",
            sourceIds: [1, 5, 8, 9],
        },
    ];
    if (offset) {
        blocks.forEach((b) => {
            const sourceIds = b.sourceIds!;
            for (let i = 0; i < sourceIds.length; ++i) {
                sourceIds[i] = sourceIds[i] + offset;
            }
        });
    }
    return blocks;
}

export function fruits() {
    const blocks: knowLib.TextBlock<number>[] = [
        {
            type: knowLib.TextBlockType.Raw,
            value: "Banana",
            sourceIds: [11, 13, 15, 17],
        },
        {
            type: knowLib.TextBlockType.Raw,
            value: "Apple",
            sourceIds: [12, 13, 14, 17],
        },
        {
            type: knowLib.TextBlockType.Raw,
            value: "Peach",
            sourceIds: [11, 15, 18, 19],
        },
    ];
    return blocks;
}

export function uniqueSourceIds(blocks: knowLib.TextBlock[]): number[] {
    const set = new Set<number>();
    for (const block of blocks) {
        block.sourceIds?.forEach((id) => set.add(id));
    }
    return [...set.values()].sort();
}

export function countSourceIds(blocks: knowLib.TextBlock[]): number {
    return blocks.reduce<number>(
        (total, b) => total + (b.sourceIds?.length ?? 0),
        0,
    );
}
