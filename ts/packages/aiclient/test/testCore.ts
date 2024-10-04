// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "../src/index.js";

export function hasEmbeddingModel(endpoint?: string | undefined) {
    return hasApiSettings(openai.ModelType.Embedding, endpoint);
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

export function hasApiSettings(
    modelType: openai.ModelType,
    endpoint?: string | undefined,
) {
    try {
        const settings = openai.apiSettingsFromEnv(
            modelType,
            process.env,
            endpoint,
        );
        return settings !== undefined;
    } catch {}
    return false;
}

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
