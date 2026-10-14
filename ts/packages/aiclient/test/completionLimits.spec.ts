// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChatModel, ModelType } from "../src/openai.js";
import type { CompletionSettings } from "../src/models.js";
import { adapterFor } from "../src/wireApiProvider/index.js";
import type { ModelRequest } from "../src/wireApiProvider/types.js";
import {
    RequestBudget,
    RequestAdmissionError,
    runWithRequestBudget,
} from "../src/requestBudget.js";

const settings = {
    provider: "azure" as const,
    modelType: ModelType.Chat,
    endpoint: "https://synthetic.invalid/luna",
    apiKey: "synthetic-key",
    supportsResponseFormat: true,
    requestConstraints: {
        contextTokens: 1050000,
        inputTokens: 922000,
        outputTokens: 128000,
    },
};

test.each(["max_tokens", "max_completion_tokens", "max_output_tokens"])(
    "removed setting %s is rejected rather than silently ignored",
    async (key) => {
        expect(() =>
            createChatModel(settings, { [key]: 2000 } as CompletionSettings),
        ).toThrow(`${key} is no longer supported`);
        const model = createChatModel(settings);
        Object.assign(model.completionSettings, { [key]: 2000 });
        await expect(model.complete("answer")).rejects.toThrow(
            `${key} is no longer supported`,
        );
    },
);

test.each(["chat_completions", "responses"] as const)(
    "%s streaming and nonstreaming requests omit optional output caps",
    async (wireApi) => {
        const previous = globalThis.fetch;
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = async (_url, options) => {
            const body = JSON.parse(String(options?.body)) as Record<
                string,
                unknown
            >;
            bodies.push(body);
            if (body.stream)
                return new Response(
                    wireApi === "responses"
                        ? 'data: {"type":"response.output_text.delta","delta":"answer"}\n\ndata: {"type":"response.completed","response":{"output_text":"answer"}}\n\n'
                        : 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n',
                    { status: 200 },
                );
            return new Response(
                JSON.stringify(
                    wireApi === "responses"
                        ? { output_text: "answer" }
                        : {
                              choices: [
                                  {
                                      message: { content: "answer" },
                                      finish_reason: "stop",
                                  },
                              ],
                          },
                ),
                { status: 200 },
            );
        };
        const budget = new RequestBudget({
            contextTokens: 1050000,
            inputTokens: 16000,
            outputTokens: 128000,
            inputReservedTokens: 160000,
            reservedTokens: 160000 + 2 * 128000,
            safetyTokens: 1000,
            chatAttempts: 2,
            embeddingAttempts: 128,
            elapsedMs: 600000,
            tokenizer: "unit-character-counter",
            countTokens: (serialized) => serialized.length,
        });
        try {
            const model = createChatModel({ ...settings, wireApi });
            await runWithRequestBudget(budget, async () => {
                expect((await model.complete("answer")).success).toBe(true);
                const streamed = await model.completeStream("answer");
                expect(streamed.success).toBe(true);
                if (!streamed.success) throw new Error(streamed.message);
                let text = "";
                for await (const chunk of streamed.data) text += chunk;
                expect(text).toBe("answer");
            });
            expect(bodies).toHaveLength(2);
            for (const body of bodies)
                for (const key of [
                    "max_tokens",
                    "max_completion_tokens",
                    "max_output_tokens",
                ])
                    expect(body).not.toHaveProperty(key);
            expect(
                budget.receipts.map((receipt) => ({
                    kind: receipt.kind,
                    outputTokens: receipt.outputTokens,
                })),
            ).toEqual([
                { kind: "chat", outputTokens: 128000 },
                { kind: "chat", outputTokens: 128000 },
            ]);
            await expect(
                runWithRequestBudget(budget, () => model.complete("extra")),
            ).rejects.toBeInstanceOf(RequestAdmissionError);
            expect(bodies).toHaveLength(2);
        } finally {
            globalThis.fetch = previous;
        }
    },
);

test.each([undefined, 0, -1, 1.5])(
    "Messages rejects missing or invalid provider capacity %s",
    (providerOutputTokens) => {
        const request: ModelRequest = {
            messages: [{ role: "user", content: "answer" }],
            completionSettings: {},
            defaultParams: {},
            modelName: "claude",
            disableResponseFormat: false,
            providerOutputTokens,
        };
        expect(() => adapterFor("messages").buildRequestBody(request)).toThrow(
            "verified provider output capacity",
        );
    },
);

test("aggregate input guard remains independent of full provider output reservations", () => {
    const budget = new RequestBudget({
        contextTokens: 1050000,
        inputTokens: 16000,
        outputTokens: 128000,
        inputReservedTokens: 29,
        reservedTokens: 400000,
        safetyTokens: 1000,
        chatAttempts: 24,
        embeddingAttempts: 128,
        elapsedMs: 600000,
        tokenizer: "unit-character-counter",
        countTokens: (serialized) => serialized.length,
    });
    budget.reserve(JSON.stringify({ messages: [] }), 128000);
    expect(() =>
        budget.reserve(JSON.stringify({ messages: [] }), 128000),
    ).toThrow("reserved-token budget exhausted");
    expect(budget.receipts).toHaveLength(1);
});
