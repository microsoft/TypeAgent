// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChatModel, ModelType } from "../src/openai.js";
import type { AzureApiSettings } from "../src/azureSettings.js";
import type { OpenAIApiSettings } from "../src/openaiSettings.js";

function azureSettings(endpoint: string): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Chat,
        apiKey: "test-key",
        endpoint,
    };
}

describe("createChatModel temperature compatibility", () => {
    test("uses the required default for a GPT-6 Azure deployment", () => {
        const model = createChatModel(
            azureSettings(
                "https://example.openai.azure.com/openai/deployments/gpt-6-luna/chat/completions",
            ),
            { temperature: 0 },
        );

        expect(model.completionSettings.temperature).toBe(1);
    });

    test("uses the required default for a GPT-5 OpenAI model name", () => {
        const settings: OpenAIApiSettings = {
            provider: "openai",
            modelType: ModelType.Chat,
            apiKey: "test-key",
            endpoint: "https://api.openai.com/v1/chat/completions",
            modelName: "gpt-5.4-mini",
        };

        const model = createChatModel(settings, { temperature: 0.5 });

        expect(model.completionSettings.temperature).toBe(1);
    });

    test("preserves the requested temperature for earlier models", () => {
        const model = createChatModel(
            azureSettings(
                "https://example.openai.azure.com/openai/deployments/gpt-4o/chat/completions",
            ),
            { temperature: 0 },
        );

        expect(model.completionSettings.temperature).toBe(0);
    });
});
