// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hasEnvSettings } from "../src/common.js";
import { openai } from "../src/index.js";

export function hasEmbeddingModel(endpoint?: string | undefined) {
    return hasApiSettings(
        openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
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

export function hasApiSettings(key: string, endpoint?: string | undefined) {
    return hasEnvSettings(process.env, key, endpoint);
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
