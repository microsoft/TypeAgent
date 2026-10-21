// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EmbeddingIdentity,
    EmbeddingRole,
    TextEmbeddingModel,
} from "@typeagent/aiclient";
import { embeddingCacheKey } from "@typeagent/knowledge-processor";
import { success } from "typechat";
import { createConversationSettings } from "../src/conversation.js";
import {
    createTextEmbeddingIndexSettings,
    TextEmbeddingIndex,
} from "../src/fuzzyIndex.js";
import { MessageTextIndex } from "../src/messageIndex.js";
import { TermEmbeddingIndex } from "../src/relatedTermsIndex.js";
import { TextToTextLocationIndex } from "../src/textLocationIndex.js";
import { searchConversationByTextSimilarity } from "../src/search.js";
import { IConversation, TextRange } from "../src/interfaces.js";
import { createTestMessages } from "./testMessage.js";
import { SemanticRefCollection } from "../src/storage.js";
import { TermToSemanticRefIndex } from "../src/conversationIndex.js";

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
    beforeEach(() => {
        calls = [];
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
