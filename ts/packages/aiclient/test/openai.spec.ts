// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChatModel,
    MAX_PROMPT_LENGTH_DEFAULT,
    ModelType,
} from "../src/openai.js";
import type { AzureApiSettings } from "../src/azureSettings.js";
import type { OpenAIApiSettings } from "../src/openaiSettings.js";

function azureSettings(endpoint: string): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Chat,
        apiKey: "test",
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

    describe("Azure prompt diagnostics preserve stdio protocol output", () => {
        const originalFetch = globalThis.fetch;
        afterEach(() => {
            globalThis.fetch = originalFetch;
            import.meta.jest.restoreAllMocks();
        });

        test.each([false, true])(
            "large prompts warn without stdout or input truncation (stream=%s)",
            async (stream) => {
                const log = import.meta.jest
                    .spyOn(console, "log")
                    .mockImplementation(() => {});
                const warning = import.meta.jest
                    .spyOn(console, "warn")
                    .mockImplementation(() => {});
                const prompt = "x".repeat(MAX_PROMPT_LENGTH_DEFAULT + 1);
                const calls: string[] = [];
                globalThis.fetch = async (_input, init) => {
                    calls.push(String(init?.body));
                    const choice = {
                        index: 0,
                        finish_reason: "stop",
                        message: {
                            role: "assistant",
                            content: "Synthetic reply",
                        },
                    };
                    return new Response(
                        stream
                            ? `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", delta: { content: "Synthetic reply" } }] })}\n\ndata: [DONE]\n\n`
                            : JSON.stringify({ choices: [choice] }),
                        {
                            headers: {
                                "content-type": stream
                                    ? "text/event-stream"
                                    : "application/json",
                            },
                        },
                    );
                };
                const model = createChatModel(
                    azureSettings(
                        "https://example.openai.azure.com/openai/deployments/gpt-4o/chat/completions",
                    ),
                );
                if (stream) {
                    const result = await model.completeStream(prompt);
                    if (!result.success) throw new Error(result.message);
                    let text = "";
                    for await (const chunk of result.data) text += chunk;
                    expect(text).toBe("Synthetic reply");
                } else {
                    expect(await model.complete(prompt)).toMatchObject({
                        success: true,
                        data: "Synthetic reply",
                    });
                }
                expect(calls).toHaveLength(1);
                expect(JSON.parse(calls[0]).messages[0].content).toBe(prompt);
                expect(warning).toHaveBeenCalledWith(
                    expect.stringContaining("LARGE REQUEST:"),
                );
                expect(log).not.toHaveBeenCalled();
            },
        );

        test("an explicit character guard still rejects before dispatch", async () => {
            const fetch = import.meta.jest.fn();
            globalThis.fetch = fetch;
            const warning = import.meta.jest
                .spyOn(console, "warn")
                .mockImplementation(() => {});
            const model = createChatModel({
                ...azureSettings(
                    "https://example.openai.azure.com/openai/deployments/gpt-4o/chat/completions",
                ),
                maxPromptChars: 1,
            });
            await expect(model.complete("unchanged input")).rejects.toThrow(
                "REQUEST NOT SENT:",
            );
            expect(fetch).not.toHaveBeenCalled();
            expect(warning).not.toHaveBeenCalled();
        });
    });

    test("uses the required default for a GPT-5 OpenAI model name", () => {
        const settings: OpenAIApiSettings = {
            provider: "openai",
            modelType: ModelType.Chat,
            apiKey: "test",
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
