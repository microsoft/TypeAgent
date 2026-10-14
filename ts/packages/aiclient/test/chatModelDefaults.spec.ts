// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    configFromEnvRecord,
    azureApiSettingsFromConfig,
    openAIApiSettingsFromConfig,
    apiSettingsFromConfig,
} from "../src/apiSettingsFromConfig.js";
import { setRuntimeConfig } from "../src/runtimeConfig.js";
import { setActiveModelProvider } from "../src/providerMode.js";
import { openAIApiSettingsFromEnv } from "../src/openaiSettings.js";
import {
    ModelType,
    apiSettingsFromEnv,
    getChatModelPool,
    getChatModelSettings,
    createChatModel,
} from "../src/openai.js";
import { checkSerializedRequestConstraints } from "../src/requestConstraints.js";

const bare = "https://example.test/openai/deployments/gpt-4o/chat/completions";
const luna =
    "https://example.test/openai/deployments/gpt-6-luna/chat/completions";
const limits = {
    contextTokens: 1_050_000,
    inputTokens: 922_000,
    outputTokens: 128_000,
};

describe("Luna runtime chat defaults", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {};
        setActiveModelProvider("azure");
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_API_KEY: "test",
                AZURE_OPENAI_ENDPOINT: bare,
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: luna,
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_WESTUS: luna,
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: bare,
            }),
        );
    });

    afterEach(() => {
        process.env = originalEnv;
        setActiveModelProvider(undefined);
        setRuntimeConfig(configFromEnvRecord(originalEnv));
    });

    test.each([undefined, "", "DEFAULT", "GPT_6_LUNA", "azure:GPT_6_LUNA"])(
        "selects the named Luna pool for %s despite the bare 4o endpoint",
        (name) => {
            const pool = getChatModelPool(name);
            expect(pool.members).toHaveLength(2);
            for (const member of pool.members) {
                expect(member.settings.endpoint).toBe(luna);
                expect(member.settings.requestConstraints).toEqual(limits);
                expect(member.settings.maxRetryAttempts).toBe(3);
            }
        },
    );

    test("legacy provider detection also selects named Luna", () => {
        setActiveModelProvider(undefined);
        expect(getChatModelSettings().endpoint).toBe(luna);
        expect(apiSettingsFromEnv().endpoint).toBe(luna);
    });

    test("settings adapter defaults to Luna", () => {
        expect(apiSettingsFromEnv().endpoint).toBe(luna);
        expect(apiSettingsFromEnv().requestConstraints).toEqual(limits);
        expect(
            apiSettingsFromConfig(
                configFromEnvRecord({
                    AZURE_OPENAI_ENDPOINT: bare,
                    AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: luna,
                }),
                ModelType.Chat,
            ).endpoint,
        ).toBe(luna);
    });

    test("implicit Luna normalizes temperature without adding output caps", async () => {
        const originalFetch = globalThis.fetch;
        let body: Record<string, unknown> | undefined;
        globalThis.fetch = async (_url, init) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: "{}" } }],
                }),
                { status: 200 },
            );
        };
        try {
            const result = await createChatModel(undefined, {
                temperature: 0,
            }).complete("bounded");
            expect(result.success).toBe(true);
            expect(body?.temperature).toBe(1);
            expect(body).not.toHaveProperty("max_completion_tokens");
            expect(body).not.toHaveProperty("max_tokens");
            expect(body).not.toHaveProperty("max_output_tokens");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test.each(["azure", "azure:GPT_4_O"])(
        "retains explicit legacy selector %s",
        (name) => {
            expect(getChatModelSettings(name).endpoint).toBe(bare);
            expect(
                getChatModelSettings(name).requestConstraints,
            ).toBeUndefined();
        },
    );

    test("missing Luna fails instead of selecting a legacy bare endpoint", () => {
        setRuntimeConfig(configFromEnvRecord({ AZURE_OPENAI_ENDPOINT: bare }));
        expect(() => getChatModelSettings()).toThrow(/gpt_6_luna/);
        expect(() => apiSettingsFromEnv()).toThrow(/gpt_6_luna/);
    });

    test("builder prefers Luna when synthesizing a bare endpoint", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: bare,
            AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: luna,
        });
        expect(config.azureOpenAI.defaultChat?.endpoint).toBe(luna);
    });

    test("configured constraints are authoritative across the named pool", () => {
        const constraints = { inputTokens: 1234, outputTokens: 500 };
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: luna,
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_WESTUS: luna,
                TYPEAGENT_MODEL_REQUEST_CONSTRAINTS: JSON.stringify({
                    "azure:chat:gpt_6_luna": constraints,
                }),
            }),
        );
        for (const member of getChatModelPool().members)
            expect(member.settings.requestConstraints).toEqual(constraints);
    });

    test("unknown resolved models receive no guessed constraints", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_CUSTOM_EASTUS:
                "https://example.test/openai/deployments/custom/chat/completions",
        });
        expect(
            azureApiSettingsFromConfig(config, ModelType.Chat, "custom")
                .requestConstraints,
        ).toBeUndefined();
    });

    test("Luna serialized request admission remains enforced", () => {
        const constraints = getChatModelSettings().requestConstraints;
        expect(() =>
            checkSerializedRequestConstraints(
                JSON.stringify({
                    messages: [{ role: "user", content: "x".repeat(922_001) }],
                }),
                constraints,
            ),
        ).toThrow(/exceeds/);
    });

    test.each([undefined, "custom-model", "gpt-4o"])(
        "OpenAI defaults to Luna but honors explicit model %s",
        (model) => {
            const env = {
                OPENAI_API_KEY: "test",
                OPENAI_ENDPOINT: "https://example.test/chat/completions",
                OPENAI_ORGANIZATION: "test",
                ...(model ? { OPENAI_MODEL: model } : {}),
            };
            for (const settings of [
                openAIApiSettingsFromConfig(
                    configFromEnvRecord(env),
                    ModelType.Chat,
                ),
                openAIApiSettingsFromEnv(ModelType.Chat, env),
            ]) {
                expect(settings.modelName).toBe(model ?? "gpt-6-luna");
                expect(settings.requestConstraints).toEqual(
                    model ? undefined : limits,
                );
            }
        },
    );

    test("OpenAI configured constraints override known-model capacity", () => {
        const constraints = { outputTokens: 100 };
        const config = configFromEnvRecord({
            OPENAI_API_KEY: "test",
            OPENAI_ENDPOINT: "https://example.test/chat/completions",
            TYPEAGENT_MODEL_REQUEST_CONSTRAINTS: JSON.stringify({
                "openai:chat:": constraints,
            }),
        });
        expect(
            openAIApiSettingsFromConfig(config, ModelType.Chat)
                .requestConstraints,
        ).toEqual(constraints);
    });
});
