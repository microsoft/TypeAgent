// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotEndpointProvider,
    createCopilotTransportModel,
} from "../src/copilotModels.js";
import { CopilotApiSettings } from "../src/copilotSettings.js";
import { createOllamaChatModel } from "../src/ollamaModels.js";
import { createChatModel, ModelType } from "../src/openai.js";
import { OpenAIApiSettings } from "../src/openaiSettings.js";
import { TokenCounter, TokenCounterData } from "../src/tokenCounter.js";

const BASE_USAGE = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
};

const DETAILED_USAGE = {
    ...BASE_USAGE,
    prompt_tokens_details: { cached_tokens: 40 },
};

function emptyCounterData(): TokenCounterData {
    const empty = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };
    return {
        counters: {},
        all: { max: { ...empty }, total: { ...empty }, count: 0 },
    };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function sseResponse(events: unknown[]): Response {
    return new Response(
        events
            .map((event) =>
                event === "[DONE]"
                    ? "data: [DONE]\n\n"
                    : `data: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        },
    );
}

async function drain(stream: AsyncIterableIterator<string>): Promise<string> {
    let text = "";
    for await (const chunk of stream) {
        text += chunk;
    }
    return text;
}

function makeOpenAISettings(): OpenAIApiSettings {
    return {
        provider: "openai",
        modelType: ModelType.Chat,
        endpoint: "https://openai.example/chat/completions",
        apiKey: "test-key",
        modelName: "test-model",
        maxRetryAttempts: 0,
        retryPauseMs: 1,
    };
}

function makeCopilotSettings(): CopilotApiSettings {
    return {
        provider: "copilot",
        modelType: ModelType.Chat,
        endpoint: "copilot-cli",
        modelName: "test-model",
        disableInfiniteSessions: true,
        maxRetryAttempts: 0,
        retryPauseMs: 1,
        timeout: 5_000,
    };
}

describe("provider usage normalization", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => TokenCounter.load(emptyCounterData()));
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("normalizes detailed OpenAI usage before callbacks and counters", async () => {
        (globalThis as any).fetch = async () =>
            jsonResponse({
                choices: [{ message: { content: "ok" } }],
                usage: DETAILED_USAGE,
            });
        const completionResponses: any[] = [];
        const callbackUsage: any[] = [];
        const model = createChatModel(
            makeOpenAISettings(),
            {},
            (_request, response) => completionResponses.push(response),
            ["openai-normalized"],
        );

        const result = await model.complete("hi", (usage) =>
            callbackUsage.push(usage),
        );

        expect(result.success).toBe(true);
        const expected = {
            ...BASE_USAGE,
            cached_tokens: 40,
        };
        expect(callbackUsage).toEqual([expected]);
        expect(completionResponses[0].usage).toEqual(expected);
        expect(
            TokenCounter.getInstance().getTokenUsage("openai-normalized"),
        ).toMatchObject({ total: expected, max: expected, count: 1 });
    });

    test("accepts successful OpenAI responses with omitted or null usage", async () => {
        const completionResponses: any[] = [];
        const callbackUsage: any[] = [];
        const model = createChatModel(
            makeOpenAISettings(),
            {},
            (_request, response) => completionResponses.push(response),
        );

        for (const body of [
            { choices: [{ message: { content: "ok" } }] },
            { choices: [{ message: { content: "ok" } }], usage: null },
        ]) {
            (globalThis as any).fetch = async () => jsonResponse(body);
            const result = await model.complete("hi", (usage) =>
                callbackUsage.push(usage),
            );
            expect(result).toEqual({ success: true, data: "ok" });
        }

        expect(callbackUsage).toEqual([]);
        expect(completionResponses[0].usage).toBeUndefined();
        expect(completionResponses[1].usage).toBeNull();
    });

    test("accepts a successful Copilot response with null usage", async () => {
        (globalThis as any).fetch = async () =>
            jsonResponse({
                choices: [{ message: { content: "ok" } }],
                usage: null,
            });
        const endpointProvider: CopilotEndpointProvider = {
            async getEndpoint() {
                return {
                    url: "https://copilot.example/chat/completions",
                    model: "test-model",
                    headers: { Authorization: "test" },
                };
            },
        };
        const callbackUsage: any[] = [];
        const model = createCopilotTransportModel(
            makeCopilotSettings(),
            {},
            undefined,
            undefined,
            endpointProvider,
        );

        const result = await model.complete("hi", (usage) =>
            callbackUsage.push(usage),
        );

        expect(result).toEqual({ success: true, data: "ok" });
        expect(callbackUsage).toEqual([]);
    });

    test("preserves known zero detail counts without changing streamed totals", async () => {
        (globalThis as any).fetch = async () =>
            sseResponse([
                { choices: [{ delta: { content: "ok" } }] },
                {
                    choices: [],
                    usage: {
                        ...BASE_USAGE,
                        prompt_tokens_details: { cached_tokens: 0 },
                    },
                },
                "[DONE]",
            ]);
        const callbackUsage: any[] = [];
        const model = createChatModel(makeOpenAISettings());

        const result = await model.completeStream!("hi", (usage) =>
            callbackUsage.push(usage),
        );
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(await drain(result.data)).toBe("ok");
        expect(callbackUsage).toEqual([
            {
                ...BASE_USAGE,
                cached_tokens: 0,
            },
        ]);
        expect(callbackUsage[0].total_tokens).toBe(150);
    });

    test("normalizes streamed Copilot usage before callbacks and counters", async () => {
        (globalThis as any).fetch = async () =>
            sseResponse([
                { choices: [{ delta: { content: "ok" } }] },
                { choices: [], usage: DETAILED_USAGE },
                "[DONE]",
            ]);
        const endpointProvider: CopilotEndpointProvider = {
            async getEndpoint() {
                return {
                    url: "https://copilot.example/chat/completions",
                    model: "test-model",
                    headers: { Authorization: "test" },
                };
            },
        };
        const callbackUsage: any[] = [];
        const model = createCopilotTransportModel(
            makeCopilotSettings(),
            {},
            undefined,
            ["copilot-normalized"],
            endpointProvider,
        );

        const result = await model.completeStream!("hi", (usage) =>
            callbackUsage.push(usage),
        );
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(await drain(result.data)).toBe("ok");
        const expected = {
            ...BASE_USAGE,
            cached_tokens: 40,
        };
        expect(callbackUsage).toEqual([expected]);
        expect(
            TokenCounter.getInstance().getTokenUsage("copilot-normalized"),
        ).toMatchObject({ total: expected, max: expected, count: 1 });
    });

    test("reports Ollama usage for regular and streamed completions", async () => {
        const responses = [
            jsonResponse({
                model: "test-model",
                created_at: "now",
                message: { role: "assistant", content: "regular" },
                done: true,
                prompt_eval_count: 7,
                eval_count: 3,
                total_duration: 0,
                load_duration: 0,
                prompt_eval_duration: 0,
                eval_duration: 0,
            }),
            new Response(
                JSON.stringify({
                    model: "test-model",
                    created_at: "now",
                    done: true,
                    prompt_eval_count: 11,
                    eval_count: 5,
                    total_duration: 0,
                    load_duration: 0,
                    prompt_eval_duration: 0,
                    eval_duration: 0,
                }),
                { status: 200 },
            ),
        ];
        (globalThis as any).fetch = async () => responses.shift();
        const model = createOllamaChatModel({
            provider: "ollama",
            modelType: ModelType.Chat,
            endpoint: "http://ollama.example/api/chat",
            modelName: "test-model",
            maxRetryAttempts: 0,
            retryPauseMs: 1,
        });
        const callbackUsage: any[] = [];

        await model.complete("hi", (usage) => callbackUsage.push(usage));
        const streamResult = await model.completeStream!("hi", (usage) =>
            callbackUsage.push(usage),
        );
        expect(streamResult.success).toBe(true);
        if (streamResult.success) await drain(streamResult.data);

        expect(callbackUsage).toEqual([
            { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
            { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
        ]);
    });

    test("counter preserves known optional values and never adds them to total_tokens", () => {
        const counter = TokenCounter.getInstance();
        counter.add({
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            cached_tokens: 0,
        });
        counter.add({
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
            cached_tokens: 8,
        });

        expect(counter.total).toEqual({
            prompt_tokens: 30,
            completion_tokens: 15,
            total_tokens: 45,
            cached_tokens: 8,
        });
        expect(counter.maximum).toEqual({
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
            cached_tokens: 8,
        });

        counter.add({
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
        });
        expect(counter.total).not.toHaveProperty("cached_tokens");
        expect(counter.total.total_tokens).toBe(47);
    });
});
