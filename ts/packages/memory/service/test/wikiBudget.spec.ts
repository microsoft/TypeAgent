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

test("wiki budgeting does not require capability declarations and enforces optional tighter limits", () => {
    expect(resolveConfiguredWikiBudget({})).toBeUndefined();
    expect(
        resolveConfiguredWikiBudget({ MEMORY_WIKI_OUTPUT_TOKENS: "2000" }),
    ).toMatchObject({ outputTokens: 2000, contextTokens: undefined });
    expect(resolveReviewedWikiBudget({})).toMatchObject({
        contextTokens: undefined,
        inputTokens: 16000,
        outputTokens: 4000,
        tokenizer: "o200k_base-estimate",
        chatAttempts: 24,
        reservedTokens: 160000,
        elapsedMs: 600000,
    });

    expect(
        resolveReviewedWikiBudget({ MEMORY_WIKI_CONTEXT_TOKENS: "128000" }),
    ).toMatchObject({ contextTokens: 128000, inputTokens: 16000 });
    const declared = {
        MEMORY_WIKI_CONTEXT_TOKENS: "21000",
        MEMORY_WIKI_OUTPUT_TOKENS: "4000",
        MEMORY_WIKI_TOKENIZER: "o200k_base",
    };
    expect(resolveReviewedWikiBudget(declared)).toMatchObject({
        contextTokens: 21000,
        inputTokens: 16000,
        outputTokens: 4000,
    });
    expect(
        resolveReviewedWikiBudget({
            ...declared,
            MEMORY_WIKI_CONTEXT_TOKENS: "6000",
            MEMORY_WIKI_OUTPUT_TOKENS: "2000",
        }),
    ).toMatchObject({ inputTokens: 3000, outputTokens: 2000 });
    expect(() =>
        resolveReviewedWikiBudget({
            ...declared,
            MEMORY_WIKI_TOKENIZER: "unknown",
        }),
    ).toThrow("MEMORY_WIKI_TOKENIZER");
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
            createIndexedAnswerModel(4000, "gpt_4_o"),
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
