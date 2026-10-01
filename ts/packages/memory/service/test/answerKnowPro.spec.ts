// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { createKnowProCorpusIndex, FileMemoryService } from "../src/index.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

const knowledgeForText = (text: string) => ({
    entities: text.includes("Zephyr")
        ? [{ name: "Zephyr", type: ["service"] }]
        : [{ name: "Orion", type: ["service"] }],
    actions: [],
    inverseActions: [],
    topics: [text.includes("Zephyr") ? "Zephyr recovery" : "Orion billing"],
});

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
        generated.length = 0;
        root = await mkdtemp(
            path.join(os.tmpdir(), `typeagent-answer-knowpro-${randomUUID()}-`),
        );
        previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        service = new FileMemoryService(root, {
            procedureIndexFactory: (_corpusId, directory) =>
                new FakeProcedureCorpusIndex(directory),
            eventIndexFactory: (_corpusId, directory) =>
                new FakeProcedureCorpusIndex(directory),
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
                            fastStop: true,
                        } as never,
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
                                    answer: "Restart the Zephyr worker.",
                                },
                            };
                        },
                        combinePartialAnswers: async (
                            _question,
                            responses,
                        ) => ({
                            success: true as const,
                            data: responses[0],
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

        const extractive = await service.answer({
            corpusId,
            question: "Zephyr",
            answerMode: "extractive",
        });
        expect(extractive.mode).toBe("extractive");
        expect(extractive.answer).toContain("[1]");
    });
});
