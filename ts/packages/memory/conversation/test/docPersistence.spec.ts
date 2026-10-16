// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    ChatModel,
    EmbeddingIdentity,
    EmbeddingRole,
    TextEmbeddingModel,
    getRuntimeConfig,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import * as kp from "@typeagent/knowpro";
import * as kpLib from "@typeagent/knowledge-processor";
import { success } from "typechat";
import {
    DocMemory,
    DocMemorySettings,
    DocPart,
    DocPartMeta,
    createDocMemorySettings,
} from "../src/docMemory.js";
import { importDocMemoryFromTextFile } from "../src/docImport.js";
import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
} from "../src/conversationMemory.js";
import { EmailMemory } from "../src/emailMemory.js";
import { EmailMessage, EmailMeta } from "../src/emailMessage.js";
import { Podcast } from "../src/podcast.js";
import { PodcastMessage, PodcastMessageMeta } from "../src/podcastMessage.js";

describe("document embedding persistence (deterministic, offline)", () => {
    const root = path.resolve(`doc-persistence-${randomUUID()}`);
    let calls: string[];
    let extractionCalls: number;
    let networkCalls: number;
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env;
    let originalConfig: ReturnType<typeof getRuntimeConfig>;

    const languageModel: ChatModel = {
        completionSettings: {},
        async complete() {
            extractionCalls++;
            throw new Error("Hosted extraction/query translation is forbidden");
        },
    };

    beforeEach(async () => {
        calls = [];
        extractionCalls = 0;
        networkCalls = 0;
        originalConfig = getRuntimeConfig();
        process.env = {
            ...originalEnv,
            OPENAI_API_KEY: "synthetic-key-never-used",
            OPENAI_ENDPOINT_EMBEDDING: "https://hosted.invalid/embeddings",
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://azure.invalid/embeddings",
        };
        await fs.mkdir(root, { recursive: true });
        globalThis.fetch = async () => {
            networkCalls++;
            throw new Error("Network access is forbidden in document tests");
        };
    });

    afterEach(async () => {
        expect(extractionCalls).toBe(0);
        expect(networkCalls).toBe(0);
        globalThis.fetch = originalFetch;
        process.env = originalEnv;
        setRuntimeConfig(originalConfig);
        await fs.rm(root, { recursive: true, force: true });
    });

    function identity(
        role: EmbeddingRole,
        dimensions = 3,
        revision = "one",
    ): EmbeddingIdentity {
        return {
            schemaVersion: 1,
            provider: "offline-fixture",
            model: "document-fixture",
            revision,
            dimensions,
            task: role,
            prompt: role,
            pooling: "mean",
            normalization: "l2",
            preprocessing: "fixture-v1",
            artifactHash: "a".repeat(64),
        };
    }

    function embedder(
        dimensions = 3,
        revision = "one",
        known = true,
        role: EmbeddingRole = "document",
    ): TextEmbeddingModel {
        const embed = (text: string) => {
            calls.push(`${revision}:${role}:${text}`);
            const vector = Array<number>(dimensions).fill(0);
            vector[
                /ocean|marine/i.test(text)
                    ? 0
                    : /star|astronomy/i.test(text)
                      ? 1
                      : 2
            ] = 1;
            return vector;
        };
        return {
            maxBatchSize: 16,
            ...(known
                ? {
                      embeddingIdentity: identity(role, dimensions, revision),
                      forRole: (selected: EmbeddingRole) =>
                          embedder(dimensions, revision, known, selected),
                  }
                : {}),
            async generateEmbedding(text) {
                return success(embed(text));
            },
            async generateEmbeddingBatch(texts) {
                return success(texts.map(embed));
            },
        };
    }

    function settings(model = embedder(), dimensions = 3): DocMemorySettings {
        const cached = kpLib.createEmbeddingCache(model, 32);
        const conversationSettings = kp.createConversationSettings(
            cached,
            dimensions,
        );
        conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            false;
        return {
            languageModel,
            embeddingModel: cached,
            embeddingSize: dimensions,
            conversationSettings,
        };
    }

    function part(text: string, topic: string): DocPart {
        return new DocPart(
            text,
            new DocPartMeta("fixture:source"),
            [],
            undefined,
            {
                entities: [],
                topics: [topic],
                actions: [],
                inverseActions: [],
            },
        );
    }

    async function createSaved(): Promise<DocMemory> {
        const memory = new DocMemory(
            "fixture",
            [
                part("The ocean supports marine life", "marine"),
                part("Astronomy studies stars", "astronomy"),
            ],
            settings(),
        );
        const result = await memory.buildIndex();
        expect(result.secondaryIndexResults?.message?.error).toBeUndefined();
        expect(memory.semanticRefs.length).toBe(2);
        await memory.writeToFile(root, "doc");
        return memory;
    }

    async function matches(memory: DocMemory, text: string): Promise<number[]> {
        const result = await memory.searchByTextSimilarity(text, undefined, {
            thresholdScore: 0.7,
        });
        return (
            result?.messageMatches.map((match) => match.messageOrdinal) ?? []
        );
    }

    test("build, save, restart, search and append retain dimensions, identities and ordinals", async () => {
        await createSaved();
        const persisted = JSON.parse(
            await fs.readFile(path.join(root, "doc_data.json"), "utf8"),
        );
        expect(persisted.embeddingFileHeader.modelMetadata.embeddingSize).toBe(
            3,
        );
        expect(Object.keys(persisted.embeddingFileHeader.identities)).toEqual([
            "relatedTerms.query",
            "relatedTerms.document",
            "message.query",
            "message.document",
            "thread.query",
            "thread.document",
        ]);
        expect(
            persisted.embeddingFileHeader.identities["message.document"],
        ).toEqual(identity("document"));

        const memory = (await DocMemory.readFromFile(root, "doc", settings()))!;
        expect(memory.messages.get(0)).toBeInstanceOf(DocPart);
        expect(memory.messages.get(0).metadata).toBeInstanceOf(DocPartMeta);
        expect(memory.messages.get(0).getKnowledge()?.topics).toEqual([
            "marine",
        ]);
        expect(memory.indexingState.lastIndexed).toBeInstanceOf(Date);
        expect(await matches(memory, "marine")).toEqual([0]);
        expect(await memory.searchTopics("marine", 10, true)).toEqual([
            { text: "marine" },
        ]);

        memory.messages.append(
            new DocPart([], undefined, [], undefined, {
                entities: [],
                topics: [],
                actions: [],
                inverseActions: [],
            }),
        );
        memory.messages.append(part("More ocean marine life", "marine"));
        await memory.addToIndex();
        await memory.addDocPartToIndex(
            part("More astronomy stars", "astronomy"),
        );
        expect(await matches(memory, "marine")).toEqual([0, 3]);
        expect(await matches(memory, "astronomy")).toEqual([1, 4]);
        await memory.writeToFile(root, "doc");

        const restarted = (await DocMemory.readFromFile(
            root,
            "doc",
            settings(),
        ))!;
        expect(await matches(restarted, "marine")).toEqual([0, 3]);
        expect(await matches(restarted, "astronomy")).toEqual([1, 4]);
        expect(restarted.indexingState.lastMessageOrdinal).toBe(4);
        expect(calls.some((call) => call.includes(":query:marine"))).toBe(true);
        expect(calls.some((call) => call.includes(":document:"))).toBe(true);
    });

    test.each([
        { dimensions: 4, revision: "one" },
        { dimensions: 3, revision: "different-model-space" },
    ])(
        "rejects incompatible space %j without altering source or files",
        async ({ dimensions, revision }) => {
            const original = await createSaved();
            const bytes = await fs.readFile(path.join(root, "doc_data.json"));
            try {
                await DocMemory.readFromFile(
                    root,
                    "doc",
                    settings(embedder(dimensions, revision), dimensions),
                );
                throw new Error("Expected incompatible identity");
            } catch (error) {
                expect(error).toBeInstanceOf(
                    kp.PersistedEmbeddingIdentityError,
                );
                const failure = error as kp.PersistedEmbeddingIdentityError;
                expect(failure.message).toMatch(/rebuildEmbeddings/);
                expect(failure.conversationData.messages).toHaveLength(2);
                expect(failure.conversationData.semanticRefs).toEqual(
                    original.semanticRefs.getAll(),
                );
                expect(
                    failure.conversationData.messageIndexData?.indexData,
                ).toBeUndefined();
                expect(
                    failure.conversationData.relatedTermsIndexData
                        ?.textEmbeddingData,
                ).toBeUndefined();
            }
            expect(await fs.readFile(path.join(root, "doc_data.json"))).toEqual(
                bytes,
            );
        },
    );

    test("unknown legacy vectors fail closed; explicit full rebuild keeps structured knowledge and bypasses extraction", async () => {
        const original = await createSaved();
        const filePath = path.join(root, "doc_data.json");
        const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
        delete persisted.embeddingFileHeader.identities;
        delete persisted.embeddingIdentities;
        await fs.writeFile(filePath, JSON.stringify(persisted));
        await expect(
            DocMemory.readFromFile(root, "doc", settings()),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);

        const newSettings = settings(embedder(4, "new"), 4);
        newSettings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            true;
        const rebuilt = (await DocMemory.readFromFile(
            root,
            "doc",
            newSettings,
            { rebuildEmbeddings: true },
        ))!;
        expect(rebuilt.semanticRefs.getAll()).toEqual(
            original.semanticRefs.getAll(),
        );
        expect(rebuilt.messages.get(0).textChunks).toEqual(
            original.messages.get(0).textChunks,
        );
        expect(await matches(rebuilt, "marine")).toEqual([0]);
        expect(
            (await rebuilt.serialize()).messageIndexData?.indexData
                ?.embeddings[0],
        ).toHaveLength(4);
        await rebuilt.writeToFile(root, "doc");
        const restarted = (await DocMemory.readFromFile(
            root,
            "doc",
            settings(embedder(4, "new"), 4),
        ))!;
        expect(await matches(restarted, "astronomy")).toEqual([1]);
        expect(restarted.semanticRefs.getAll()).toEqual(
            original.semanticRefs.getAll(),
        );
    });

    test("explicit rebuild migrates same-size incompatible identities, not just dimensions", async () => {
        const original = await createSaved();
        const rebuilt = (await DocMemory.readFromFile(
            root,
            "doc",
            settings(embedder(3, "new")),
            { rebuildEmbeddings: true },
        ))!;
        expect(rebuilt.semanticRefs.getAll()).toEqual(
            original.semanticRefs.getAll(),
        );
        expect(await matches(rebuilt, "marine")).toEqual([0]);
        await rebuilt.writeToFile(root, "doc");
        await expect(
            DocMemory.readFromFile(root, "doc", settings()),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
        expect(
            await DocMemory.readFromFile(
                root,
                "doc",
                settings(embedder(3, "new")),
            ),
        ).toBeDefined();
    });

    test("identity-less injected models work for fresh indexes but are never falsely attested on save/reload", async () => {
        const memory = new DocMemory(
            "unknown",
            [part("ocean marine", "marine")],
            settings(embedder(3, "unknown", false)),
        );
        await memory.buildIndex();
        expect(await matches(memory, "marine")).toEqual([0]);
        await memory.writeToFile(root, "unknown");
        const persisted = JSON.parse(
            await fs.readFile(path.join(root, "unknown_data.json"), "utf8"),
        );
        expect(persisted.embeddingFileHeader.identities).toBeUndefined();
        expect(persisted.embeddingIdentities).toBeUndefined();
        await expect(
            DocMemory.readFromFile(
                root,
                "unknown",
                settings(embedder(3, "unknown", false)),
            ),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
        const rebuilt = (await DocMemory.readFromFile(
            root,
            "unknown",
            settings(),
            { rebuildEmbeddings: true },
        ))!;
        await rebuilt.writeToFile(root, "unknown");
        expect(
            await DocMemory.readFromFile(root, "unknown", settings()),
        ).toBeDefined();
    });

    test("lazy resolution happens before settings/index use and save captures resolved identities", async () => {
        let resolved = false;
        const lazy: TextEmbeddingModel = {
            maxBatchSize: 16,
            async resolve() {
                resolved = true;
                return embedder(4, "resolved");
            },
            async generateEmbedding() {
                throw new Error("Unresolved model cannot generate");
            },
        };
        const memory = new DocMemory(
            "lazy",
            [part("ocean marine", "marine")],
            settings(lazy, 768),
        );
        expect(resolved).toBe(false);
        const result = await memory.buildIndex();
        expect(
            result.secondaryIndexResults?.relatedTerms?.error,
        ).toBeUndefined();
        expect(result.secondaryIndexResults?.message?.error).toBeUndefined();
        expect(resolved).toBe(true);
        expect(memory.settings.embeddingSize).toBe(4);
        await memory.writeToFile(root, "lazy");
        const restarted = (await DocMemory.readFromFile(
            root,
            "lazy",
            settings(embedder(4, "resolved"), 768),
        ))!;
        expect(restarted.settings.embeddingSize).toBe(4);
        expect(await matches(restarted, "marine")).toEqual([0]);
    });

    test("same-size replacement of an unknown live model cannot silently mix vector spaces", async () => {
        const memory = new DocMemory(
            "unknown",
            [part("ocean marine", "marine")],
            settings(embedder(3, "unknown", false)),
        );
        await memory.buildIndex();
        const config = memory.settings.conversationSettings;
        const different = embedder(3, "different", false);
        config.messageTextIndexSettings.embeddingIndexSettings.embeddingModel =
            different;
        config.relatedTermIndexSettings.embeddingIndexSettings!.embeddingModel =
            different;
        config.threadSettings.embeddingModel = different;
        await expect(
            memory.addDocPartToIndex(part("new ocean", "marine")),
        ).rejects.toThrow(/Rebuild all embeddings/);
        expect(memory.messages.length).toBe(1);
        await memory.rebuildEmbeddings();
        expect(await matches(memory, "marine")).toEqual([0]);
    });

    test("direct serialized blobs validate identities before mutating target memory", async () => {
        const original = await createSaved();
        const blob = await original.serialize();
        const target = new DocMemory(
            "untouched",
            [],
            settings(embedder(3, "new")),
        );
        await expect(target.deserialize(blob)).rejects.toThrow(
            kp.PersistedEmbeddingIdentityError,
        );
        expect(target.nameTag).toBe("untouched");
        expect(target.messages.length).toBe(0);
        expect(blob.messageIndexData?.indexData?.embeddings).toHaveLength(2);
        const compatible = new DocMemory("", [], settings());
        await compatible.deserialize(blob);
        expect(await matches(compatible, "marine")).toEqual([0]);
    });

    test("changed live model requires full rebuild; failed rebuild remains closed until retried", async () => {
        const memory = await createSaved();
        const replacement = embedder(4, "new");
        const config = memory.settings.conversationSettings;
        config.messageTextIndexSettings.embeddingIndexSettings.embeddingModel =
            replacement;
        config.relatedTermIndexSettings.embeddingIndexSettings!.embeddingModel =
            replacement;
        config.threadSettings.embeddingModel = replacement;
        await expect(memory.searchByTextSimilarity("marine")).rejects.toThrow(
            /Rebuild all embeddings/,
        );
        await expect(memory.writeToFile(root, "doc")).rejects.toThrow(
            /Rebuild all embeddings/,
        );
        const validBatch = replacement.generateEmbeddingBatch!;
        replacement.generateEmbeddingBatch = async () => {
            throw new Error("Fixture embedding failure");
        };
        replacement.forRole = () => replacement;
        await expect(memory.rebuildEmbeddings()).rejects.toThrow();
        await expect(memory.searchByTextSimilarity("marine")).rejects.toThrow(
            /rebuild is incomplete/,
        );
        replacement.generateEmbeddingBatch = validBatch;
        replacement.forRole = (role) => embedder(4, "new", true, role);
        await memory.rebuildEmbeddings();
        expect(await matches(memory, "marine")).toEqual([0]);
        expect(memory.semanticRefs.length).toBe(2);
    });

    test("file import and instance import preserve injected settings, name and source URL", async () => {
        const sourcePath = path.join(root, "source.md");
        await fs.writeFile(
            sourcePath,
            "# Marine\n\nThe ocean supports marine life.",
        );
        const injected = settings();
        const imported = await importDocMemoryFromTextFile(
            sourcePath,
            1024,
            "named",
            injected,
        );
        expect(imported.settings).toBe(injected);
        expect(imported.nameTag).toBe("named");
        expect(imported.messages.get(0).metadata.sourceUrl).toMatch(/^file:/);
        await imported.buildIndex();
        await imported.writeToFile(root, "import");
        const host = new DocMemory("host", [], injected);
        const instanceImport = await host.importFromTextFile(
            sourcePath,
            1024,
            "instance",
        );
        expect(instanceImport.settings).toBe(injected);
        expect(instanceImport.nameTag).toBe("instance");
        await instanceImport.buildIndex();
        expect(await matches(instanceImport, "marine")).toContain(0);
    });

    test("missing documents return undefined instead of a fresh empty memory", async () => {
        expect(
            await DocMemory.readFromFile(root, "missing", settings()),
        ).toBeUndefined();
    });

    test("configured none with hosted credentials rejects old vectors instead of silently falling back", async () => {
        await createSaved();
        setRuntimeConfig({
            ...originalConfig,
            embedding: { provider: "none" },
        });
        const disabled = createDocMemorySettings(32, undefined, languageModel);
        expect(disabled.embeddingModel).toBeUndefined();
        await expect(
            DocMemory.readFromFile(root, "doc", disabled),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
    });

    test.each([
        { runtime: "minilm" as const, dimensions: 384 },
        { runtime: "embeddinggemma" as const, dimensions: 768 },
    ])(
        "configured $runtime ordinary settings/import/save/restart use $dimensions dimensions without hosted fallback",
        async ({ runtime, dimensions }) => {
            setRuntimeConfig({
                ...originalConfig,
                embedding: {
                    provider: "local",
                    runtime,
                    modalities: ["text"],
                },
            });
            const configuredSettings = () => {
                const configured = createDocMemorySettings(
                    32,
                    undefined,
                    languageModel,
                );
                expect(configured.embeddingSize).toBe(dimensions);
                expect(
                    configured.conversationSettings.messageTextIndexSettings
                        .embeddingIndexSettings.embeddingSize,
                ).toBe(dimensions);
                // Inject the runtime only; retain ordinary configured settings
                // and dimensions without loading or calling real providers.
                const fake = kpLib.createEmbeddingCache(
                    embedder(dimensions, runtime),
                    32,
                );
                configured.embeddingModel = fake;
                const indexSettings = configured.conversationSettings;
                indexSettings.messageTextIndexSettings.embeddingIndexSettings.embeddingModel =
                    fake;
                indexSettings.relatedTermIndexSettings.embeddingIndexSettings!.embeddingModel =
                    fake;
                indexSettings.threadSettings.embeddingModel = fake;
                indexSettings.semanticRefIndexSettings.autoExtractKnowledge =
                    false;
                return configured;
            };
            const sourcePath = path.join(root, "configured.md");
            await fs.writeFile(
                sourcePath,
                "# Marine\n\nThe ocean has marine life.",
            );
            const memory = await importDocMemoryFromTextFile(
                sourcePath,
                1024,
                runtime,
                configuredSettings(),
            );
            await memory.buildIndex();
            await memory.writeToFile(root, "configured");
            const restarted = (await DocMemory.readFromFile(
                root,
                "configured",
                configuredSettings(),
            ))!;
            expect(restarted.settings.embeddingSize).toBe(dimensions);
            expect(await matches(restarted, "marine")).toContain(0);
            expect(
                (await restarted.serialize()).messageIndexData?.indexData
                    ?.embeddings[0],
            ).toHaveLength(dimensions);
        },
    );

    test("conversation, email and podcast file paths share identity persistence and awaited reload", async () => {
        const conversation = new ConversationMemory("chat", [], [], settings());
        await conversation.addMessage(
            new ConversationMessage(
                "ocean marine",
                new ConversationMessageMeta("speaker"),
                [],
                {
                    entities: [],
                    topics: ["marine"],
                    actions: [],
                    inverseActions: [],
                },
            ),
            false,
            true,
        );
        await conversation.writeToFile(root, "chat");
        const chat = (await ConversationMemory.readFromFile(
            root,
            "chat",
            settings(),
        ))!;
        expect(
            (await chat.searchByTextSimilarity("marine"))?.messageMatches[0]
                .messageOrdinal,
        ).toBe(0);
        await expect(
            ConversationMemory.readFromFile(
                root,
                "chat",
                settings(embedder(3, "new")),
            ),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);

        const email = new EmailMemory(
            new kp.MemoryStorageProvider(),
            settings(),
        );
        await email.addMessages(
            new EmailMessage(
                new EmailMeta({ address: "fixture@example.test" }),
                "ocean marine",
            ),
            false,
        );
        await email.buildIndex(undefined, false);
        const fileSettings = { dirPath: root, baseFileName: "email" };
        await email.writeToFile(fileSettings);
        const emailLoaded = (await EmailMemory.readFromFile(
            fileSettings,
            false,
            settings(),
        ))!;
        expect(
            (await emailLoaded.searchByTextSimilarity("marine"))
                ?.messageMatches[0].messageOrdinal,
        ).toBe(0);
        email.close();
        emailLoaded.close();
        await expect(
            EmailMemory.readFromFile(
                fileSettings,
                false,
                settings(embedder(3, "new")),
            ),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);

        const podcast = new Podcast(
            "podcast",
            [
                new PodcastMessage(
                    ["ocean marine"],
                    new PodcastMessageMeta("speaker"),
                ),
            ],
            [],
            settings().conversationSettings,
        );
        await podcast.buildIndex();
        await podcast.writeToFile(root, "podcast");
        const podcastLoaded = (await Podcast.readFromFile(
            root,
            "podcast",
            settings().conversationSettings,
        ))!;
        expect(
            (
                await kp.searchConversationByTextSimilarity(
                    podcastLoaded,
                    "marine",
                )
            )?.messageMatches[0].messageOrdinal,
        ).toBe(0);
        await expect(
            Podcast.readFromFile(
                root,
                "podcast",
                settings(embedder(3, "new")).conversationSettings,
            ),
        ).rejects.toThrow(kp.PersistedEmbeddingIdentityError);
    });
});
