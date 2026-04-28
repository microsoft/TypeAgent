// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { removeDir } from "../src/objStream.js";
import { createEmbeddingFolder } from "../src/storage/embeddingFS.js";
import { SimilarityType } from "../src/vector/embeddings.js";
import { generateRandomEmbedding, testDirectoryPath } from "./common.js";

describe("storage.embeddingFS", () => {
    const storePath = testDirectoryPath("embeddingFS_test");

    beforeEach(async () => {
        await removeDir(storePath);
    });

    test("nearestNeighborsInSubset returns closest embedding from subset", async () => {
        const folder = await createEmbeddingFolder(storePath);
        const dim = 16;

        // Store 4 embeddings
        const a = generateRandomEmbedding(dim);
        const b = generateRandomEmbedding(dim);
        const c = generateRandomEmbedding(dim);
        const d = generateRandomEmbedding(dim);
        await folder.put(a, "a");
        await folder.put(b, "b");
        await folder.put(c, "c");
        await folder.put(d, "d");

        // Query with embedding identical to "b"
        const results = await folder.nearestNeighborsInSubset(
            b,
            ["a", "b", "c"],
            3,
            SimilarityType.Cosine,
        );

        // "b" should be first with score ~1
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item).toBe("b");
        expect(results[0].score).toBeCloseTo(1, 4);
        // "d" is not in the subset so should not appear
        const items = results.map((r) => r.item);
        expect(items).not.toContain("d");
    });

    test("nearestNeighborsInSubset handles subset that excludes some stored items", async () => {
        const folder = await createEmbeddingFolder(storePath);
        const dim = 8;

        const e1 = generateRandomEmbedding(dim);
        const e2 = generateRandomEmbedding(dim);
        const e3 = generateRandomEmbedding(dim);
        await folder.put(e1, "e1");
        await folder.put(e2, "e2");
        await folder.put(e3, "e3");

        // Only search subset ["e1", "e3"] — e2 should never appear
        const results = await folder.nearestNeighborsInSubset(
            e1,
            ["e1", "e3"],
            2,
            SimilarityType.Cosine,
        );
        const items = results.map((r) => r.item);
        expect(items).not.toContain("e2");
        expect(items).toContain("e1");
    });

    test("nearestNeighborsInSubset returns empty for empty subset", async () => {
        const folder = await createEmbeddingFolder(storePath);
        const e = generateRandomEmbedding(8);
        await folder.put(e, "only");

        const results = await folder.nearestNeighborsInSubset(
            e,
            [],
            3,
            SimilarityType.Cosine,
        );
        expect(results).toHaveLength(0);
    });
});
