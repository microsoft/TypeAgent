// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    apiSettingsFromConfig,
    azureApiSettingsFromConfig,
    configFromEnvRecord,
    getDeployment,
    getDeploymentEndpoint,
    openAIApiSettingsFromConfig,
} from "../src/index.js";
import { azureApiSettingsFromEnv } from "../src/azureSettings.js";
import { ModelType } from "../src/openai.js";

describe("apiSettingsFromConfig: typed-config path equivalence", () => {
    test("Azure chat single deployment matches env-based path", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "k1",
            AZURE_OPENAI_MAX_CONCURRENCY: "8",
            AZURE_OPENAI_MAX_TIMEOUT: "30000",
            AZURE_OPENAI_RESPONSE_FORMAT: "1",
        };
        const config = configFromEnvRecord(env);
        const fromConfig = azureApiSettingsFromConfig(
            config,
            ModelType.Chat,
            "gpt_4_o",
            "eastus",
        );
        expect(fromConfig.provider).toBe("azure");
        expect(fromConfig.endpoint).toBe("https://4o-eastus");
        expect(fromConfig.apiKey).toBe("k1");
        expect(fromConfig.maxConcurrency).toBe(8);
        expect(fromConfig.timeout).toBe(30000);
        expect(fromConfig.supportsResponseFormat).toBe(true);
    });

    test("Azure: identity auth attaches token provider", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        });
        const s = azureApiSettingsFromConfig(
            config,
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(s.apiKey).toBe("identity");
        expect(s.tokenProvider).toBeDefined();
    });

    test("Azure: explicit key auth has no token provider", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "sk-real-key",
        });
        const s = azureApiSettingsFromConfig(
            config,
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(s.apiKey).toBe("sk-real-key");
        expect(s.tokenProvider).toBeUndefined();
    });

    test("Azure: highest-priority pool member chosen by default (PTU before PAYG)", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-payg",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU:
                "https://4o-sw-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL_PTU: "identity",
        });
        const s = azureApiSettingsFromConfig(
            config,
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(s.endpoint).toBe("https://4o-sw-ptu");
    });

    test("Azure: bare embedding endpoint as service default", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://emb-default",
            AZURE_OPENAI_API_KEY_EMBEDDING: "k",
        });
        const s = azureApiSettingsFromConfig(config, ModelType.Embedding);
        expect(s.endpoint).toBe("https://emb-default");
        expect(s.apiKey).toBe("k");
    });

    test("Azure: missing deployment throws", () => {
        const config = configFromEnvRecord({});
        expect(() =>
            azureApiSettingsFromConfig(config, ModelType.Chat, "nonexistent"),
        ).toThrow(/No Azure OpenAI endpoint configured/);
    });

    test("apiSettingsFromConfig prefers Azure when both are configured", () => {
        const config = configFromEnvRecord({
            OPENAI_API_KEY: "sk-test",
            OPENAI_ENDPOINT: "https://api.openai.com/v1/chat/completions",
            OPENAI_MODEL: "gpt-4o-mini",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://azure-wins",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        });
        const s = apiSettingsFromConfig(
            config,
            ModelType.Chat,
            "gpt_4_o",
            "eastus",
        );
        expect(s.provider).toBe("azure");
        if (s.provider === "azure") {
            expect(s.endpoint).toBe("https://azure-wins");
        }
    });

    test("apiSettingsFromConfig falls back to OpenAI when Azure deployment is missing", () => {
        const config = configFromEnvRecord({
            OPENAI_API_KEY: "sk-test",
            OPENAI_ENDPOINT: "https://api.openai.com/v1/chat/completions",
            OPENAI_MODEL: "gpt-4o-mini",
        });
        const s = apiSettingsFromConfig(config, ModelType.Chat, "gpt_4_o");
        expect(s.provider).toBe("openai");
        if (s.provider === "openai") {
            expect(s.apiKey).toBe("sk-test");
            expect(s.modelName).toBe("gpt-4o-mini");
        }
    });

    test("OpenAI: openAIApiSettingsFromConfig requires endpoint", () => {
        const config = configFromEnvRecord({ OPENAI_API_KEY: "sk-test" });
        expect(() =>
            openAIApiSettingsFromConfig(config, ModelType.Chat),
        ).toThrow(/No OpenAI endpoint/);
    });

    test("getDeployment / getDeploymentEndpoint typed lookups", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://westus",
            AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "identity",
        });
        const dep = getDeployment(config, "gpt_4_o");
        expect(dep).toBeDefined();
        expect(dep!.endpoints.length).toBe(2);
        expect(getDeploymentEndpoint(config, "gpt_4_o", "westus")?.endpoint)
            .toBe("https://westus");
        expect(getDeployment(config, "missing")).toBeUndefined();
    });

    test("typed-config endpoint matches env-based endpoint for same input", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT: "https://legacy.example",
            AZURE_OPENAI_API_KEY: "legacy-key",
            AZURE_OPENAI_MAX_CONCURRENCY: "12",
            AZURE_OPENAI_MAX_TIMEOUT: "45000",
        };
        const fromEnv = azureApiSettingsFromEnv(ModelType.Chat, env);
        const fromConfig = azureApiSettingsFromConfig(
            configFromEnvRecord(env),
            ModelType.Chat,
        );
        expect(fromConfig.endpoint).toBe(fromEnv.endpoint);
        expect(fromConfig.apiKey).toBe(fromEnv.apiKey);
        expect(fromConfig.maxConcurrency).toBe(fromEnv.maxConcurrency);
        expect(fromConfig.timeout).toBe(fromEnv.timeout);
    });
});
