// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success } from "typechat";
import type { ModelRequestConstraints } from "@typeagent/config";
import { callJsonApiWithPool, fetchWithRetry } from "../src/restClient.js";
import type { EndpointPool } from "../src/endpointPool.js";
import { createChatModel, ModelType } from "../src/openai.js";
import {
    RequestBudget,
    runWithRequestBudget,
    runWithRequestAttemptObserver,
    outputReservation,
} from "../src/requestBudget.js";

const limits: ModelRequestConstraints = {
    contextTokens: 1050000,
    inputTokens: 922000,
    outputTokens: 128000,
};

function makePool(size = 1): EndpointPool {
    return {
        modelKey: "capacity-test",
        members: Array.from({ length: size }, (_, index) => ({
            suffix: String(index),
            priority: index + 1,
            mode: "PAYG",
            settings: {
                provider: "azure",
                modelType: ModelType.Chat,
                endpoint: `https://synthetic.invalid/${index}`,
                apiKey: "test",
                requestConstraints: { ...limits },
                maxRetryAttempts: 0,
            },
            cooldownUntil: 0,
            consecutive429s: 0,
            consecutiveSuccesses: 0,
        })),
    };
}

function response(status = 200, error?: unknown) {
    return new Response(JSON.stringify(error ? { error } : { answer: "ok" }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function call(pool: EndpointPool, content = "Synthetic question") {
    return callJsonApiWithPool(pool, async () =>
        success({
            headers: {},
            body: {
                model: "luna",
                messages: [{ role: "user", content }],
            },
        }),
    );
}

describe("endpoint output capacity adaptation", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test.each([1, 2])(
        "advertised capacity is retried and retained in a %i-member pool",
        async (size) => {
            const bodies: Record<string, unknown>[] = [];
            const urls: string[] = [];
            const pool = makePool(size);
            globalThis.fetch = async (url, options) => {
                urls.push(String(url));
                bodies.push(JSON.parse(String(options?.body)));
                return bodies.length === 1
                    ? response(400, {
                          code: "invalid_request_error",
                          param: "max_completion_tokens",
                          message:
                              "This model supports at most 48,000 completion tokens.",
                      })
                    : response();
            };
            expect((await call(pool)).success).toBe(true);
            expect((await call(pool)).success).toBe(true);
            expect(bodies).toHaveLength(3);
            expect(bodies[0]).not.toHaveProperty("max_completion_tokens");
            expect(bodies[1].max_completion_tokens).toBe(48000);
            expect(bodies[2].max_completion_tokens).toBe(48000);
            expect(new Set(urls).size).toBe(1);
            expect(pool.members[0].settings.requestConstraints).toEqual(limits);
            const newClient = makePool();
            newClient.members[0].settings.requestConstraints =
                pool.members[0].settings.requestConstraints;
            expect((await call(newClient)).success).toBe(true);
            expect(bodies[3]).not.toHaveProperty("max_completion_tokens");
            pool.members[0].cooldownUntil = Date.now() + 60000;
            if (size === 2) {
                expect((await call(pool)).success).toBe(true);
                expect(bodies[4]).not.toHaveProperty("max_completion_tokens");
            }
        },
    );

    test("missing capacity halves 128000 to 64000 and retries only once", async () => {
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(String(options?.body)));
            return response(400, {
                code: "output_token_limit_exceeded",
                message: "Output token capacity exceeded.",
            });
        };
        const result = await call(makePool());
        expect(result.success).toBe(false);
        expect(bodies).toHaveLength(2);
        expect(bodies[1].max_completion_tokens).toBe(64000);
        if (!result.success)
            expect(result.message).toContain("Output token capacity exceeded");
    });

    test.each([
        { code: "output_token_limit_exceeded", capacity: 32000 },
        { param: "max_completion_tokens", limit: 32000 },
        {
            message:
                "max_completion_tokens must be less than or equal to 32,000",
        },
        { message: "Output token capacity: 32,000" },
    ])(
        "uses an advertised capacity rather than an arbitrary halving: %j",
        async (error) => {
            const bodies: Record<string, unknown>[] = [];
            globalThis.fetch = async (_url, options) => {
                bodies.push(JSON.parse(String(options?.body)));
                return bodies.length === 1 ? response(400, error) : response();
            };
            expect((await call(makePool())).success).toBe(true);
            expect(bodies).toHaveLength(2);
            expect(bodies[1].max_completion_tokens).toBe(32000);
        },
    );

    test("a successful halving is used by subsequent requests to that endpoint", async () => {
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(String(options?.body)));
            return bodies.length === 1
                ? response(400, { code: "output_token_limit_exceeded" })
                : response();
        };
        const pool = makePool();
        expect((await call(pool)).success).toBe(true);
        expect((await call(pool)).success).toBe(true);
        expect(bodies.map((body) => body.max_completion_tokens)).toEqual([
            undefined,
            64000,
            64000,
        ]);
    });

    test("transient retries cannot add a second capacity retry to the same request", async () => {
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(String(options?.body)));
            return bodies.length === 2
                ? response(503)
                : response(400, { code: "output_token_limit_exceeded" });
        };
        const pool = makePool();
        pool.members[0].settings.maxRetryAttempts = 1;
        pool.members[0].settings.retryPauseMs = 0;
        expect((await call(pool)).success).toBe(false);
        expect(bodies).toHaveLength(3);
        expect(bodies.map((body) => body.max_completion_tokens)).toEqual([
            undefined,
            64000,
            64000,
        ]);
    });

    test.each(["chat_completions", "responses", "messages"] as const)(
        "%s streaming retries capacity errors before yielding output",
        async (wireApi) => {
            let fetches = 0;
            globalThis.fetch = async () => {
                fetches++;
                if (fetches === 1)
                    return response(400, {
                        code: "output_token_limit_exceeded",
                    });
                const text =
                    wireApi === "responses"
                        ? 'data: {"type":"response.output_text.delta","delta":"answer"}\n\ndata: {"type":"response.completed"}\n\n'
                        : wireApi === "messages"
                          ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}\n\ndata: {"type":"message_stop"}\n\n'
                          : 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n';
                return new Response(text);
            };
            const model = createChatModel({
                ...makePool().members[0].settings,
                wireApi,
            });
            const result = await model.completeStream("Synthetic question");
            expect(result.success).toBe(true);
            if (!result.success) throw new Error(result.message);
            let answer = "";
            for await (const fragment of result.data) answer += fragment;
            expect(answer).toBe("answer");
            expect(fetches).toBe(2);
        },
    );

    test.each(["chat_completions", "responses", "messages"] as const)(
        "%s reports token-limited nonstreaming and streaming output as incomplete",
        async (wireApi) => {
            const model = createChatModel({
                ...makePool().members[0].settings,
                wireApi,
            });
            globalThis.fetch = async () =>
                new Response(
                    JSON.stringify(
                        wireApi === "responses"
                            ? { output_text: "partial", status: "incomplete" }
                            : wireApi === "messages"
                              ? {
                                    content: [
                                        { type: "text", text: "partial" },
                                    ],
                                    stop_reason: "max_tokens",
                                }
                              : {
                                    choices: [
                                        {
                                            message: { content: "partial" },
                                            finish_reason: "length",
                                        },
                                    ],
                                },
                    ),
                );
            const result = await model.complete("Synthetic question");
            expect(result.success).toBe(false);
            if (!result.success)
                expect(result.message).toContain("response is incomplete");
            globalThis.fetch = async () =>
                new Response(
                    wireApi === "responses"
                        ? 'data: {"type":"response.incomplete"}\n\n'
                        : wireApi === "messages"
                          ? 'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":1}}\n\n'
                          : 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n',
                );
            const streamed = await model.completeStream("Synthetic question");
            expect(streamed.success).toBe(true);
            if (!streamed.success) throw new Error(streamed.message);
            await expect(
                (async () => {
                    for await (const fragment of streamed.data) {
                        expect(fragment).not.toBe("partial");
                    }
                })(),
            ).rejects.toThrow("response is incomplete");
        },
    );

    test.each(["chat_completions", "responses", "messages"] as const)(
        "%s real model client accounts for both capacity attempts and uses its native wire field",
        async (wireApi) => {
            const bodies: Record<string, unknown>[] = [];
            const events: string[] = [];
            const budget = new RequestBudget({
                ...limits,
                inputTokens: 922000,
                outputTokens: 128000,
                safetyTokens: 1024,
                chatAttempts: 2,
                embeddingAttempts: 1,
                reservedTokens: 1000000,
                elapsedMs: 60000,
                tokenizer: "synthetic-character-counter",
                countTokens: (text) => text.length,
            });
            globalThis.fetch = async (_url, options) => {
                bodies.push(JSON.parse(String(options?.body)));
                events.push(`fetch-${bodies.length}`);
                if (bodies.length === 1)
                    return response(400, {
                        code: "output_token_limit_exceeded",
                        max_output_tokens: 64000,
                        message: "Output token capacity exceeded.",
                    });
                return new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: { content: "answer" },
                                finish_reason: "stop",
                            },
                        ],
                        output_text: "answer",
                        content: [{ type: "text", text: "answer" }],
                        stop_reason: "end_turn",
                    }),
                );
            };
            const model = createChatModel({
                ...makePool().members[0].settings,
                wireApi,
            });
            const result = await runWithRequestBudget(budget, () =>
                runWithRequestAttemptObserver(
                    {
                        async reserve(event) {
                            const id = String(event.reservations[0].attempt);
                            events.push(`reserve-${id}`);
                            return id;
                        },
                        async finish(id, outcome) {
                            events.push(`finish-${id}-${outcome.status}`);
                        },
                    },
                    () => model.complete("Synthetic question"),
                ),
            );
            expect(result).toEqual(success("answer"));
            const field =
                wireApi === "messages"
                    ? "max_tokens"
                    : wireApi === "responses"
                      ? "max_output_tokens"
                      : "max_completion_tokens";
            expect(bodies[1][field]).toBe(64000);
            expect(
                budget.receipts.map((receipt) => receipt.outputTokens),
            ).toEqual([128000, 64000]);
            expect(events).toEqual([
                "reserve-1",
                "fetch-1",
                "finish-1-400",
                "reserve-2",
                "fetch-2",
                "finish-2-200",
            ]);
        },
    );

    test("capacity retry respects the aggregate attempt budget before dispatch", async () => {
        let fetches = 0;
        const budget = new RequestBudget({
            inputTokens: 922000,
            outputTokens: 128000,
            safetyTokens: 1024,
            chatAttempts: 1,
            embeddingAttempts: 1,
            reservedTokens: 1000000,
            elapsedMs: 60000,
            tokenizer: "synthetic",
            countTokens: (text) => text.length,
        });
        globalThis.fetch = async () => {
            fetches++;
            return response(400, { code: "output_token_limit_exceeded" });
        };
        await expect(
            runWithRequestBudget(budget, () => call(makePool())),
        ).rejects.toThrow("budget exhausted");
        expect(fetches).toBe(1);
    });

    test("context capacity is not mistaken for output capacity and larger subsequent prompts are re-budgeted", async () => {
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(String(options?.body)));
            return bodies.length === 1
                ? response(400, {
                      code: "context_length_exceeded",
                      message:
                          "This model's maximum context length is 16,000 tokens.",
                  })
                : response();
        };
        const pool = makePool();
        expect((await call(pool)).success).toBe(true);
        const first = Number(bodies[1].max_completion_tokens);
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThan(16000);
        expect((await call(pool, "longer ".repeat(1000))).success).toBe(true);
        expect(Number(bodies[2].max_completion_tokens)).toBeLessThan(first);
        await expect(call(pool, "x".repeat(16000))).rejects.toThrow(
            "learned endpoint context capacity",
        );
        expect(bodies).toHaveLength(3);
    });

    test.each([
        [400, { code: "invalid_request_error", message: "Invalid schema" }],
        [401, { message: "Output token limit exceeded" }],
        [403, { message: "Output token limit exceeded" }],
        [404, { message: "Deployment not found" }],
        [429, { message: "Token rate limit exceeded" }],
        [500, { message: "Output token limit exceeded" }],
        [
            400,
            {
                code: "unsupported_parameter",
                param: "max_tokens",
                message:
                    "max_tokens is not supported; use max_completion_tokens",
            },
        ],
        [
            400,
            { code: "output_token_limit_exceeded", max_output_tokens: 256000 },
        ],
    ])(
        "status %i with unrelated or non-reducing error does not change capacity",
        async (status, error) => {
            let calls = 0;
            globalThis.fetch = async () => {
                calls++;
                return response(Number(status), error);
            };
            expect((await call(makePool())).success).toBe(false);
            expect(calls).toBe(1);
        },
    );

    test("cancellation prevents the capacity retry", async () => {
        const controller = new AbortController();
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches++;
            controller.abort();
            return response(400, { code: "output_token_limit_exceeded" });
        };
        await expect(
            callJsonApiWithPool(
                makePool(),
                async () => success({ headers: {}, body: { messages: [] } }),
                {
                    signal: controller.signal,
                },
            ),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(fetches).toBe(1);
    });

    test("embeddings and native decisions are never output-capacity retried", async () => {
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches++;
            return response(400, { code: "output_token_limit_exceeded" });
        };
        for (const body of [
            { input: ["text"] },
            { questions: { verdict: { type: "noul" } } },
        ]) {
            expect(
                (
                    await fetchWithRetry(
                        "https://synthetic.invalid/nonchat",
                        {
                            body: JSON.stringify(body),
                            method: "POST",
                        },
                        0,
                        0,
                        1000,
                        undefined,
                        { ...limits },
                    )
                ).success,
            ).toBe(false);
        }
        expect(fetches).toBe(2);
    });
});

test.each(["max_tokens", "max_completion_tokens", "max_output_tokens"])(
    "reservation recognizes the adapted %s field",
    (field) => {
        expect(outputReservation({ [field]: 64000 }, 128000)).toBe(64000);
        expect(() => outputReservation({ [field]: 0 }, 128000)).toThrow(
            "output-token reservation",
        );
    },
);

test("conflicting output limit aliases fail closed", () => {
    expect(() =>
        outputReservation(
            {
                max_tokens: 64000,
                max_completion_tokens: 128000,
            },
            128000,
        ),
    ).toThrow("conflicting");
});
