// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getEnvSetting } from "../src/common.js";
import { openai } from "../src/index.js";

export function hasEmbeddingModel(endpoint?: string | undefined) {
    return hasApiSettings(
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

export function hasApiSettings(key: string, endpoint?: string | undefined) {
    try {
        const setting = getEnvSetting(
            process.env,
            key,
            endpoint,
            undefined,
            true,
        );
        return setting !== undefined && setting.length > 0;
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
