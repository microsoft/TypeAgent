// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hasEnvSettings } from "../src/common.js";
import { openai } from "../src/index.js";

export function hasEmbeddingModel() {
    return hasApiSettings(openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING);
}

export function hasEmbeddingEndpoint(endpoint?: string | undefined) {
    return hasApiSettings(
        openai.EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING,
        endpoint,
    );
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
