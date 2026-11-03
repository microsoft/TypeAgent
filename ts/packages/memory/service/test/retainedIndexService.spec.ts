// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import type { EmbeddingRole, TextEmbeddingModel } from "@typeagent/aiclient";
import * as kp from "@typeagent/knowpro";
import { createEmbeddingCache } from "@typeagent/knowledge-processor";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService, KnowProCorpusIndex } from "../src/index.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe.each([false, true])(
    "retained-source rebuild with prepared indexing=%s",
    (prepared) => {
        let root: string;
        let service: FileMemoryService;
        let forbidden: boolean;
        let forbidExtraction: boolean;
        let failPublication: boolean;
        let extractionCalls: number;
        let embeddingCalls: number;
        let identityRevision: string;
        let previousPrepared: string | undefined;

        function model(role: EmbeddingRole = "document"): TextEmbeddingModel {
            const embed = (text: string) => {
                embeddingCalls++;
                if (forbidden)
                    throw new Error("Unexpected embedding generation");
                return text.includes("FORGOTTEN_NEEDLE")
                    ? [1, 0, 0]
                    : [0, 1, 0];
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
                if (forbidden || forbidExtraction)
                    throw new Error("Unexpected knowledge extraction");
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
                frameProjections: true,
                informationalViews: false,
                sourceSynopses: false,
                viewDrafts: false,
                eventIndexFactory: (_id, directory) =>
                    new FakeSemanticCorpusIndex(directory),
                indexFactory: (id, directory) => {
                    const index = new KnowProCorpusIndex(
                        id,
                        directory,
                        settings,
                    );
                    const retain = index.rebuildRetained.bind(index);
                    index.rebuildRetained = async (...args) => {
                        const result = await retain(...args);
                        if (failPublication) {
                            failPublication = false;
                            throw new Error(
                                "Controlled prepublication failure",
                            );
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
            previousPrepared = process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
            if (prepared) process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING = "1";
            else delete process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
            root = await mkdtemp(
                path.join(os.tmpdir(), "retained-index-service-"),
            );
            forbidden = false;
            forbidExtraction = false;
            failPublication = false;
            extractionCalls = 0;
            embeddingCalls = 0;
            identityRevision = "1";
            service = open();
        });
        afterEach(async () => {
            try {
                await service.close();
                await rm(root, { recursive: true, force: true });
            } finally {
                if (previousPrepared === undefined)
                    delete process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
                else
                    process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING =
                        previousPrepared;
            }
        });

        async function ingest(capturedAt?: string): Promise<string> {
            const { corpusId } = await service.createCorpus("Retained test");
            for (const [sourceId, text] of [
                ["private", "FORGOTTEN_NEEDLE must be physically removed."],
                ["retained", "Retained service recovery instructions."],
            ]) {
                const result = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId,
                        sourceType: "text",
                        title: sourceId,
                        text,
                        ...(capturedAt === undefined ? {} : { capturedAt }),
                    },
                });
                await wait(result.jobId);
            }
            expect(extractionCalls).toBeGreaterThan(0);
            expect(embeddingCalls).toBeGreaterThan(0);
            return corpusId;
        }

        async function verify(
            corpusId: string,
            messageCount = 1,
        ): Promise<void> {
            expect((await service.drainMaintenance()).settled).toBe(true);
            expect(
                await service.getSource(corpusId, "private"),
            ).toBeUndefined();
            expect(await service.getSource(corpusId, "retained")).toBeDefined();
            const manifest = JSON.parse(
                await readFile(
                    path.join(root, corpusId, "manifest.json"),
                    "utf8",
                ),
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

        test("real KnowPro ingestion supports persisted temporal frame filtering before and after restart and forget", async () => {
            const corpusId = await ingest("2026-11-02T00:00:00Z");
            const query = () =>
                service.queryFrame({
                    corpusId,
                    schemaId: "source",
                    schemaRevision: 1,
                    predicate: {
                        and: [
                            {
                                fieldId: "capturedAt",
                                op: "gte",
                                value: {
                                    kind: "instant",
                                    raw: "2000-01-01T00:00:00Z",
                                },
                            },
                            {
                                fieldId: "capturedAt",
                                op: "lt",
                                value: {
                                    kind: "instant",
                                    raw: "2100-01-01T00:00:00Z",
                                },
                            },
                        ],
                    },
                });
            expect((await query()).rows).toHaveLength(2);
            await service.close();
            service = open();
            forbidden = true;
            expect((await query()).rows).toHaveLength(2);
            const preview = await service.previewForgetSource(
                corpusId,
                "private",
            );
            await service.forgetSource({
                corpusId,
                sourceId: "private",
                confirmationToken: preview.confirmationToken,
            });
            expect((await query()).rows.map((row) => row.ownerKey)).toEqual([
                "source:retained",
            ]);
        });

        test("forget and restart reuse complete facts/vectors with both providers forbidden", async () => {
            const corpusId = await ingest();
            await service.close();
            service = open();
            await service.initialize();
            forbidden = true;
            const before = { extractionCalls, embeddingCalls };
            const preview = await service.previewForgetSource(
                corpusId,
                "private",
            );
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
            const preview = await service.previewForgetSource(
                corpusId,
                "private",
            );
            failPublication = true;
            await expect(
                service.forgetSource({
                    corpusId,
                    sourceId: "private",
                    confirmationToken: preview.confirmationToken,
                }),
            ).rejects.toThrow("Controlled prepublication failure");
            await expect(
                service.getSource(corpusId, "private"),
            ).rejects.toThrow("Authorized source removal");
            await service.close();
            service = open();
            await service.initialize();
            await verify(corpusId);
            expect({ extractionCalls, embeddingCalls }).toEqual(before);
        });

        test("legacy partial term coverage backfills only missing retained vectors without re-extraction", async () => {
            const corpusId = await ingest();
            await service.close();
            const manifest = JSON.parse(
                await readFile(
                    path.join(root, corpusId, "manifest.json"),
                    "utf8",
                ),
            );
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
            const data = await memory!.serialize();
            const terms = data.relatedTermsIndexData!.textEmbeddingData!;
            expect(terms.textItems).toContain("retained");
            const selected = terms.textItems
                .map((text, i) => ({ text, vector: terms.embeddings[i] }))
                .filter(
                    ({ text }) =>
                        text !== "retained" && text !== "forgotten_needle",
                );
            terms.textItems = selected.map(({ text }) => text);
            terms.embeddings = selected.map(({ vector }) => vector);
            await kp.writeConversationDataToFile(data, directory, "corpus");
            forbidExtraction = true;
            const before = { extractionCalls, embeddingCalls };
            service = open();
            await service.initialize();
            const preview = await service.previewForgetSource(
                corpusId,
                "private",
            );
            await service.forgetSource({
                corpusId,
                sourceId: "private",
                confirmationToken: preview.confirmationToken,
            });
            expect(extractionCalls).toBe(before.extractionCalls);
            expect(embeddingCalls - before.embeddingCalls).toBe(1);
            forbidden = true;
            await verify(corpusId);
        });

        async function generation(corpusId: string) {
            const manifest: { indexGeneration: string } = JSON.parse(
                await readFile(
                    path.join(root, corpusId, "manifest.json"),
                    "utf8",
                ),
            );
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
            return { directory, memory: memory!, id: manifest.indexGeneration };
        }

        async function makeLegacy(corpusId: string) {
            await service.close();
            const original = await generation(corpusId);
            const data = await original.memory.serialize();
            const postings = data.semanticIndexData!;
            delete postings.normalizationVersion;
            const retained = postings.items.find(
                (item) => item.term === "retained",
            )!;
            retained.term = " retained ";
            retained.semanticRefOrdinals.forEach((posting) => {
                posting.score = 2;
            });
            postings.items.push({
                term: "retained\t",
                semanticRefOrdinals: retained.semanticRefOrdinals.map(
                    (posting) => ({
                        ...posting,
                        score: 5,
                    }),
                ),
            });
            const related = data.relatedTermsIndexData!;
            delete related.normalizationVersion;
            related.textEmbeddingData!.textItems =
                related.textEmbeddingData!.textItems.map((term) =>
                    term === "retained" ? " retained " : term,
                );
            await kp.writeConversationDataToFile(
                data,
                original.directory,
                "corpus",
            );
            await writeFile(
                path.join(original.directory, "index-schema.json"),
                JSON.stringify({
                    indexSchemaVersion: 1,
                    engine: "knowpro",
                    indexKind: "documents",
                }),
            );
            service = open();
            await service.initialize();
            return original.id;
        }

        test("explicit reindex upgrades legacy collisions, backfills changed keys and survives reload without extraction", async () => {
            const corpusId = await ingest();
            const original = await makeLegacy(corpusId);
            const legacy = await generation(corpusId);
            expect(legacy.memory.semanticRefIndex!.normalizationVersion).toBe(
                1,
            );
            expect(
                legacy.memory.semanticRefIndex!.lookupTerm(" retained "),
            ).toHaveLength(1);
            forbidExtraction = true;
            const before = { extractionCalls, embeddingCalls };
            await service.reindexCorpus(corpusId);
            const upgraded = await generation(corpusId);
            expect(upgraded.id).not.toBe(original);
            expect(upgraded.memory.semanticRefIndex!.normalizationVersion).toBe(
                2,
            );
            expect(
                upgraded.memory.semanticRefIndex!.lookupTerm(" \tRetained\n"),
            ).toEqual([
                {
                    semanticRefOrdinal:
                        legacy.memory.semanticRefIndex!.lookupTerm(
                            " retained ",
                        )[0].semanticRefOrdinal,
                    score: 5,
                },
            ]);
            expect(extractionCalls).toBe(before.extractionCalls);
            expect(embeddingCalls - before.embeddingCalls).toBe(1);
            const schema = JSON.parse(
                await readFile(
                    path.join(upgraded.directory, "index-schema.json"),
                    "utf8",
                ),
            );
            expect(schema.termNormalizationVersion).toBe(2);
            const expected = await upgraded.memory.serialize();
            forbidden = true;
            await service.close();
            service = open();
            await service.initialize();
            expect(
                await (await generation(corpusId)).memory.serialize(),
            ).toEqual(expected);
            expect(await service.getSource(corpusId, "retained")).toBeDefined();
        });

        test("failed normalization upgrade preserves the old generation and legacy lookup for retry", async () => {
            const corpusId = await ingest();
            const original = await makeLegacy(corpusId);
            forbidExtraction = true;
            failPublication = true;
            await expect(service.reindexCorpus(corpusId)).rejects.toThrow(
                "Controlled prepublication failure",
            );
            const unchanged = await generation(corpusId);
            expect(unchanged.id).toBe(original);
            expect(
                unchanged.memory.semanticRefIndex!.normalizationVersion,
            ).toBe(1);
            expect(
                unchanged.memory.semanticRefIndex!.lookupTerm(" retained "),
            ).toHaveLength(1);
            expect(await service.getSource(corpusId, "retained")).toBeDefined();
            await service.reindexCorpus(corpusId);
            expect(
                (await generation(corpusId)).memory.semanticRefIndex!
                    .normalizationVersion,
            ).toBe(2);
        });

        test("incompatible retained embedding identity fails explicitly rather than rebuilding silently", async () => {
            const corpusId = await ingest();
            forbidden = true;
            const before = { extractionCalls, embeddingCalls };
            identityRevision = "incompatible";
            const preview = await service.previewForgetSource(
                corpusId,
                "private",
            );
            await expect(
                service.forgetSource({
                    corpusId,
                    sourceId: "private",
                    confirmationToken: preview.confirmationToken,
                }),
            ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
            await expect(
                service.getSource(corpusId, "retained"),
            ).rejects.toThrow("Authorized source removal");
            await service.close();
            identityRevision = "1";
            service = open();
            await service.initialize();
            await verify(corpusId);
            expect({ extractionCalls, embeddingCalls }).toEqual(before);
        });
    },
);
