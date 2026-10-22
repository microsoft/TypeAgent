// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import type { EmbeddingRole, TextEmbeddingModel } from "@typeagent/aiclient";
import * as kp from "@typeagent/knowpro";
import { createEmbeddingCache } from "@typeagent/knowledge-processor";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService, KnowProCorpusIndex } from "../src/index.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("retained-source rebuild with real KnowPro and deterministic embeddings", () => {
    let root: string;
    let service: FileMemoryService;
    let forbidden: boolean;
    let failPublication: boolean;
    let extractionCalls: number;
    let embeddingCalls: number;
    let identityRevision: string;

    function model(role: EmbeddingRole = "document"): TextEmbeddingModel {
        const embed = (text: string) => {
            embeddingCalls++;
            if (forbidden) throw new Error("Unexpected embedding generation");
            return text.includes("FORGOTTEN_NEEDLE") ? [1, 0, 0] : [0, 1, 0];
        };
        return {
            maxBatchSize: 16,
            embeddingIdentity: {
                schemaVersion: 1,
                provider: "offline",
                model: "retained-index",
                revision: identityRevision,
                dimensions: 3,
                task: role,
                prompt: role,
                pooling: "mean",
                normalization: "l2",
                preprocessing: "fixture",
                artifactHash: "b".repeat(64),
            },
            forRole: model,
            generateEmbedding: async (text) => ({
                success: true,
                data: embed(text),
            }),
            generateEmbeddingBatch: async (texts) => ({
                success: true,
                data: texts.map(embed),
            }),
        };
    }

    function settings(): DocMemorySettings {
        const embeddingModel = createEmbeddingCache(model(), 32);
        const conversationSettings = kp.createConversationSettings(
            embeddingModel,
            3,
        );
        const knowledge = (text: string) => {
            extractionCalls++;
            if (forbidden) throw new Error("Unexpected knowledge extraction");
            return {
                entities: [
                    {
                        name: text.includes("FORGOTTEN_NEEDLE")
                            ? "FORGOTTEN_NEEDLE"
                            : "Retained",
                        type: ["service"],
                    },
                ],
                topics: ["shared topic"],
                actions: [],
                inverseActions: [],
            };
        };
        conversationSettings.semanticRefIndexSettings.knowledgeExtractor = {
            settings: { maxContextLength: 10000 },
            extract: async (text) => knowledge(text),
            extractWithRetry: async (text) => ({
                success: true,
                data: knowledge(text),
            }),
        };
        return {
            embeddingModel,
            embeddingSize: 3,
            conversationSettings,
            languageModel: {
                completionSettings: {},
                complete: async () => {
                    throw new Error("Unexpected chat");
                },
            },
        };
    }

    function open(): FileMemoryService {
        return new FileMemoryService(root, {
            informationalViews: false,
            sourceSynopses: false,
            viewDrafts: false,
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexFactory: (id, directory) => {
                const index = new KnowProCorpusIndex(id, directory, settings);
                const retain = index.rebuildRetained.bind(index);
                index.rebuildRetained = async (...args) => {
                    const result = await retain(...args);
                    if (failPublication) {
                        failPublication = false;
                        throw new Error("Controlled prepublication failure");
                    }
                    return result;
                };
                return index;
            },
        });
    }

    async function wait(jobId: string): Promise<void> {
        for (let i = 0; i < 500; i++) {
            const job = await service.getJob(jobId);
            if (job?.state === "complete") return;
            if (job?.state === "failed") throw new Error(job.error);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Fixture ingestion timed out");
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "retained-index-service-"));
        forbidden = false;
        failPublication = false;
        extractionCalls = 0;
        embeddingCalls = 0;
        identityRevision = "1";
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function ingest(): Promise<string> {
        const { corpusId } = await service.createCorpus("Retained test");
        for (const [sourceId, text] of [
            ["private", "FORGOTTEN_NEEDLE must be physically removed."],
            ["retained", "Retained service recovery instructions."],
        ]) {
            const result = await service.ingestDocument({
                corpusId,
                source: { sourceId, sourceType: "text", title: sourceId, text },
            });
            await wait(result.jobId);
        }
        expect(extractionCalls).toBeGreaterThan(0);
        expect(embeddingCalls).toBeGreaterThan(0);
        return corpusId;
    }

    async function verify(corpusId: string, messageCount = 1): Promise<void> {
        expect(await service.getSource(corpusId, "private")).toBeUndefined();
        expect(await service.getSource(corpusId, "retained")).toBeDefined();
        const manifest = JSON.parse(
            await readFile(path.join(root, corpusId, "manifest.json"), "utf8"),
        );
        expect(manifest.authorizedSourceRemoval).toBeUndefined();
        const directory = path.join(
            root,
            corpusId,
            "index",
            manifest.indexGeneration,
        );
        const memory = await DocMemory.readFromFile(
            directory,
            "corpus",
            settings(),
        );
        expect(memory!.hasCompleteIndex).toBe(true);
        const data = await memory!.serialize();
        expect(data.messages).toHaveLength(messageCount);
        expect(JSON.stringify(data)).not.toContain("FORGOTTEN_NEEDLE");
        expect(
            data.semanticRefs.some((ref) => ref.knowledgeType === "entity"),
        ).toBe(true);
        for (const file of await readdir(
            path.join(root, corpusId, "index", ".segments"),
        ))
            expect(
                await readFile(
                    path.join(root, corpusId, "index", ".segments", file),
                    "utf8",
                ),
            ).not.toContain("FORGOTTEN_NEEDLE");
    }

    test("forget and restart reuse complete facts/vectors with both providers forbidden", async () => {
        const corpusId = await ingest();
        await service.close();
        service = open();
        await service.initialize();
        forbidden = true;
        const before = { extractionCalls, embeddingCalls };
        const preview = await service.previewForgetSource(corpusId, "private");
        await service.forgetSource({
            corpusId,
            sourceId: "private",
            confirmationToken: preview.confirmationToken,
        });
        await verify(corpusId);
        await service.close();
        service = open();
        await service.initialize();
        await verify(corpusId);
        expect({ extractionCalls, embeddingCalls }).toEqual(before);
        forbidden = false;
        const added = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "later",
                sourceType: "text",
                title: "Later",
                text: "Retained follow-up instructions.",
            },
        });
        await wait(added.jobId);
        forbidden = true;
        await verify(corpusId, 2);
    });

    test("failed detached publication stays blocked and restart finishes purge without models", async () => {
        const corpusId = await ingest();
        forbidden = true;
        const before = { extractionCalls, embeddingCalls };
        const preview = await service.previewForgetSource(corpusId, "private");
        failPublication = true;
        await expect(
            service.forgetSource({
                corpusId,
                sourceId: "private",
                confirmationToken: preview.confirmationToken,
            }),
        ).rejects.toThrow("Controlled prepublication failure");
        await expect(service.getSource(corpusId, "private")).rejects.toThrow(
            "Authorized source removal",
        );
        await service.close();
        service = open();
        await service.initialize();
        await verify(corpusId);
        expect({ extractionCalls, embeddingCalls }).toEqual(before);
    });

    test("incompatible retained embedding identity fails explicitly rather than rebuilding silently", async () => {
        const corpusId = await ingest();
        forbidden = true;
        const before = { extractionCalls, embeddingCalls };
        identityRevision = "incompatible";
        const preview = await service.previewForgetSource(corpusId, "private");
        await expect(
            service.forgetSource({
                corpusId,
                sourceId: "private",
                confirmationToken: preview.confirmationToken,
            }),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
        await expect(service.getSource(corpusId, "retained")).rejects.toThrow(
            "Authorized source removal",
        );
        await service.close();
        identityRevision = "1";
        service = open();
        await service.initialize();
        await verify(corpusId);
        expect({ extractionCalls, embeddingCalls }).toEqual(before);
    });
});
