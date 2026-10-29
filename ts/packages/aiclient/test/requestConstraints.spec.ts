// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildConfig, flatten } from "@typeagent/config";
import { success } from "typechat";
import {
    ModelType,
    getChatModelPool,
    createChatModel,
    createEmbeddingModel,
} from "../src/openai.js";
import { getRuntimeConfig, setRuntimeConfig } from "../src/runtimeConfig.js";
import { checkSerializedRequestConstraints } from "../src/requestConstraints.js";
import { RequestAdmissionError } from "../src/requestBudget.js";
import { callJsonApiWithPool } from "../src/restClient.js";
import type { EndpointPool } from "../src/endpointPool.js";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import type { PromptSection } from "typechat";

test.each(["chat_completions", "responses", "messages"] as const)(
    "%s request inspection is offline and serializes the same request as dispatch",
    async (wireApi) => {
        const originalFetch = globalThis.fetch;
        const bodies: string[] = [];
        try {
            globalThis.fetch = async (_url, options) => {
                bodies.push(String(options?.body));
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { content: "{}" } }],
                        output: [
                            {
                                type: "message",
                                content: [{ type: "output_text", text: "{}" }],
                            },
                        ],
                        content: [{ type: "text", text: "{}" }],
                    }),
                    { status: 200 },
                );
            };
            const model = createChatModel(
                {
                    provider: "azure",
                    modelType: ModelType.Chat,
                    apiKey: "synthetic-key",
                    endpoint: "https://synthetic.invalid/inspection",
                    wireApi,
                    supportsResponseFormat: true,
                    requestConstraints: {
                        contextTokens: 30000,
                        inputTokens: 20000,
                        outputTokens: 5000,
                    },
                },
                { response_format: { type: "json_object" } },
            );
            const schema = {
                name: "test",
                schema: { type: "object", description: "Schema counts too" },
            };
            const prompts: (string | PromptSection[])[] = [
                "Multibyte: \u2603",
                [
                    { role: "system", content: "Synthetic system instruction" },
                    { role: "user", content: "Multibyte: \u2603" },
                ],
            ];
            for (const prompt of prompts) {
                const fetchesBeforeInspection = bodies.length;
                const inspected = model.inspectRequest!(prompt, schema);
                expect(bodies).toHaveLength(fetchesBeforeInspection);
                expect(inspected.constraints).toEqual(
                    checkSerializedRequestConstraints(
                        inspected.serializedRequest,
                        {
                            contextTokens: 30000,
                            inputTokens: 20000,
                            outputTokens: 5000,
                        },
                    ),
                );
                expect(inspected.constraints.outputTokens).toBe(5000);
                expect(inspected.tokenizer).toBe("o200k_base");
                expect(inspected.estimatedInputTokens).toBe(
                    countTokens(inspected.serializedRequest),
                );
                if (wireApi !== "messages") {
                    expect(inspected.serializedRequest).toContain(
                        "Schema counts too",
                    );
                } else {
                    expect(inspected.serializedRequest).not.toContain(
                        "Schema counts too",
                    );
                }
                expect(inspected.serializedRequest).not.toContain(
                    "synthetic-key",
                );
                expect(
                    (await model.complete(prompt, undefined, schema)).success,
                ).toBe(true);
                expect(bodies[fetchesBeforeInspection]).toBe(
                    inspected.serializedRequest,
                );
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    },
);

test("request inspection rejects configured constraints before fetching and reports missing metadata", async () => {
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    try {
        globalThis.fetch = async () => {
            fetches++;
            throw new Error("Inspection must not fetch");
        };
        const settings = {
            provider: "azure" as const,
            modelType: ModelType.Chat,
            apiKey: "synthetic-key",
            endpoint: "https://synthetic.invalid/inspection",
        };
        expect(
            createChatModel(settings).inspectRequest!("bounded").constraints
                .metadata,
        ).toBe("missing");
        const model = createChatModel({
            ...settings,
            requestConstraints: { inputTokens: 100, outputTokens: 5000 },
        });
        expect(() => model.inspectRequest!("x".repeat(200))).toThrow(
            RequestAdmissionError,
        );
        await expect(model.complete("x".repeat(200))).rejects.toBeInstanceOf(
            RequestAdmissionError,
        );
        expect(fetches).toBe(0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("request inspection is offline and serializes the same schema-bearing request as dispatch", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: string[] = [];
    try {
        globalThis.fetch = async (_url, options) => {
            bodies.push(String(options?.body));
            return new Response(
                JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
                { status: 200 },
            );
        };
        const model = createChatModel(
            {
                provider: "azure",
                modelType: ModelType.Chat,
                apiKey: "synthetic-key",
                endpoint: "https://synthetic.invalid/inspection",
                supportsResponseFormat: true,
                requestConstraints: {
                    contextTokens: 30000,
                    inputTokens: 20000,
                    outputTokens: 5000,
                },
            },
            { response_format: { type: "json_object" } },
        );
        const schema = {
            name: "test",
            schema: { type: "object", description: "Schema counts too" },
        };
        const inspected = model.inspectRequest!("Multibyte: \u2603", schema);
        expect(bodies).toHaveLength(0);
        expect(inspected.constraints).toMatchObject({
            metadata: "configured",
            outputTokens: 5000,
        });
        expect(inspected.estimatedInputTokens).toBeGreaterThan(0);
        expect(inspected.serializedRequest).toContain("Schema counts too");
        await model.complete("Multibyte: \u2603", undefined, schema);
        expect(bodies).toEqual([inspected.serializedRequest]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("uncapped chat reserves provider output capacity without adding a wire limit", async () => {
    const originalFetch = globalThis.fetch;
    const settings = {
        provider: "azure" as const,
        modelType: ModelType.Chat,
        apiKey: "synthetic-key",
        endpoint: "https://synthetic.invalid/uncapped",
        supportsResponseFormat: true,
        requestConstraints: { contextTokens: 10000, outputTokens: 4000 },
    };
    const bodies: object[] = [];
    try {
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(String(options?.body)) as object);
            return new Response(
                JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
                { status: 200 },
            );
        };
        const model = createChatModel(settings, {
            response_format: { type: "json_object" },
        });
        expect((await model.complete("bounded")).success).toBe(true);
        expect(bodies[0]).not.toHaveProperty("max_completion_tokens");
        expect(bodies[0]).not.toHaveProperty("max_tokens");
        expect(bodies[0]).not.toHaveProperty("max_output_tokens");
        expect(
            checkSerializedRequestConstraints(
                JSON.stringify(bodies[0]),
                settings.requestConstraints,
            ).outputTokens,
        ).toBe(4000);
        await expect(model.complete("x".repeat(6000))).rejects.toBeInstanceOf(
            RequestAdmissionError,
        );
        expect(bodies).toHaveLength(1);
        expect(
            (await createChatModel(settings).complete("bounded")).success,
        ).toBe(true);
        expect(bodies[1]).not.toHaveProperty("max_completion_tokens");
        expect(bodies[1]).not.toHaveProperty("max_tokens");
        expect(bodies[1]).not.toHaveProperty("max_output_tokens");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("uncapped admission requires known provider output capacity and rejects invalid native Messages limits", () => {
    const request = JSON.stringify({ messages: [] });
    expect(() =>
        checkSerializedRequestConstraints(request, { contextTokens: 10000 }),
    ).toThrow(RequestAdmissionError);
    expect(() =>
        checkSerializedRequestConstraints(
            JSON.stringify({ messages: [], max_tokens: 0 }),
            { outputTokens: 4000 },
        ),
    ).toThrow(RequestAdmissionError);
});

const chat = (text = "bounded") =>
    JSON.stringify({
        messages: [{ role: "user", content: text }],
        response_format: { schema: { description: "schema counts too" } },
    });

test("missing provider metadata is explicit, not a guessed input or lifetime ceiling", () => {
    expect(
        checkSerializedRequestConstraints(chat("x".repeat(20000))),
    ).toMatchObject({
        metadata: "missing",
        tokenAccounting: "utf8-byte-upper-bound",
    });
    expect(() =>
        checkSerializedRequestConstraints(chat(), { contextTokens: 4100 }),
    ).toThrow(RequestAdmissionError);
    expect(() =>
        checkSerializedRequestConstraints(chat(), { outputTokens: 3999 }),
    ).not.toThrow();
    expect(() =>
        checkSerializedRequestConstraints(
            JSON.stringify({ input: ["x".repeat(11)] }),
            { embeddingItemTokens: 10 },
        ),
    ).toThrow("item constraint");
    expect(() =>
        checkSerializedRequestConstraints(
            JSON.stringify({ input: ["a", "b"] }),
            { inputTokens: 2 },
        ),
    ).toThrow("provider request constraints");
    const serialized = chat();
    const boundary = Buffer.byteLength(serialized, "utf8") + 4000 + 1000;
    expect(
        checkSerializedRequestConstraints(serialized, {
            contextTokens: boundary,
            outputTokens: 4000,
        }),
    ).toMatchObject({
        metadata: "configured",
        outputTokens: 4000,
        safetyTokens: 1000,
    });
    expect(() =>
        checkSerializedRequestConstraints(serialized, {
            contextTokens: boundary - 1,
            outputTokens: 4000,
        }),
    ).toThrow(RequestAdmissionError);
    expect(() =>
        checkSerializedRequestConstraints(chat("x".repeat(20000)), {
            contextTokens: 128000,
            outputTokens: 4000,
        }),
    ).not.toThrow();
});

test("configured pooled admission is local; 429 Retry-After and transient rotation remain separate", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    const pool: EndpointPool = {
        modelKey: "configured-constraints",
        members: [1, 2].map((priority) => ({
            suffix: String(priority),
            priority,
            mode: "PAYG",
            cooldownUntil: 0,
            consecutive429s: 0,
            consecutiveSuccesses: 0,
            settings: {
                provider: "azure",
                modelType: ModelType.Chat,
                apiKey: "synthetic-key",
                endpoint: `https://synthetic.invalid/${priority}`,
                requestConstraints: {
                    contextTokens: 10000,
                    outputTokens: 4000,
                },
            },
        })),
    };
    const request = (text: string) => async () =>
        success({ headers: {}, body: JSON.parse(chat(text)) });
    try {
        globalThis.fetch = async () => {
            calls++;
            return new Response("{}", { status: 200 });
        };
        await expect(
            callJsonApiWithPool(pool, request("x".repeat(10000))),
        ).rejects.toBeInstanceOf(RequestAdmissionError);
        expect(calls).toBe(0);
        expect(
            pool.members.every(
                (member) =>
                    member.cooldownUntil === 0 && member.consecutive429s === 0,
            ),
        ).toBe(true);
        for (let i = 0; i < 129; i++) {
            expect(
                (await callJsonApiWithPool(pool, request("small"))).success,
            ).toBe(true);
        }
        expect(calls).toBe(129);
        calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return new Response("{}", {
                status: calls === 1 ? 429 : 200,
                headers: { "Retry-After": "10" },
            });
        };
        expect(
            (await callJsonApiWithPool(pool, request("small"))).success,
        ).toBe(true);
        expect(calls).toBe(2);
        expect(
            pool.members.some(
                (member) =>
                    member.consecutive429s === 1 &&
                    member.cooldownUntil > Date.now(),
            ),
        ).toBe(true);
        pool.members.forEach((member) => {
            member.cooldownUntil = 0;
        });
        calls = 0;
        globalThis.fetch = async () =>
            new Response("{}", { status: ++calls === 1 ? 503 : 200 });
        expect(
            (await callJsonApiWithPool(pool, request("small"))).success,
        ).toBe(true);
        expect(calls).toBe(2);
    } finally {
        globalThis.fetch = original;
    }
});

test("normal typed model selection carries constraints to chat and embedding transport without replacement", async () => {
    const original = getRuntimeConfig();
    const originalFetch = globalThis.fetch;
    const config = buildConfig(
        flatten({
            modelProvider: "azure",
            azureOpenAI: {
                defaultChat: {
                    endpoint: "https://synthetic.invalid/default",
                    auth: "synthetic-key",
                },
                defaultEmbedding: {
                    endpoint: "https://synthetic.invalid/embedding",
                    auth: "synthetic-key",
                },
                deployments: {
                    constraint_role: [
                        {
                            endpoint: "https://synthetic.invalid/selected",
                            region: "eastus",
                            auth: "synthetic-key",
                        },
                    ],
                },
            },
            modelRequestConstraints: {
                "azure:chat:constraint_role": {
                    contextTokens: 10000,
                    outputTokens: 2000,
                },
                "azure:embedding:": {
                    inputTokens: 100,
                    embeddingItemTokens: 20,
                },
            },
        }),
    );
    const urls: string[] = [];
    try {
        setRuntimeConfig(config);
        const pool = getChatModelPool("azure:constraint_role");
        expect(pool.members[0].settings.endpoint).toBe(
            "https://synthetic.invalid/selected",
        );
        globalThis.fetch = async (url) => {
            urls.push(String(url));
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: "{}" } }],
                    data: [
                        {
                            embedding: Array.from(
                                { length: 1536 },
                                (_, index) => (index === 0 ? 1 : 0),
                            ),
                        },
                    ],
                }),
                { status: 200 },
            );
        };
        expect(
            (await createChatModel("azure:constraint_role").complete("bounded"))
                .success,
        ).toBe(true);
        await expect(
            createEmbeddingModel().generateEmbedding("x".repeat(21)),
        ).rejects.toBeInstanceOf(RequestAdmissionError);
        expect(
            (await createEmbeddingModel().generateEmbedding("bounded")).success,
        ).toBe(true);
        expect(urls).toEqual([
            "https://synthetic.invalid/selected",
            "https://synthetic.invalid/embedding",
        ]);
        setRuntimeConfig({ ...config, modelRequestConstraints: undefined });
        expect(
            getChatModelPool("azure:constraint_role").members[0].settings
                .requestConstraints,
        ).toBeUndefined();
    } finally {
        setRuntimeConfig(original);
        globalThis.fetch = originalFetch;
    }
});
