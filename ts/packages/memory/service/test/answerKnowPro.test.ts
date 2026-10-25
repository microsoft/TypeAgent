// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRuntimeConfigSync } from "@typeagent/config";
import {
    getRuntimeConfig,
    openai,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { FileMemoryService, createKnowProCorpusIndex } from "../src/index.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

test("configured Azure deployment answers synthetic KnowPro evidence with exact original citations", async () => {
    const previousConfig = getRuntimeConfig();
    const endpoint = "azure:GPT_6_LUNA";
    const root = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-answer-knowpro-live-"),
    );
    let service: FileMemoryService | undefined;
    try {
        setRuntimeConfig(loadRuntimeConfigSync().config);
        const pool = openai.getChatModelPool(endpoint);
        expect(pool.members.length).toBeGreaterThan(0);
        const languageModel = openai.createChatModel(endpoint);
        service = new FileMemoryService(root, {
            informationalViews: false,
            viewModelEndpoint: endpoint,
            eventIndexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, () =>
                    createDocMemorySettings(64, undefined, languageModel),
                ),
        });
        const { corpusId } = await service.createCorpus(
            "Isolated synthetic live answer test",
        );
        for (const [sourceId, text] of [
            ["zephyr", "Zephyr recovery: restart the Zephyr worker."],
            ["orion", "Orion billing: reconcile Orion invoices nightly."],
        ]) {
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text,
                },
            });
            const job = await waitForMemoryJob(service, admitted.jobId);
            if (job.state !== "complete")
                throw new Error(
                    `Live ingestion failed: ${job.state}; ${job.error ?? "no error detail"}`,
                );
        }
        const cases = [];
        for (const [question, sourceIds] of [
            ["How do I recover Zephyr?", ["zephyr"]],
            [
                "How do I recover Zephyr and reconcile Orion billing?",
                ["zephyr", "orion"],
            ],
        ] as const) {
            const answer = await service.answer({
                corpusId,
                question,
                retrievalPolicy: "sourcesOnly",
                includeDiagnostics: true,
            });
            expect(answer.mode).toBe("synthesized");
            expect(answer.answer).toMatch(/restart/i);
            if (sourceIds.some((sourceId) => sourceId === "orion"))
                expect(answer.answer).toMatch(/reconcil/i);
            expect(answer.citations.map((item) => item.sourceId)).toEqual(
                expect.arrayContaining(sourceIds),
            );
            expect(answer.readerContext?.answerPath).toBe("sources-and-views");
            expect(answer.readerContext?.integratedAnswer?.retrievalMode).toBe(
                "sourcesOnly",
            );
            for (const citation of answer.citations) {
                if (!citation.locator)
                    throw new Error("Live citation has no indexed locator");
                const resolved = await service.getSourceContent({
                    corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    indexedLocator: citation.locator,
                });
                expect(resolved.content).toBe(citation.snippet);
            }
            cases.push({
                question,
                answer: answer.answer,
                citations: answer.citations,
            });
        }
        console.log(
            "Live answer receipt",
            JSON.stringify({
                endpoint,
                poolMembers: pool.members.length,
                cases,
            }),
        );
    } finally {
        try {
            await service?.close();
        } finally {
            setRuntimeConfig(previousConfig);
            await rm(root, { recursive: true, force: true });
        }
    }
}, 600000);
