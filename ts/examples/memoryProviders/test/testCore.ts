// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import os from "node:os";
import { createNormalized, ensureDir, NormalizedEmbedding } from "typeagent";
import { hasEnvSettings, openai } from "aiclient";

export function skipTest(name: string) {
    return test.skip(name, () => {});
}

export function testIf(
    runIf: () => boolean,
    name: string,
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
        openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
        endpoint,
    );
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
