// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    resolveReviewedWikiBudget,
    resolveConfiguredWikiBudget,
} from "../src/wikiBudget.js";
import {
    answerIndexedEvidence,
    createIndexedAnswerModel,
    mergeIndexedAnswerEvidence,
} from "../src/indexedAnswer.js";
import {
    setRuntimeConfig,
    getRuntimeConfig,
    configFromEnvRecord,
} from "@typeagent/aiclient";
import type { ChatModel } from "@typeagent/aiclient";
import type { MemoryEvidence } from "../src/types.js";
import { parseTemporalValue } from "@typeagent/knowpro";

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
                        required: [
                            "status",
                            "answer",
                            "citationIds",
                            "retrievalQueries",
                        ],
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

test("indexed answers separate source calendars from question time and diagnostics do not change model input", async () => {
    const evidence: MemoryEvidence[] = [
        {
            evidenceId: "source:revision:indexed",
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Original dated source",
            locator: "indexed:0:anchor:0-30",
            snippet: "Yesterday I visited the museum.",
            score: 1,
            sourceType: "text",
            indexedAt: "2026-10-22T00:00:00Z",
            temporalContext: {
                version: 1,
                sourceRevisionId: "revision",
                contextHash: "source-context",
                ownerId: "original-message",
                sourceSpan: { start: 0, end: 30 },
                messageTime: parseTemporalValue("2024-01-07T00:30:00+14:00"),
                inheritedDateEvidence: [],
            },
        },
    ];
    const prompts: string[] = [];
    const model: ChatModel = {
        completionSettings: {},
        complete: async (prompt) => {
            prompts.push(JSON.stringify(prompt));
            return {
                success: true,
                data: JSON.stringify({
                    status: "answered",
                    answer: "The museum visit was on January 6.",
                    citationIds: ["f0"],
                }),
            };
        },
    };
    const temporalContext = {
        referenceTime: "2024/02/01 12:00",
        availabilityPolicy: "supplied-history" as const,
    };
    const ordinary = await answerIndexedEvidence(
        "When did I visit the museum?",
        evidence,
        4000,
        undefined,
        model,
        { temporalContext },
    );
    const observed = await answerIndexedEvidence(
        "When did I visit the museum?",
        evidence,
        4000,
        undefined,
        model,
        { temporalContext, includeDiagnostics: true },
    );
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).toContain("recorded preferences");
    expect(prompts[0]).toContain("never invent named offerings");
    expect(prompts[0]).toContain("not retrieval order");
    expect(prompts[0]).toContain("Still abstain when identity");
    expect(ordinary.readerContext).toBeUndefined();
    expect(observed.answer).toBe(ordinary.answer);
    expect(observed.citations).toEqual(ordinary.citations);
    expect(observed.readerContext?.answerPath).toBe("indexed-fragments");
    expect(observed.readerContext?.indexedAnswer).toEqual({
        temporalContext: {
            referenceTime: parseTemporalValue(temporalContext.referenceTime),
            availabilityPolicy: "supplied-history",
        },
        fragments: evidence,
        response: {
            status: "answered",
            answer: observed.answer,
            citationIds: ["f0"],
        },
    });
    const prompt: { role: string; content: string }[] = JSON.parse(prompts[0]);
    const user = prompt.find((item) => item.role === "user")!;
    expect(user.content).toContain("2024-01-07T00:30:00+14:00");
    expect(user.content).toContain("2024-01-06T10:30:00.000Z");
    expect(user.content).toContain("2024/02/01 12:00");
    expect(prompt[0].content).toContain(
        "not the question, capture or index clock",
    );
    expect(prompt[0].content).toContain(
        "Require the name or a supported alias/identity link",
    );
    expect(prompt[0].content).toContain("otherwise return noAnswer");
    expect(prompt[0].content).toContain("not an explicit same-day date");
    expect(observed.readerContext?.serializedContextChars).toBe(
        user.content.length,
    );
    expect(observed.readerContext?.messageSourceIds).toEqual(["source"]);
});

test("refined indexed context is round-robin, bounded and nonoverlapping", () => {
    const evidence = (sourceId: string, start: number): MemoryEvidence => ({
        evidenceId: `${sourceId}:${start}`,
        corpusId: "corpus",
        sourceId,
        revisionId: "r",
        title: sourceId,
        locator: `indexed:0:${"a".repeat(64)}:${start}-${start + 10}`,
        snippet: "0123456789",
        score: 1,
        sourceType: "text",
        indexedAt: "2026-10-23T00:00:00Z",
    });
    const result = mergeIndexedAnswerEvidence(
        [
            [evidence("price", 0), evidence("price", 5), evidence("price", 20)],
            [evidence("renovation", 0), evidence("other", 0)],
        ],
        3,
        30,
    );
    expect(result.map((item) => item.evidenceId)).toEqual([
        "price:0",
        "renovation:0",
        "other:0",
    ]);
    expect(mergeIndexedAnswerEvidence([result], 12, 19)).toHaveLength(1);
});

test.each([null, ["one", "two", "three"], [""], ["x".repeat(241)], [4]])(
    "indexed reader rejects invalid follow-up searches %j",
    async (retrievalQueries) => {
        const model: ChatModel = {
            completionSettings: {},
            complete: async () => ({
                success: true,
                data: JSON.stringify({
                    status: "noAnswer",
                    answer: "Missing evidence",
                    citationIds: [],
                    retrievalQueries,
                }),
            }),
        };
        const evidence: MemoryEvidence = {
            evidenceId: "e",
            corpusId: "c",
            sourceId: "s",
            revisionId: "r",
            title: "Evidence",
            locator: "indexed:0:anchor:0-4",
            snippet: "Fact",
            score: 1,
            sourceType: "text",
            indexedAt: "2026-10-23T00:00:00Z",
        };
        await expect(
            answerIndexedEvidence(
                "Question",
                [evidence],
                4000,
                undefined,
                model,
            ),
        ).rejects.toThrow("Invalid indexed answer retrieval queries");
    },
);

test.each([
    [{ availabilityPolicy: "as-of" as const }, /Strict as-of/],
    [
        { referenceTime: "not a supplied date" },
        /Unsupported or invalid source date format/,
    ],
] as const)(
    "invalid indexed-answer temporal context fails before empty-evidence fallback: %j",
    async (temporalContext, error) => {
        await expect(
            answerIndexedEvidence(
                "question",
                [],
                4000,
                "azure:unconfigured",
                undefined,
                { temporalContext },
            ),
        ).rejects.toThrow(error);
    },
);
