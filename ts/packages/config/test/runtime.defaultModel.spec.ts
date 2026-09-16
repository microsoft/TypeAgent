// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildConfig } from "../src/index.js";

describe("buildConfig: default model", () => {
    test("prefers GPT-5.6 Luna over GPT-4o", () => {
        const config = buildConfig({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://gpt-4o",
            AZURE_OPENAI_ENDPOINT_GPT_5_6_LUNA_EASTUS: "https://gpt-5.6-luna",
        });

        expect(config.azureOpenAI.defaultChat?.endpoint).toBe(
            "https://gpt-5.6-luna",
        );
    });
});
