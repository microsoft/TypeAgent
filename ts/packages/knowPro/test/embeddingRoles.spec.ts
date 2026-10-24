// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    EmbeddingIdentity,
    EmbeddingRole,
    TextEmbeddingModel,
} from "@typeagent/aiclient";
import { embeddingCacheKey } from "@typeagent/knowledge-processor";
import { success } from "typechat";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { createConversationSettings } from "../src/conversation.js";
import { ConversationThreads } from "../src/conversationThread.js";
import {
    createTextEmbeddingIndexSettings,
    TextEmbeddingIndex,
    generateTextEmbeddingsForIndex,
    EmbeddingIndex,
    indexesOfNearestTextBatchInIndex,
} from "../src/fuzzyIndex.js";
import { withQueryEmbeddingCache } from "../src/queryEmbeddingCache.js";
import { buildMessageIndex, MessageTextIndex } from "../src/messageIndex.js";
import { TermEmbeddingIndex } from "../src/relatedTermsIndex.js";
import { TextToTextLocationIndex } from "../src/textLocationIndex.js";
import { searchConversationByTextSimilarity } from "../src/search.js";
import { IConversation, TextRange } from "../src/interfaces.js";
import { createTestMessages } from "./testMessage.js";
import { SemanticRefCollection } from "../src/storage.js";
import {
    addKnowledgeToSemanticRefIndex,
    TermToSemanticRefIndex,
} from "../src/conversationIndex.js";

describe("KnowPro embedding roles (synthetic/offline)", () => {
    let calls: string[];
    const identity = (role: EmbeddingRole): EmbeddingIdentity => ({
        schemaVersion: 1,
        provider: "local",
        model: "synthetic",
        revision: "pinned",
        dimensions: 2,
        task: role,
        prompt: role,
        pooling: "mean",
        normalization: "l2",
        preprocessing: "text",
        artifactHash: "a".repeat(64),
    });
    function model(role: EmbeddingRole = "document"): TextEmbeddingModel {
        return {
            maxBatchSize: 8,
            embeddingIdentity: identity(role),
            forRole: model,
            async generateEmbedding(text) {
                calls.push(`${role}:${text}`);
                return success([1, 0]);
            },
            async generateEmbeddingBatch(texts) {
                calls.push(`${role}:${texts.join(",")}`);
                return success(texts.map(() => [1, 0]));
            },
        };
    }
    function wideModel(role: EmbeddingRole = "document"): TextEmbeddingModel {
        return {
            ...model(role),
            maxBatchSize: 2048,
            forRole: wideModel,
        };
    }
    beforeEach(() => {
        calls = [];
    });

    test("language-query scope reuses message and term embeddings without caching document work", async () => {
        const shared = model();
        const messages = new MessageTextIndex({
            embeddingIndexSettings: createTextEmbeddingIndexSettings(shared, 2),
        });
        await withQueryEmbeddingCache(async () => {
            await messages.generateEmbedding("shared");
            await indexesOfNearestTextBatchInIndex(
                new EmbeddingIndex(),
                shared,
                ["shared", "alias", "shared"],
            );
            await messages.generateEmbedding("shared");
            await generateTextEmbeddingsForIndex(shared, "shared");
            await generateTextEmbeddingsForIndex(shared, "shared");
        });
        expect(calls).toEqual([
            "query:shared",
            "query:alias",
            "document:shared",
            "document:shared",
        ]);
    });

    test("indexing rejects oversized inputs before invoking any embedding model", async () => {
        const exact = " word".repeat(8_000);
        const result = await generateTextEmbeddingsForIndex(model(), [
            "short",
            exact + " word",
        ]);
        expect(result).toEqual({
            success: false,
            message:
                "Embedding input[1] has 8001 tokens; maximum is 8000 (cl100k_base)",
        });
        expect(calls).toEqual([]);
        const accepted = await generateTextEmbeddingsForIndex(model(), exact);
        expect(accepted.success).toBe(true);
        expect(calls).toEqual([`document:${exact}`]);
    });

    test("conversation derives resolved identity dimensions without default switch", () => {
        expect(
            createConversationSettings(model()).messageTextIndexSettings
                .embeddingIndexSettings.embeddingSize,
        ).toBe(2);
        expect(
            createConversationSettings(model(), 7).threadSettings.embeddingSize,
        ).toBe(7);
    });

    test("indexing bounds aggregate tokens without truncating or reordering inputs", async () => {
        const texts = [
            " word".repeat(4_000),
            " word".repeat(4_000),
            " word",
            " word".repeat(8_000),
        ];
        const embeddingModel: TextEmbeddingModel = {
            ...wideModel(),
            forRole: () => embeddingModel,
            embeddingIdentity: { ...identity("document"), provider: "azure" },
        };
        const result = await generateTextEmbeddingsForIndex(
            embeddingModel,
            texts,
        );
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toHaveLength(texts.length);
        expect(calls).toEqual([
            `document:${texts.slice(0, 2).join(",")}`,
            `document:${texts[2]}`,
            `document:${texts[3]}`,
        ]);
    });

    test("conversation defaults to 128 terms, source texts, and threads", () => {
        const settings = createConversationSettings(model());
        expect(
            settings.relatedTermIndexSettings.embeddingIndexSettings?.batchSize,
        ).toBe(128);
        expect(
            settings.messageTextIndexSettings.embeddingIndexSettings.batchSize,
        ).toBe(128);
        expect(settings.threadSettings.batchSize).toBe(128);
    });

    test("a malformed hosted subbatch stops before requesting later inputs", async () => {
        let requests = 0;
        const embeddingModel: TextEmbeddingModel = {
            ...wideModel(),
            forRole: () => embeddingModel,
            embeddingIdentity: { ...identity("document"), provider: "azure" },
            async generateEmbeddingBatch() {
                requests++;
                return success([]);
            },
        };
        const result = await generateTextEmbeddingsForIndex(embeddingModel, [
            " word".repeat(8_000),
            "later input",
        ]);
        expect(result).toEqual({
            success: false,
            message:
                "generateTextEmbeddingsForIndex failed: Error: Embedding batch cardinality mismatch",
        });
        expect(requests).toBe(1);
    });

    test("default term lane batches 129 distinct terms as 128 and one and reuses them after reload", async () => {
        const settings =
            createConversationSettings(wideModel()).relatedTermIndexSettings
                .embeddingIndexSettings;
        assert.ok(settings);
        const terms = Array.from(
            { length: 129 },
            (_, index) => `term-${index}`,
        );
        const index = new TermEmbeddingIndex(settings);
        expect(
            (await index.addTerms([...terms, terms[0]])).numberCompleted,
        ).toBe(130);
        expect(calls).toEqual([
            `document:${terms.slice(0, 128).join(",")}`,
            "document:term-128",
        ]);
        const restored = new TermEmbeddingIndex(settings, index.serialize());
        await restored.addTerms([terms[0], terms[128], terms[0]]);
        expect(calls).toHaveLength(2);
    });

    test("default 128-term lane still honors a smaller provider request limit", async () => {
        const settings =
            createConversationSettings(model()).relatedTermIndexSettings
                .embeddingIndexSettings;
        assert.ok(settings);
        const index = new TermEmbeddingIndex(settings);
        const terms = Array.from({ length: 17 }, (_, index) => `term-${index}`);
        expect((await index.addTerms(terms)).numberCompleted).toBe(17);
        expect(calls).toEqual([
            `document:${terms.slice(0, 8).join(",")}`,
            `document:${terms.slice(8, 16).join(",")}`,
            "document:term-16",
        ]);
    });

    test("message rebuild uses the configured default and preserves explicit outer batch overrides", async () => {
        const settings = createConversationSettings(wideModel());
        const conversation: IConversation = {
            nameTag: "batching",
            tags: [],
            messages: createTestMessages(129),
            semanticRefs: undefined,
            semanticRefIndex: undefined,
            secondaryIndexes: {},
        };
        const texts = Array.from(
            { length: 129 },
            (_, index) => conversation.messages.get(index).textChunks[0],
        );
        const result = await buildMessageIndex(
            conversation,
            settings.messageTextIndexSettings,
        );
        expect(result).toEqual({ numberCompleted: 129, error: undefined });
        expect(calls).toEqual([
            `document:${texts.slice(0, 128).join(",")}`,
            `document:${texts[128]}`,
        ]);
        calls = [];
        conversation.secondaryIndexes = {};
        await buildMessageIndex(
            conversation,
            settings.messageTextIndexSettings,
            undefined,
            32,
        );
        expect(calls).toEqual(
            [0, 32, 64, 96, 128].map(
                (start) =>
                    `document:${texts.slice(start, start + 32).join(",")}`,
            ),
        );
    });

    test("thread rebuild batches 128 descriptions while incremental additions remain immediate", async () => {
        const settings = createConversationSettings(wideModel());
        const index = new ConversationThreads(settings.threadSettings);
        index.threads = Array.from({ length: 129 }, (_, thread) => ({
            description: `thread-${thread}`,
            ranges: [],
        }));
        await index.buildIndex();
        expect(calls).toEqual([
            `document:${index.threads
                .slice(0, 128)
                .map((thread) => thread.description)
                .join(",")}`,
            "document:thread-128",
        ]);
        expect(index.serialize().threads?.map((data) => data.thread)).toEqual(
            index.threads,
        );
        await index.addThread({ description: "new-thread", ranges: [] });
        expect(calls.at(-1)).toBe("document:new-thread");
        expect(index.embeddingIndex.size).toBe(130);
    });

    test("thread rebuild surfaces a failed batch instead of reporting success", async () => {
        const embeddingModel: TextEmbeddingModel = {
            ...wideModel(),
            forRole: () => embeddingModel,
            async generateEmbeddingBatch() {
                return success([]);
            },
        };
        const index = new ConversationThreads(
            createTextEmbeddingIndexSettings(embeddingModel, 2),
        );
        index.threads = [{ description: "thread", ranges: [] }];
        await expect(index.buildIndex()).rejects.toThrow(
            /cardinality|expected.*1|returned.*0/i,
        );
        expect(index.embeddingIndex.size).toBe(0);
    });

    test.each<[number, number]>([
        [40, 7500],
        [41, 7500],
        [128, 4096],
    ])(
        "hosted batching keeps %i texts of %i tokens within the 8,000-token aggregate work budget",
        async (inputCount, tokensPerInput) => {
            const expectedBatches = Array<number>(inputCount).fill(1);
            const text = " word".repeat(tokensPerInput);
            expect(countTokens(text)).toBe(tokensPerInput);
            const requests: string[][] = [];
            const embeddingModel: TextEmbeddingModel = {
                ...wideModel(),
                forRole: () => embeddingModel,
                embeddingIdentity: {
                    ...identity("document"),
                    provider: "azure",
                },
                async generateEmbeddingBatch(texts) {
                    requests.push(texts);
                    return success(texts.map(() => [1, 0]));
                },
            };
            const index = new TextEmbeddingIndex(
                createTextEmbeddingIndexSettings(embeddingModel, 2),
            );
            const texts = Array<string>(inputCount).fill(text);
            const starts: number[] = [];
            const result = await index.addTextBatch(texts, {
                onEmbeddingsCreated(_source, _batch, startAt) {
                    starts.push(startAt);
                    return true;
                },
            });
            expect(result).toEqual({ numberCompleted: inputCount });
            expect(requests.map((batch) => batch.length)).toEqual(
                expectedBatches,
            );
            expect(requests.flat()).toEqual(texts);
            expect(starts).toEqual(
                expectedBatches.map((_, index) =>
                    expectedBatches
                        .slice(0, index)
                        .reduce((sum, size) => sum + size, 0),
                ),
            );
            expect(index.size).toBe(inputCount);
        },
    );

    test("hosted batches count special-token-looking text as ordinary source text", async () => {
        const embeddingModel: TextEmbeddingModel = {
            ...wideModel(),
            forRole: () => embeddingModel,
            embeddingIdentity: { ...identity("document"), provider: "azure" },
        };
        const index = new TextEmbeddingIndex(
            createTextEmbeddingIndexSettings(embeddingModel, 2),
        );
        expect(
            (await index.addTextBatch(["<|endoftext|>", "<|fim_prefix|>"]))
                .numberCompleted,
        ).toBe(2);
        expect(calls).toEqual(["document:<|endoftext|>,<|fim_prefix|>"]);
    });

    test("text indexes index documents and look up query roles in single and batch searches", async () => {
        const index = new TextEmbeddingIndex(
            createTextEmbeddingIndexSettings(model(), 2),
        );
        expect((await index.addText(["one", "two"])).numberCompleted).toBe(2);
        expect(await index.getIndexesOfNearest("search")).toHaveLength(2);
        expect(
            await index.getIndexesOfNearestMultiple(["a", "b"]),
        ).toHaveLength(2);
        expect(calls).toEqual([
            "document:one,two",
            "query:search",
            "query:a,b",
        ]);
    });

    test("direct text-location paths select document/query roles including subset lookup", async () => {
        const index = new TextToTextLocationIndex(
            createTextEmbeddingIndexSettings(model(), 2),
        );
        await index.addTextLocation("one", {
            messageOrdinal: 0,
            chunkOrdinal: 0,
        });
        await index.addTextLocations([
            ["two", { messageOrdinal: 1, chunkOrdinal: 0 }],
        ]);
        expect(await index.lookupText("search")).toHaveLength(2);
        expect(await index.lookupTextInSubset("subset", [1])).toHaveLength(1);
        expect(calls).toEqual([
            "document:one",
            "document:two",
            "query:search",
            "query:subset",
        ]);
    });

    test("message query embedding explicitly selects query role", async () => {
        const index = new MessageTextIndex({
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                model(),
                2,
            ),
        });
        expect(Array.from(await index.generateEmbedding("search"))).toEqual([
            1, 0,
        ]);
        expect(calls).toEqual(["query:search"]);
    });

    test("revision eligibility scopes vector candidates before TopN and intersects caller filters", async () => {
        const index = new MessageTextIndex({
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                model(),
                2,
            ),
        });
        index.deserialize({
            messageCount: 4,
            indexData: {
                embeddings: [
                    [1, 0],
                    [0.8, 0.6],
                    [1, 0],
                    [0.6, 0.8],
                ].map((vector) => new Float32Array(vector)),
                textLocations: [0, 1, 2, 3].map((messageOrdinal) => ({
                    messageOrdinal,
                    chunkOrdinal: 0,
                })),
            },
        });
        const conversation: IConversation = {
            nameTag: "eligibility",
            tags: [],
            messages: createTestMessages(4),
            semanticRefs: new SemanticRefCollection(),
            semanticRefIndex: new TermToSemanticRefIndex(),
            secondaryIndexes: { messageIndex: index },
        };
        const range = (messageOrdinal: number): TextRange => ({
            start: { messageOrdinal, chunkOrdinal: 0 },
            end: { messageOrdinal: messageOrdinal + 1, chunkOrdinal: 0 },
        });
        const ranges = [range(1), range(3)];
        const expected = index
            .lookupByEmbedding(new Float32Array([1, 0]), undefined, 0)
            .filter((match) => match.messageOrdinal % 2 === 1);
        for (const limit of [1, 2, 10]) {
            const result = await searchConversationByTextSimilarity(
                conversation,
                "query",
                undefined,
                {
                    messageRangesInScope: ranges,
                    maxMessageMatches: limit,
                    thresholdScore: 0,
                },
            );
            expect(result?.messageMatches).toEqual(expected.slice(0, limit));
        }
        const scoped = await searchConversationByTextSimilarity(
            conversation,
            "query",
            {
                textRangesInScope: [range(3)],
            },
            {
                messageRangesInScope: ranges,
                maxMessageMatches: 1,
                thresholdScore: 0,
            },
        );
        expect(scoped?.messageMatches).toEqual(
            expected.filter((match) => match.messageOrdinal === 3),
        );
        const empty = await searchConversationByTextSimilarity(
            conversation,
            "query",
            undefined,
            {
                messageRangesInScope: [],
                maxMessageMatches: 1,
                thresholdScore: 0,
            },
        );
        expect(empty?.messageMatches).toEqual([]);
    });

    test("related terms use symmetric documents and never answer query-role cache keys", async () => {
        const index = new TermEmbeddingIndex(
            createTextEmbeddingIndexSettings(model(), 2),
        );
        await index.addTerms(["term"]);
        expect(await index.lookupTerm("near")).toHaveLength(1);
        expect(await index.lookupTerms(["near", "other"])).toHaveLength(2);
        expect(calls).toEqual([
            "document:term",
            "document:near",
            "document:near,other",
        ]);
        expect(
            index.getEmbedding(embeddingCacheKey("term", identity("document"))),
        ).toEqual([1, 0]);
        expect(
            index.getEmbedding(embeddingCacheKey("term", identity("query"))),
        ).toBeUndefined();
        expect(index.getEmbedding("term")).toBeUndefined();
    });

    test("malformed generated batches leave index unchanged", async () => {
        const invalid = model();
        invalid.forRole = () => invalid;
        invalid.generateEmbeddingBatch = async () => success([[1, 0]]);
        const index = new TextEmbeddingIndex(
            createTextEmbeddingIndexSettings(invalid, 2),
        );
        const result = await index.addText(["one", "two"]);
        expect(result.error).toMatch(/cardinality/);
        expect(index.size).toBe(0);
    });

    test("empty extracted topics never enter keyword or incremental embedding batches", async () => {
        const conversation: IConversation = {
            nameTag: "empty-topics",
            tags: [],
            secondaryIndexes: {},
            messages: createTestMessages(1),
            semanticRefs: new SemanticRefCollection(),
            semanticRefIndex: new TermToSemanticRefIndex(),
        };
        const termsAdded = new Set<string>();
        addKnowledgeToSemanticRefIndex(
            conversation,
            0,
            0,
            {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: ["", " \t\n", "tea"],
            },
            termsAdded,
        );
        expect([...termsAdded]).toEqual(["tea"]);
        expect(conversation.semanticRefIndex?.getTerms()).toEqual(["tea"]);
        expect(conversation.semanticRefs?.length).toBe(3);
        const index = new TermEmbeddingIndex(
            createTextEmbeddingIndexSettings(model(), 2),
        );
        expect(await index.addTerms([...termsAdded])).toMatchObject({
            numberCompleted: 1,
        });
        expect(calls).toEqual(["document:tea"]);
    });

    test("legacy term cache keeps raw key behavior", async () => {
        const legacy = model();
        delete legacy.forRole;
        const { embeddingIdentity: _identity, ...withoutIdentity } = legacy;
        const index = new TermEmbeddingIndex(
            createTextEmbeddingIndexSettings(withoutIdentity, 2),
        );
        await index.addTerms(["term"]);
        expect(index.getEmbedding("term")).toEqual([1, 0]);
    });

    test("term additions deduplicate exact text across batches and reloads", async () => {
        const settings = createTextEmbeddingIndexSettings(model(), 2);
        const index = new TermEmbeddingIndex(settings);
        expect(
            (await index.addTerms(["one", "one", "two"])).numberCompleted,
        ).toBe(3);
        expect((await index.addTerms(["two", "three"])).numberCompleted).toBe(
            2,
        );
        expect(calls).toEqual(["document:one,two", "document:three"]);
        const restored = new TermEmbeddingIndex(settings, index.serialize());
        await restored.addTerms(["one", "three"]);
        expect(calls).toHaveLength(2);
        restored.removeTerm("two");
        expect(
            restored.getEmbedding(
                embeddingCacheKey("three", identity("document")),
            ),
        ).toEqual([1, 0]);
        expect(
            restored.getEmbedding(
                embeddingCacheKey("two", identity("document")),
            ),
        ).toBeUndefined();
        restored.clear();
        expect(
            restored.getEmbedding(
                embeddingCacheKey("one", identity("document")),
            ),
        ).toBeUndefined();
        await restored.addTerms(["one"]);
        expect(restored.serialize().textItems).toEqual(["one"]);
    });

    test("partial vocabulary additions report the original completed prefix and retry missing terms", async () => {
        const settings = createTextEmbeddingIndexSettings(model(), 2);
        settings.batchSize = 1;
        const index = new TermEmbeddingIndex(settings);
        await index.addTerms(["existing"]);
        const result = await index.addTerms(
            ["existing", "one", "one", "two", "existing"],
            { onEmbeddingsCreated: (_all, _batch, startAt) => startAt === 0 },
        );
        expect(result.numberCompleted).toBe(3);
        expect(index.serialize().textItems).toEqual(["existing", "one"]);
        expect(
            (await index.addTerms(["one", "two", "existing"])).numberCompleted,
        ).toBe(3);
        expect(index.serialize().textItems).toEqual(["existing", "one", "two"]);
        expect(calls).toEqual([
            "document:existing",
            "document:one",
            "document:two",
        ]);
    });
});
