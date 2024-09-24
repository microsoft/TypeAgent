// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";

export function shouldSkip() {
    return !hasTestKeys();
}

export function hasTestKeys() {
    const env = process.env;
    return (
        env[openai.EnvVars.AZURE_OPENAI_API_KEY] &&
        env[openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING]
    );
}

export function skipTest(name: string) {
    return test.skip(name, () => {});
}
