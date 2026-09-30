// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { FileMemoryService, createKnowProCorpusIndex } from "../src/index.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

test("KnowPro filters structured procedure knowledge by state before ranking", async () => {
    const root = path.join(process.cwd(), `.procedure-knowpro-${randomUUID()}`);
    const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
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
    const knowledge = {
        entities: [{ name: "Zephyr", type: ["service"] }],
        actions: [],
        inverseActions: [],
        topics: ["Zephyr recovery"],
    };
    const service = new FileMemoryService(root, {
        indexFactory: (_corpusId, directory) =>
            new FakeProcedureCorpusIndex(directory),
        procedureIndexFactory: (corpusId, directory) =>
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
                        extract: async () => knowledge,
                        extractWithRetry: async () => ({
                            success: true,
                            data: knowledge,
                        }),
                    };
                return settings;
            }),
    });
    try {
        const { corpusId } = await service.createCorpus("Structured how-to");
        const waitForJob = async (jobId: string) => {
            for (let attempt = 0; attempt < 100; attempt++) {
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
        };
        for (const procedureId of ["archived", "saved"]) {
            await service.saveProcedure({
                corpusId,
                procedureId,
                document: {
                    title: "Restore Zephyr availability",
                    steps: ["Inspect the recovery logs."],
                    citations: [],
                },
            });
        }
        await service.archiveProcedure(corpusId, "archived", 1);
        const source = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "runbook",
                sourceType: "text",
                title: "Runbook",
                text: "Original runbook",
            },
            pipeline: { mode: "basic" },
        });
        await waitForJob(source.jobId);
        await service.saveProcedure({
            corpusId,
            procedureId: "stale",
            document: {
                title: "Restore Zephyr availability",
                steps: ["Consult the runbook."],
                citations: [
                    {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                    },
                ],
            },
        });
        const replacement = await service.replaceSource({
            corpusId,
            sourceId: source.sourceId,
            expectedActiveRevisionId: source.revisionId,
            source: {
                sourceType: "text",
                title: "Runbook",
                text: "Updated runbook",
            },
        });
        await waitForJob(replacement.jobId);
        const search = (states: Array<"saved" | "stale" | "archived">) =>
            service.searchProcedures({
                corpusId,
                query: "How can I diagnose the unavailable Zephyr service?",
                states,
                limit: 1,
            });
        expect(
            (await search(["saved"])).map(
                (match) => match.procedure.procedureId,
            ),
        ).toEqual(["saved"]);
        expect(
            (await search(["archived"])).map(
                (match) => match.procedure.procedureId,
            ),
        ).toEqual(["archived"]);
        expect(
            (await search(["stale"])).map(
                (match) => match.procedure.procedureId,
            ),
        ).toEqual(["stale"]);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previousProvider === undefined) {
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        } else {
            process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
        }
    }
});
