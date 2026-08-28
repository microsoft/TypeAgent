// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { _resetRuntimeConfigForTests } from "../src/runtimeConfig.js";
import {
    getRuntimeConfig,
    initRuntimeConfigFromProcessEnv,
    setRuntimeConfig,
    configFromEnvRecord,
    getActiveModelProvider,
    openai,
    setActiveModelProvider,
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

    test("setRuntimeConfig clears a stale model provider", () => {
        setActiveModelProvider("copilot");
        setRuntimeConfig(configFromEnvRecord({}));
        expect(getActiveModelProvider()).toBeUndefined();
    });

    test("initRuntimeConfigFromProcessEnv overrides cached value", () => {
        setRuntimeConfig(configFromEnvRecord({}));
        const fresh = initRuntimeConfigFromProcessEnv();
        expect(getRuntimeConfig()).toBe(fresh);
    });

    test("apiSettingsFromEnv uses typed config when env is omitted", () => {
        const openAIKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS:
                    "https://typed-config.example",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            }),
        );

        try {
            const settings = openai.apiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                "GPT_4_O",
            );
            expect(settings.endpoint).toBe("https://typed-config.example");
        } finally {
            if (openAIKey === undefined) {
                delete process.env.OPENAI_API_KEY;
            } else {
                process.env.OPENAI_API_KEY = openAIKey;
            }
            _resetRuntimeConfigForTests();
        }
    });

    test("apiSettingsFromEnv honors an explicit legacy env map", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS:
                    "https://typed-config.example",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            }),
        );

        const settings = openai.apiSettingsFromEnv(
            openai.ModelType.Chat,
            {
                AZURE_OPENAI_ENDPOINT_GPT_4_O: "https://explicit-env.example",
                AZURE_OPENAI_API_KEY_GPT_4_O: "explicit-key",
            },
            "GPT_4_O",
        );

        expect(settings.endpoint).toBe("https://explicit-env.example");
        if (settings.provider !== "azure") {
            throw new Error(
                `Expected Azure settings, got ${settings.provider}`,
            );
        }
        expect(settings.apiKey).toBe("explicit-key");
    });
});
