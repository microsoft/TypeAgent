// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createResponsesModel } from "../src/responses.js";

const modelCredential = "not-logged";

describe("OpenAI Responses model", () => {
    it("maps TypeAgent function calls and detailed usage through Responses", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<
            [Parameters<typeof fetch>[0], Parameters<typeof fetch>[1]]
        > = [];
        globalThis.fetch = async (input, init) => {
            calls.push([input, init]);
            return new Response(
                JSON.stringify({
                    id: "resp-1",
                    output: [
                        {
                            type: "function_call",
                            name: "execute_action",
                            arguments: JSON.stringify({
                                action: { actionName: "discoverRepository" },
                            }),
                        },
                    ],
                    usage: {
                        input_tokens: 100,
                        output_tokens: 20,
                        total_tokens: 120,
                        input_tokens_details: { cached_tokens: 10 },
                        output_tokens_details: { reasoning_tokens: 5 },
                    },
                }),
                { status: 200 },
            );
        };
        let recordedUsage: unknown;
        const model = createResponsesModel(
            {
                endpoint: "http://127.0.0.1:4627/v1/responses",
                apiKey: modelCredential,
                modelName: "azure/gpt-5.6-luna",
                timeout: 30_000,
            },
            { reasoning_effort: "low" },
        );

        try {
            const result = await model.complete(
                [
                    { role: "system", content: "Use typed actions." },
                    { role: "user", content: "Find the implementation." },
                ],
                (value) => {
                    recordedUsage = value;
                },
                [
                    {
                        type: "function",
                        function: {
                            name: "execute_action",
                            description: "Execute one typed action",
                            parameters: { type: "object" },
                        },
                    },
                ],
            );

            expect(result).toEqual({
                success: true,
                data: JSON.stringify({
                    name: "execute_action",
                    arguments: {
                        action: { actionName: "discoverRepository" },
                    },
                }),
            });
            expect(calls).toHaveLength(1);
            const [url, init] = calls[0];
            expect(url).toBe("http://127.0.0.1:4627/v1/responses");
            expect(init?.headers).toMatchObject({
                Authorization: "Bearer not-logged",
                "Content-Type": "application/json",
            });
            expect(JSON.parse(String(init?.body))).toMatchObject({
                model: "azure/gpt-5.6-luna",
                reasoning: { effort: "low" },
                tool_choice: "required",
                parallel_tool_calls: false,
                tools: [
                    {
                        type: "function",
                        name: "execute_action",
                        parameters: { type: "object" },
                    },
                ],
            });
            expect(recordedUsage).toEqual({
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
                usage_complete: true,
                prompt_tokens_details: { cached_tokens: 10 },
                completion_tokens_details: { reasoning_tokens: 5 },
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("uses one timeout budget across all attempts", async () => {
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = async (_input, init) => {
            calls++;
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener(
                    "abort",
                    () => reject(init.signal?.reason),
                    { once: true },
                );
            });
        };
        const model = createResponsesModel({
            endpoint: "http://127.0.0.1:4627/v1/responses",
            apiKey: modelCredential,
            modelName: "azure/gpt-5.6-luna",
            timeout: 20,
            maxRetryAttempts: 1,
        });

        try {
            const result = await model.complete("Find the implementation.");

            expect(calls).toBe(1);
            expect(result).toMatchObject({ success: false });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("marks a successful response without provider usage incomplete", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ output_text: "done" }), {
                status: 200,
            });
        let recordedUsage: Record<string, unknown> | undefined;
        const model = createResponsesModel({
            endpoint: "http://127.0.0.1:4627/v1/responses",
            apiKey: modelCredential,
            modelName: "azure/gpt-5.6-luna",
        });

        try {
            await expect(
                model.complete("Find the implementation.", (usage) => {
                    recordedUsage = usage as unknown as Record<string, unknown>;
                }),
            ).resolves.toEqual({ success: true, data: "done" });
            expect(recordedUsage).toMatchObject({
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                usage_complete: false,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("does not retry after caller cancellation", async () => {
        const originalFetch = globalThis.fetch;
        const caller = new AbortController();
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            caller.abort(new Error("cancelled by caller"));
            throw new Error("cancelled by caller");
        };
        const model = createResponsesModel({
            endpoint: "http://127.0.0.1:4627/v1/responses",
            apiKey: modelCredential,
            modelName: "azure/gpt-5.6-luna",
            timeout: 60_000,
            maxRetryAttempts: 1,
        });

        try {
            await expect(
                model.complete(
                    "Find the implementation.",
                    undefined,
                    undefined,
                    undefined,
                    caller.signal,
                ),
            ).resolves.toMatchObject({ success: false });
            expect(calls).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("retries one fast transient server failure within the deadline", async () => {
        const originalFetch = globalThis.fetch;
        let calls = 0;
        let recordedUsage: Record<string, unknown> | undefined;
        globalThis.fetch = async () => {
            calls++;
            if (calls === 1) {
                return new Response("temporary", { status: 500 });
            }
            return new Response(
                JSON.stringify({
                    output_text: "done",
                    usage: {
                        input_tokens: 10,
                        output_tokens: 2,
                        total_tokens: 12,
                    },
                }),
                { status: 200 },
            );
        };
        const model = createResponsesModel({
            endpoint: "http://127.0.0.1:4627/v1/responses",
            apiKey: modelCredential,
            modelName: "azure/gpt-5.6-luna",
            timeout: 60_000,
            maxRetryAttempts: 1,
        });

        try {
            await expect(
                model.complete("Find the implementation.", (usage) => {
                    recordedUsage = usage as unknown as Record<string, unknown>;
                }),
            ).resolves.toEqual({ success: true, data: "done" });
            expect(calls).toBe(2);
            expect(recordedUsage?.usage_complete).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
