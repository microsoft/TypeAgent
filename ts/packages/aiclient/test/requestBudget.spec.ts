// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RequestBudget,
    runWithRequestBudget,
    reserveSerializedRequest,
    RequestAdmissionError,
} from "../src/requestBudget.js";
import { callApi } from "../src/restClient.js";
import { callJsonApiWithPool } from "../src/restClient.js";
import { discoverEndpointPool } from "../src/endpointPool.js";
import { ModelType } from "../src/openai.js";

function budget(chatAttempts = 2) {
    return new RequestBudget({
        contextTokens: 21000,
        inputTokens: 16000,
        outputTokens: 4000,
        safetyTokens: 1000,
        chatAttempts,
        reservedTokens: 160000,
        embeddingAttempts: 128,
        elapsedMs: 600000,
        tokenizer: "unit-character-counter",
        countTokens: (serialized) => serialized.length,
    });
}

describe("serialized inference budget (mock transport)", () => {
    test("pooled queue propagates typed local admission errors with zero fetches or retries", async () => {
        const original = globalThis.fetch;
        let sent = 0;
        globalThis.fetch = async () => {
            sent++;
            return new Response("{}", { status: 200 });
        };
        const pool = discoverEndpointPool("azure", ModelType.Chat, undefined, {
            AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid/chat",
            AZURE_OPENAI_API_KEY: "unit-key",
            AZURE_OPENAI_MAX_CONCURRENCY: "1",
        });
        const limits = budget();
        try {
            await expect(
                runWithRequestBudget(limits, () =>
                    callJsonApiWithPool(pool, async () => ({
                        success: true,
                        data: {
                            headers: {},
                            body: {
                                messages: ["x".repeat(16000)],
                                max_completion_tokens: 4000,
                            },
                        },
                    })),
                ),
            ).rejects.toBeInstanceOf(RequestAdmissionError);
            expect(sent).toBe(0);
            expect(limits.receipts).toEqual([]);
        } finally {
            globalThis.fetch = original;
        }
    });
    test("embedding batch body allowance is independent of chat context and preserves every input", () => {
        const limits = new RequestBudget({
            ...budget().limits,
            embeddingInputTokens: 300000,
        });
        const inputs = Array.from(
            { length: 2048 },
            (_, index) => `term-${index}`,
        );
        const serialized = JSON.stringify({ input: inputs });
        expect(serialized.length).toBeGreaterThan(16000);
        limits.reserve(serialized);
        expect(limits.receipts[0]).toMatchObject({
            kind: "embedding",
            serializedChars: serialized.length,
            outputTokens: 0,
        });
        expect(JSON.parse(serialized).input).toEqual(inputs);
        expect(() =>
            limits.reserve(
                JSON.stringify({ messages: inputs, max_tokens: 4000 }),
            ),
        ).toThrow(RequestAdmissionError);
    });
    test("nested scopes reserve atomically before a network attempt", () => {
        const outer = budget();
        const inner = budget(1);
        const request = {
            body: JSON.stringify({ messages: [], max_completion_tokens: 4000 }),
        };
        runWithRequestBudget(outer, () =>
            runWithRequestBudget(inner, () =>
                reserveSerializedRequest(request),
            ),
        );
        expect(() =>
            runWithRequestBudget(outer, () =>
                runWithRequestBudget(inner, () =>
                    reserveSerializedRequest(request),
                ),
            ),
        ).toThrow("exhausted");
        expect(outer.receipts).toHaveLength(1);
        expect(inner.receipts).toHaveLength(1);
    });
    test("includes schema/framing and requires an output reservation", () => {
        const limits = budget();
        expect(() => limits.reserve(JSON.stringify({ messages: [] }))).toThrow(
            "explicit output-token reservation",
        );
        expect(() =>
            limits.reserve(
                JSON.stringify({
                    messages: [{ role: "user", content: "x".repeat(16000) }],
                    response_format: {
                        schema: { description: "schema framing" },
                    },
                    max_completion_tokens: 4000,
                }),
            ),
        ).toThrow("exceeds configured context");
        expect(limits.receipts).toEqual([]);
    });

    test("counts each network retry and blocks exhausted attempts before fetch", async () => {
        const original = globalThis.fetch;
        let sent = 0;
        globalThis.fetch = async () => {
            sent++;
            return new Response("{}", { status: 429 });
        };
        const limits = budget(1);
        try {
            await expect(
                runWithRequestBudget(limits, () =>
                    callApi(
                        {},
                        "https://synthetic.invalid/chat",
                        {
                            messages: [
                                { role: "user", content: "synthetic source" },
                            ],
                            max_completion_tokens: 4000,
                        },
                        2,
                        1,
                        10000,
                    ),
                ),
            ).rejects.toBeInstanceOf(RequestAdmissionError);
            expect(sent).toBe(1);
            expect(limits.receipts).toHaveLength(1);
            expect(limits.receipts[0].outputTokens).toBe(4000);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("does not constrain requests outside an explicit budget scope", async () => {
        const original = globalThis.fetch;
        globalThis.fetch = async () => new Response("{}", { status: 200 });
        try {
            expect(
                (
                    await callApi({}, "https://synthetic.invalid/chat", {
                        messages: [],
                    })
                ).success,
            ).toBe(true);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("token estimates do not assert model context capacity", () => {
        const limits = new RequestBudget({
            ...budget().limits,
            contextTokens: undefined,
        });
        limits.reserve(JSON.stringify({ messages: [], max_tokens: 4000 }));
        expect(limits.receipts[0]).toMatchObject({
            contextTokens: undefined,
            tokenAccounting: "estimate",
            outputTokens: 4000,
        });
        expect(() =>
            limits.reserve(
                JSON.stringify({
                    messages: ["x".repeat(16000)],
                    max_tokens: 4000,
                }),
            ),
        ).toThrow("exceeds configured");
        expect(() =>
            limits.reserve(JSON.stringify({ messages: [], max_tokens: 4001 })),
        ).toThrow("exceeds configured");
        const tighter = new RequestBudget({
            ...budget().limits,
            contextTokens: 5000,
        });
        expect(() =>
            tighter.reserve(JSON.stringify({ messages: [], max_tokens: 4000 })),
        ).toThrow("exceeds configured");
    });
});
