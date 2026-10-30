// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    DocPart,
    DocPartMeta,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import type { EmbeddingRole, TextEmbeddingModel } from "@typeagent/aiclient";
import * as kp from "@typeagent/knowpro";
import { createEmbeddingCache } from "@typeagent/knowledge-processor";
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareEmbeddingIndexMigration } from "../src/embeddingMigration.js";
import { stampIndexSchema, type IndexKind } from "../src/indexSchema.js";

describe("controlled embedding migration (offline)", () => {
    let root: string;
    let source: string;
    let output: string;
    let embeddingCalls: number;

    function settings(modelName: string, fail = false): DocMemorySettings {
        function model(role: EmbeddingRole = "document"): TextEmbeddingModel {
            const embed = () => {
                embeddingCalls++;
                if (fail) throw new Error("Controlled embedding failure");
                return modelName === "ada" ? [1, 0, 0] : [0, 1, 0];
            };
            return {
                maxBatchSize: 16,
                embeddingIdentity: {
                    schemaVersion: 1,
                    provider: "offline",
                    model: modelName,
                    revision: "1",
                    dimensions: 3,
                    task: role,
                    prompt: role,
                    pooling: "mean",
                    normalization: "l2",
                    preprocessing: "fixture",
                    artifactHash:
                        modelName === "ada" ? "a".repeat(64) : "b".repeat(64),
                },
                forRole: model,
                generateEmbedding: async () => ({
                    success: true,
                    data: embed(),
                }),
                generateEmbeddingBatch: async (texts) => ({
                    success: true,
                    data: texts.map(embed),
                }),
            };
        }
        const embeddingModel = createEmbeddingCache(model(), 16);
        const conversationSettings = kp.createConversationSettings(
            embeddingModel,
            3,
        );
        conversationSettings.semanticRefIndexSettings.knowledgeExtractor = {
            settings: { maxContextLength: 10000 },
            extract: async () => {
                throw new Error("Knowledge extraction must not run");
            },
            extractWithRetry: async () => {
                throw new Error("Knowledge extraction must not run");
            },
        };
        return {
            embeddingModel,
            embeddingSize: 3,
            conversationSettings,
            languageModel: {
                completionSettings: {},
                complete: async () => {
                    throw new Error("Knowledge extraction must not run");
                },
            },
        };
    }

    async function save(
        kind: IndexKind,
        segmented = false,
    ): Promise<DocMemory> {
        const originalSettings = settings("ada");
        originalSettings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            false;
        const memory = new DocMemory(
            "fixture",
            [
                new DocPart(
                    "Marine life",
                    new DocPartMeta("fixture:source"),
                    [],
                    undefined,
                    {
                        entities: [],
                        topics: ["ocean"],
                        actions: [],
                        inverseActions: [],
                    },
                ),
            ],
            originalSettings,
        );
        await memory.buildIndex();
        await mkdir(source);
        await memory.writeToFile(source, "corpus", segmented);
        await stampIndexSchema(source, kind, true);
        await writeFile(path.join(source, "ready"), "sidecar-preserved");
        return memory;
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "embedding-migration-"));
        source = path.join(root, "original");
        output = path.join(root, "prepared");
        embeddingCalls = 0;
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test.each<IndexKind>(["documents", "conversation-events", "views"])(
        "prepares %s with a same-size new model and retains the original",
        async (kind) => {
            const original = await save(kind);
            const before = await readFile(
                path.join(source, "corpus_data.json"),
            );
            const vectors = await readFile(
                path.join(source, "corpus_embeddings.bin"),
            );
            await expect(
                DocMemory.readFromFile(source, "corpus", settings("large")),
            ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
            const calls = embeddingCalls;
            const result = await prepareEmbeddingIndexMigration(
                source,
                output,
                settings("large"),
            );
            expect(result).toMatchObject({
                indexKind: kind,
                messageCount: 1,
                semanticRefCount: 1,
            });
            expect(embeddingCalls).toBeGreaterThan(calls);
            expect(
                await readFile(path.join(source, "corpus_data.json")),
            ).toEqual(before);
            expect(
                await readFile(path.join(source, "corpus_embeddings.bin")),
            ).toEqual(vectors);
            expect(await readFile(path.join(output, "ready"), "utf8")).toBe(
                "sidecar-preserved",
            );
            const migrated = (await DocMemory.readFromFile(
                output,
                "corpus",
                settings("large"),
            ))!;
            expect(migrated.semanticRefs.getAll()).toEqual(
                original.semanticRefs.getAll(),
            );
            expect(migrated.messages.get(0).textChunks).toEqual(
                original.messages.get(0).textChunks,
            );
            expect(
                (
                    await migrated.searchByTextSimilarity("ocean", undefined, {
                        thresholdScore: 0.8,
                    })
                )?.messageMatches.map((match) => match.messageOrdinal),
            ).toEqual([0]);
            await expect(
                DocMemory.readFromFile(output, "corpus", settings("ada")),
            ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
        },
    );

    test("preserves segmented persistence and verifies a restart", async () => {
        await save("documents", true);
        await prepareEmbeddingIndexMigration(source, output, settings("large"));
        expect(
            kp.isSegmentedJson(
                JSON.parse(
                    await readFile(
                        path.join(output, "corpus_data.json"),
                        "utf8",
                    ),
                ),
            ),
        ).toBe(true);
        expect(
            await DocMemory.readFromFile(output, "corpus", settings("large")),
        ).toBeDefined();
    });

    test("failed embedding generation leaves the original intact and removes only its new copy", async () => {
        await save("documents");
        const before = await readFile(path.join(source, "corpus_data.json"));
        await expect(
            prepareEmbeddingIndexMigration(
                source,
                output,
                settings("large", true),
            ),
        ).rejects.toThrow("Controlled embedding failure");
        expect(await readFile(path.join(source, "corpus_data.json"))).toEqual(
            before,
        );
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
        expect(
            await DocMemory.readFromFile(source, "corpus", settings("ada")),
        ).toBeDefined();
    });

    test("refuses existing or nested destinations without changing them", async () => {
        await save("documents");
        await mkdir(output);
        await writeFile(path.join(output, "keep"), "untouched");
        await expect(
            prepareEmbeddingIndexMigration(source, output, settings("large")),
        ).rejects.toMatchObject({ code: "EEXIST" });
        expect(await readFile(path.join(output, "keep"), "utf8")).toBe(
            "untouched",
        );
        await expect(
            prepareEmbeddingIndexMigration(
                source,
                path.join(source, "nested"),
                settings("large"),
            ),
        ).rejects.toThrow("outside the source");
    });
});
