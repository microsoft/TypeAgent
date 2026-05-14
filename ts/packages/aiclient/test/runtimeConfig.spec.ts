// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { _resetRuntimeConfigForTests } from "../src/runtimeConfig.js";
import {
    getRuntimeConfig,
    initRuntimeConfigFromProcessEnv,
    setRuntimeConfig,
    configFromEnvRecord,
} from "../src/index.js";

describe("runtimeConfig: process-wide singleton", () => {
    beforeEach(() => {
        _resetRuntimeConfigForTests();
    });

    test("getRuntimeConfig lazily builds from process.env on first access", () => {
        const config = getRuntimeConfig();
        expect(config).toBeDefined();
        expect(config.azureOpenAI).toBeDefined();
        // Subsequent calls return the same cached instance.
        expect(getRuntimeConfig()).toBe(config);
    });

    test("setRuntimeConfig pins a curated Config", () => {
        const pinned = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://pinned",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        });
        setRuntimeConfig(pinned);
        const got = getRuntimeConfig();
        expect(got).toBe(pinned);
        expect(got.azureOpenAI.deployments.get("gpt_4_o")).toBeDefined();
    });

    test("initRuntimeConfigFromProcessEnv overrides cached value", () => {
        setRuntimeConfig(configFromEnvRecord({}));
        const fresh = initRuntimeConfigFromProcessEnv();
        expect(getRuntimeConfig()).toBe(fresh);
    });
});
