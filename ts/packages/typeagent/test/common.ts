// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import path from "path";
import os from "os";
import { hasEnvSettings, openai } from "aiclient";

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
