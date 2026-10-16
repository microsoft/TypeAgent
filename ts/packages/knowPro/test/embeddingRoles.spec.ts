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
});
