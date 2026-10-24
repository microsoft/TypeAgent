// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService, createKnowProCorpusIndex } from "../src/index.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const knowledgeForText = (text: string) => ({
    entities: text.includes("Zephyr")
        ? [{ name: "Zephyr", type: ["service"] }]
        : [{ name: "Orion", type: ["service"] }],
    actions: [],
    inverseActions: [],
    topics: [text.includes("Zephyr") ? "Zephyr recovery" : "Orion billing"],
});

let multipleSearches = false;
const languageModel = {
    completionSettings: {},
    complete: async () => ({
        success: true as const,
        data: JSON.stringify({
            searchExpressions: [
                {
                    rewrittenQuery: "Zephyr recovery",
                    filters: [
                        {
                            entitySearchTerms: [
                                { name: "Zephyr", isNamePronoun: false },
                            ],
                        },
                    ],
                },
                ...(multipleSearches
                    ? [
                          {
                              rewrittenQuery: "Orion billing",
                              filters: [
                                  {
                                      entitySearchTerms: [
                                          {
                                              name: "Orion",
                                              isNamePronoun: false,
                                          },
                                      ],
                                  },
                              ],
                          },
                      ]
                    : []),
            ],
        }),
    }),
};

async function waitForJob(service: FileMemoryService, jobId: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const job = await service.getJob(jobId);
        if (job?.state === "complete") {
            return;
        }
        if (job?.state === "failed") {
            throw new Error(job.error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Indexing job '${jobId}' timed out`);
}

describe("synthesized answers over the KnowPro corpus index", () => {
    let root: string;
    let service: FileMemoryService;
    let previousProvider: string | undefined;
    const generated: string[] = [];

    beforeEach(async () => {
        multipleSearches = false;
        generated.length = 0;
        root = await mkdtemp(
            path.join(os.tmpdir(), `typeagent-answer-knowpro-${randomUUID()}-`),
        );
        previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        service = new FileMemoryService(root, {
            informationalViews: false,
            eventIndexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, () => {
                    const settings = createDocMemorySettings(
                        64,
                        undefined,
                        languageModel,
                    );
                    settings.embeddingSize = 0;
                    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                        {
                            settings: { maxContextLength: 1000 },
                            extract: async (text: string) =>
                                knowledgeForText(text),
                            extractWithRetry: async (text: string) => ({
                                success: true as const,
                                data: knowledgeForText(text),
                            }),
                        };
                    settings.answerGenerator = {
                        settings: {
                            maxCharsInBudget: 16_000,
                            concurrency: 1,
                            fastStop: false,
                            answerGeneratorModel: languageModel,
                            answerCombinerModel: languageModel,
                        },
                        generateAnswer: async (_question, context) => {
                            generated.push(
                                typeof context === "string"
                                    ? context
                                    : JSON.stringify(context),
                            );
                            return {
                                success: true as const,
                                data: {
                                    type: "Answered" as const,
                                    answer: JSON.stringify(context).includes(
                                        "Orion",
                                    )
                                        ? "Reconcile Orion invoices."
                                        : "Restart the Zephyr worker.",
                                },
                            };
                        },
                        combinePartialAnswers: async (
                            _question,
                            responses,
                        ) => ({
                            success: true as const,
                            data: {
                                type: "Answered" as const,
                                answer: [
                                    ...new Set(
                                        responses.map(
                                            (response) => response.answer,
                                        ),
                                    ),
                                ].join("\n"),
                            },
                        }),
                    };
                    return settings;
                }),
        });
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previousProvider === undefined) {
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        } else {
            process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
        }
    });

    test("generates the answer with KnowPro and cites the evidence", async () => {
        const { corpusId } = await service.createCorpus("Runbooks");
        for (const [sourceId, text] of [
            ["zephyr", "Zephyr recovery: restart the Zephyr worker."],
            ["orion", "Orion billing: reconcile invoices nightly."],
        ]) {
            const ingested = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text,
                },
            });
            await waitForJob(service, ingested.jobId);
        }

        const answer = await service.answer({
            corpusId,
            question: "How do I recover Zephyr?",
        });

        expect(answer.mode).toBe("synthesized");
        expect(answer.answer).toBe("Restart the Zephyr worker.");
        expect(answer.citations.map((item) => item.sourceId)).toContain(
            "zephyr",
        );
        expect(generated.length).toBeGreaterThan(0);
        expect(answer.readerContext?.completedChunks).toBe(generated.length);
        expect(answer.readerContext?.serializedContextChars).toBeGreaterThan(0);
        const supplied = new Set([
            ...(answer.readerContext?.messageSourceIds ?? []),
            ...(answer.readerContext?.knowledgeSourceIds ?? []),
        ]);
        expect(
            answer.citations.every((citation) =>
                supplied.has(citation.sourceId),
            ),
        ).toBe(true);

        const extractive = await service.answer({
            corpusId,
            question: "Zephyr",
            answerMode: "extractive",
        });
        expect(extractive.mode).toBe("extractive");
        expect(extractive.answer).toContain("[1]");
    });

    test("independent search results receive one global evidence synthesis with opt-in diagnostics", async () => {
        multipleSearches = true;
        const { corpusId } = await service.createCorpus(
            "Complementary evidence",
        );
        for (const [sourceId, text] of [
            ["zephyr", "Restart the Zephyr worker."],
            ["orion", "Reconcile Orion invoices."],
        ]) {
            const result = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text,
                    authoredAt: "2024-05-10",
                },
            });
            await waitForJob(service, result.jobId);
        }
        const answer = await service.answer({
            corpusId,
            question: "What must be done for both services?",
            includeDiagnostics: true,
            temporalContext: {
                referenceTime: "2024-05-11",
                availabilityPolicy: "supplied-history",
            },
        });
        expect(answer.answer).toContain("Restart the Zephyr worker.");
        expect(answer.answer).toContain("Reconcile Orion invoices.");
        expect(
            answer.readerContext?.queryPlan?.searchQuery?.searchExpressions,
        ).toHaveLength(2);
        expect(answer.readerContext?.chunks?.length).toBeGreaterThan(0);
        expect(
            answer.readerContext?.chunks?.every(
                (chunk) => chunk.response.type === "Answered",
            ),
        ).toBe(true);
        expect(
            generated.some((context) => context.includes("2024-05-10")),
        ).toBe(true);
    });

    test("a metadata-only authored-date correction creates a new revision", async () => {
        const { corpusId } = await service.createCorpus("Dates");
        const source = {
            sourceId: "dated",
            sourceType: "text" as const,
            title: "dated",
            text: "Zephyr recovery.",
        };
        const first = await service.ingestDocument({
            corpusId,
            source: { ...source, authoredAt: "2024-05-10" },
        });
        await waitForJob(service, first.jobId);
        const second = await service.ingestDocument({
            corpusId,
            source: { ...source, authoredAt: "2024-05-11" },
        });
        await waitForJob(service, second.jobId);
        expect(first.revisionId).not.toBe(second.revisionId);
        await expect(
            service.ingestDocument({
                corpusId,
                source: {
                    ...source,
                    authoredAt: "2024-05-10",
                    temporalContext: { version: 1, scopes: [] },
                },
            }),
        ).rejects.toThrow("not both");
    });
});
