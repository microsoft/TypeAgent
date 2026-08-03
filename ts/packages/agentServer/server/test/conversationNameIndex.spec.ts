// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { createConversationNameIndex } from "../src/conversationNameIndex.js";

// A tiny deterministic embedding space so tests can assert semantic matches
// without any network calls. Each recognized keyword maps to a dimension;
// unrecognized words land on a shared "other" dimension so unknown names stay
// orthogonal to the keyword dimensions.
const DIMS = 5;
const OTHER_DIM = 4;
const KEYWORD_DIMS: Record<string, number> = {
    workout: 0,
    gym: 0,
    exercise: 0,
    fitness: 0,
    playlist: 1,
    music: 1,
    song: 1,
    songs: 1,
    grocery: 2,
    groceries: 2,
    shopping: 2,
    food: 2,
    trip: 3,
    travel: 3,
    paris: 3,
    france: 3,
    vacation: 3,
};

function keywordVector(text: string): number[] {
    const v = new Array<number>(DIMS).fill(0);
    let matched = false;
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
        const dim = KEYWORD_DIMS[word];
        if (dim !== undefined) {
            v[dim] += 1;
            matched = true;
        }
    }
    if (!matched) {
        v[OTHER_DIM] = 1;
    }
    return v;
}

function keywordModel(): TextEmbeddingModel {
    return {
        generateEmbedding: async (text: string) => ({
            success: true as const,
            data: keywordVector(text),
        }),
        maxBatchSize: 1,
    } as unknown as TextEmbeddingModel;
}

function failingModel(): TextEmbeddingModel {
    return {
        generateEmbedding: async () => ({
            success: false as const,
            message: "no embedding provider",
        }),
        maxBatchSize: 1,
    } as unknown as TextEmbeddingModel;
}

const CONVERSATIONS: [string, string][] = [
    ["id-workout", "workout playlist setup"],
    ["id-grocery", "grocery shopping list"],
    ["id-paris", "trip to Paris"],
];

function seededIndex(model: TextEmbeddingModel) {
    const index = createConversationNameIndex(model);
    for (const [id, name] of CONVERSATIONS) {
        index.update(id, name);
    }
    return index;
}

describe("conversationNameIndex", () => {
    it("ranks an exact name match first", async () => {
        const index = seededIndex(keywordModel());
        const matches = await index.search("workout playlist setup", 10);
        expect(matches[0].conversationId).toBe("id-workout");
        expect(matches[0].score).toBeGreaterThanOrEqual(0.99);
    });

    it("matches on a substring of the name", async () => {
        const index = seededIndex(keywordModel());
        const matches = await index.search("grocery shopping", 10);
        expect(matches[0].conversationId).toBe("id-grocery");
    });

    it("surfaces a semantically related name via embeddings", async () => {
        const index = seededIndex(keywordModel());
        // No lexical overlap with "workout playlist setup", but the same
        // fitness + music concepts, so the embedding half must find it.
        const matches = await index.search("gym music", 10);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].conversationId).toBe("id-workout");
    });

    it("drops a conversation after remove()", async () => {
        const index = seededIndex(keywordModel());
        index.remove("id-workout");
        const matches = await index.search("workout playlist setup", 10);
        expect(
            matches.find((m) => m.conversationId === "id-workout"),
        ).toBeUndefined();
    });

    it("returns [] for a non-positive maxMatches without crashing", async () => {
        // Regression: an omitted maxMatches serializes to null over RPC,
        // yielding maxMatches=0 → indexesOfNearest(0) → TopNCollection(0),
        // whose first push dereferenced an undefined heap top and threw
        // "Cannot read properties of undefined (reading 'score')".
        const index = seededIndex(keywordModel());
        await expect(
            index.search("workout playlist setup", 0),
        ).resolves.toEqual([]);
    });

    it("reflects a renamed conversation", async () => {
        const index = seededIndex(keywordModel());
        index.update("id-grocery", "trip to France");
        const matches = await index.search("trip to France", 10);
        expect(matches[0].conversationId).toBe("id-grocery");
    });

    it("degrades to lexical-only when embeddings are unavailable", async () => {
        const index = seededIndex(failingModel());
        // Exact/substring still work without embeddings...
        const exact = await index.search("workout playlist setup", 10);
        expect(exact[0]?.conversationId).toBe("id-workout");
        // ...but a purely semantic query has nothing to match lexically.
        const semantic = await index.search("gym music", 10);
        expect(semantic).toHaveLength(0);
    });

    it("returns nothing for an empty query", async () => {
        const index = seededIndex(keywordModel());
        expect(await index.search("   ", 10)).toHaveLength(0);
    });

    it("honors the maxMatches cap", async () => {
        const index = seededIndex(keywordModel());
        // A query that lexically matches every name (each contains a space).
        const matches = await index.search("i", 1);
        expect(matches.length).toBeLessThanOrEqual(1);
    });
});
