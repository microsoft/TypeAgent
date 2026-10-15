// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    resolveReviewedWikiBudget,
    resolveConfiguredWikiBudget,
} from "../src/wikiBudget.js";
import {
    answerIndexedEvidence,
    createIndexedAnswerModel,
} from "../src/indexedAnswer.js";
import {
    setRuntimeConfig,
    getRuntimeConfig,
    configFromEnvRecord,
} from "@typeagent/aiclient";
import type { ChatModel } from "@typeagent/aiclient";
import type { MemoryEvidence } from "../src/types.js";

test("wiki budgets reserve selected model capacity and reject incompatible strict overrides", () => {
    const previous = getRuntimeConfig();
    setRuntimeConfig(
        configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
            AZURE_OPENAI_API_KEY: "unit-test-key",
            AZURE_OPENAI_ENDPOINT_CUSTOM_EASTUS:
                "https://synthetic.invalid/custom",
        }),
    );
    try {
        expect(resolveConfiguredWikiBudget({})).toBeUndefined();
        expect(() =>
            resolveConfiguredWikiBudget({ MEMORY_WIKI_OUTPUT_TOKENS: "2000" }),
        ).toThrow("incompatible with uncapped provider capacity");
        expect(resolveReviewedWikiBudget({})).toMatchObject({
            contextTokens: 1050000,
            inputTokens: 16000,
            outputTokens: 128000,
            tokenizer: "o200k_base-estimate",
            chatAttempts: 24,
            embeddingAttempts: 128,
            embeddingInputTokens: 300000,
            inputReservedTokens: 160000,
            reservedTokens: 3232000,
            elapsedMs: 600000,
        });
        expect(
            resolveReviewedWikiBudget({ MEMORY_WIKI_CONTEXT_TOKENS: "150000" }),
        ).toMatchObject({ contextTokens: 150000, inputTokens: 16000 });
        expect(
            resolveReviewedWikiBudget({ MEMORY_WIKI_CONTEXT_TOKENS: "132000" }),
        ).toMatchObject({
            contextTokens: 132000,
            inputTokens: 3000,
        });
        expect(() =>
            resolveReviewedWikiBudget({ MEMORY_WIKI_CONTEXT_TOKENS: "128000" }),
        ).toThrow("positive context/output");
        expect(() =>
            resolveReviewedWikiBudget({
                MEMORY_WIKI_CONTEXT_TOKENS: "2000000",
            }),
        ).toThrow("incompatible");
        expect(() => resolveReviewedWikiBudget({}, "azure:custom")).toThrow(
            "verified context and output capacity",
        );
        expect(() =>
            resolveReviewedWikiBudget({ MEMORY_WIKI_TOKENIZER: "unknown" }),
        ).toThrow("MEMORY_WIKI_TOKENIZER");
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                    "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
                AZURE_OPENAI_API_KEY: "unit-test-key",
                TYPEAGENT_MODEL_REQUEST_CONSTRAINTS: JSON.stringify({
                    "azure:chat:gpt_6_luna": {
                        contextTokens: 22000,
                        inputTokens: 16000,
                        outputTokens: 1000,
                    },
                }),
            }),
        );
        expect(resolveReviewedWikiBudget({})).toMatchObject({
            contextTokens: 22000,
            inputTokens: 16000,
            outputTokens: 1000,
            reservedTokens: 184000,
        });
    } finally {
        setRuntimeConfig(previous);
    }
});

test("indexed answer serializes the strict citation schema on Azure chat completions", async () => {
    const previous = getRuntimeConfig();
    const originalFetch = globalThis.fetch;
    let serialized: unknown;
    setRuntimeConfig(
        configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS:
                "https://synthetic.invalid/chat",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "unit-test-key",
            AZURE_OPENAI_RESPONSE_FORMAT: "1",
        }),
    );
    globalThis.fetch = async (_url, options) => {
        serialized = JSON.parse(String(options?.body));
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                status: "answered",
                                answer: "Grounded",
                                citationIds: ["f0"],
                            }),
                        },
                    },
                ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    };
    try {
        const evidence: MemoryEvidence[] = [
            {
                evidenceId: "e",
                corpusId: "c",
                sourceId: "s",
                revisionId: "r",
                title: "Source",
                snippet: "Grounded",
                score: 1,
                sourceType: "text",
                indexedAt: "2026-10-10T00:00:00Z",
            },
        ];
        await answerIndexedEvidence(
            "question",
            evidence,
            4000,
            "gpt_4_o",
            createIndexedAnswerModel("gpt_4_o"),
        );
        expect(serialized).toMatchObject({
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "indexed_answer",
                    strict: true,
                    schema: {
                        additionalProperties: false,
                        required: ["status", "answer", "citationIds"],
                        properties: {
                            citationIds: { items: { enum: ["f0"] } },
                        },
                    },
                },
            },
        });
    } finally {
        globalThis.fetch = originalFetch;
        setRuntimeConfig(previous);
    }
});

test("indexed answer passes entire supplied subranges and rejects invented citation IDs (mock model only)", async () => {
    const evidence: MemoryEvidence[] = [
        {
            evidenceId: "s:r:indexed",
            corpusId: "c",
            sourceId: "s",
            revisionId: "r",
            title: "Synthetic",
            snippet: `${"context ".repeat(150)}governing qualification`,
            score: 1,
            sourceType: "text",
            indexedAt: "2026-10-10T00:00:00Z",
        },
    ];
    let submitted = "";
    const model: ChatModel = {
        completionSettings: {},
        complete: async (prompt) => {
            submitted = JSON.stringify(prompt);
            return {
                success: true,
                data: JSON.stringify({
                    status: "answered",
                    answer: "Limited qualified answer",
                    citationIds: ["f0"],
                }),
            };
        },
    };
    const result = await answerIndexedEvidence(
        "question",
        evidence,
        4000,
        undefined,
        model,
    );
    expect(submitted).toContain("governing qualification");
    expect(result.citations).toEqual(evidence);
    model.complete = async () => ({
        success: true,
        data: JSON.stringify({
            status: "answered",
            answer: "Invalid",
            citationIds: ["invented"],
        }),
    });

    await expect(
        answerIndexedEvidence("question", evidence, 4000, undefined, model),
    ).rejects.toThrow("unsupported citation");
    model.complete = async () => ({
        success: true,
        data: JSON.stringify({
            status: "answered",
            answer: "Invented non-canonical citation",
            citationIds: ["f00"],
        }),
    });
    await expect(
        answerIndexedEvidence("question", evidence, 4000, undefined, model),
    ).rejects.toThrow("unsupported citation");
    model.complete = async () => ({
        success: true,
        data: JSON.stringify({
            status: "noAnswer",
            answer: "Evidence is insufficient",
            citationIds: ["f0"],
        }),
    });
    await expect(
        answerIndexedEvidence("question", evidence, 4000, undefined, model),
    ).rejects.toThrow("status and citations disagree");
    model.complete = async () => ({
        success: true,
        data: JSON.stringify({
            status: "noAnswer",
            answer: "Evidence is insufficient",
            citationIds: [],
        }),
    });
    expect(
        await answerIndexedEvidence(
            "question",
            evidence,
            4000,
            undefined,
            model,
        ),
    ).toEqual({ answer: "Evidence is insufficient", citations: [] });
});

test("empty indexed evidence returns an explicit no-answer without resolving a model", async () => {
    expect(
        await answerIndexedEvidence("question", [], 4000, "azure:unconfigured"),
    ).toEqual({
        answer: "No supporting indexed fragments were found.",
        citations: [],
    });
});
