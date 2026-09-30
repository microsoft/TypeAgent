// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configFromEnvRecord, setRuntimeConfig } from "../src/index.js";
import { _resetRuntimeConfigForTests } from "../src/runtimeConfig.js";
import { hasChatModelEndpoint } from "../src/openai.js";

describe("hasChatModelEndpoint: named Azure deployment presence", () => {
    afterEach(() => {
        _resetRuntimeConfigForTests();
    });

    test("false for a model whose deployment is not configured", () => {
        // Partner config synced before Luna: only gpt_4_1 exists.
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_1_EASTUS: "https://gpt-4-1",
                AZURE_OPENAI_API_KEY_GPT_4_1_EASTUS: "identity",
            }),
        );
        expect(hasChatModelEndpoint("GPT_5_6_LUNA")).toBe(false);
        expect(hasChatModelEndpoint("GPT_4_1")).toBe(true);
    });

    test("true once the deployment is present", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_5_6_LUNA_EASTUS: "https://luna",
                AZURE_OPENAI_API_KEY_GPT_5_6_LUNA_EASTUS: "identity",
            }),
        );
        expect(hasChatModelEndpoint("GPT_5_6_LUNA")).toBe(true);
    });
});
