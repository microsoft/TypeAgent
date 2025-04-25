// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import path from "path";
import os from "os";
import { hasEnvSettings, openai } from "aiclient";
import { Embedding } from "../src/vector/embeddings.js";

export function hasEmbeddingModel(endpoint?: string | undefined) {
    return hasEnvSettings(
        process.env,
        openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
        endpoint,
    );
}

export function testDirectoryPath(subPath: string) {
    return path.join(os.tmpdir(), subPath);
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

export function generateRandomEmbedding(length: number): Embedding {
    const embedding = new Float32Array(length);
    for (let i = 0; i < length; ++i) {
        embedding[i] = Math.random();
    }
    return embedding;
}
