// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    configFromEnvRecord,
    getRuntimeConfig,
    setRuntimeConfig,
} from "../../../packages/aiclient/dist/index.js";
import { createLunaModel } from "../../../packages/knowProTest/dist/models.js";

test("KnowPro Luna helper sends Luna-compatible completion settings", async () => {
    const originalConfig = getRuntimeConfig();
    const originalFetch = globalThis.fetch;
    let requestBody;
    try {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                    "https://example.test/openai/deployments/gpt-6-luna/chat/completions",
                AZURE_OPENAI_API_KEY_GPT_6_LUNA_EASTUS: "fixture-key",
            }),
        );
        globalThis.fetch = async (url, init) => {
            assert.match(String(url), /\/deployments\/gpt-6-luna\//);
            requestBody = JSON.parse(String(init?.body));
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: "{}" } }],
                }),
            );
        };
        const { model, modelName } = createLunaModel();
        assert.equal(modelName, "GPT_6_LUNA");
        const result = await model.complete("Extract knowledge");
        assert.equal(result.success, true);
        assert.equal(requestBody.temperature, 1);
        assert.equal(requestBody.seed, 345);
    } finally {
        globalThis.fetch = originalFetch;
        setRuntimeConfig(originalConfig);
    }
});

test("KnowPro Luna helper fails rather than selecting a legacy endpoint", () => {
    const originalConfig = getRuntimeConfig();
    try {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_1_EASTUS:
                    "https://example.test/openai/deployments/gpt-4.1/chat/completions",
                AZURE_OPENAI_API_KEY_GPT_4_1_EASTUS: "fixture-key",
            }),
        );
        assert.throws(() => createLunaModel(), /gpt_6_luna/);
    } finally {
        setRuntimeConfig(originalConfig);
    }
});
