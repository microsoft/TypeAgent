// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import {
    ensureTestDir,
    generateRandomTestEmbeddings,
    generateTestEmbedding,
    testFilePath,
} from "./testCore.js";
import { createDb } from "../src/sqlite/common.js";
import { createVectorStore } from "../src/sqlite/semanticIndex.js";
import { NormalizedEmbedding, SimilarityType } from "typeagent";

describe("sqlite.semanticIndex", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    const embeddingLength = 4;

    beforeAll(async () => {
        await ensureTestDir();
        db = await createDb(testFilePath("vectorIndex.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });
    test(
        "string_id",
        async () => {
            const index = createVectorStore<string>(db!, "string_id", "TEXT");
            const keys: string[] = ["One", "Two"];
            const embeddings = generateRandomTestEmbeddings(
                embeddingLength,
                keys.length,
            );
            for (let i = 0; i < keys.length; ++i) {
                await index.put(embeddings[i], keys[i]);
            }
            for (let i = 0; i < keys.length; ++i) {
                const stored = await index.get(keys[i]);
                expect(stored).toBeDefined();
                expect(stored).toEqual(embeddings[i]);
            }
        },
        testTimeout,
    );
    test(
        "string_id_match",
        async () => {
            const index = createVectorStore<string>(
                db!,
                "string_id_match",
                "TEXT",
            );
            const keys: string[] = ["One", "Two", "Three"];
            const embeddings: NormalizedEmbedding[] = [
                generateTestEmbedding(1, embeddingLength),
                generateTestEmbedding(0.5, embeddingLength),
                generateTestEmbedding(0.2, embeddingLength),
            ];
            for (let i = 0; i < keys.length; ++i) {
                await index.put(embeddings[i], keys[i]);
            }
            const match = await index.nearestNeighbor(
                embeddings[0],
                SimilarityType.Dot,
            );
            expect(match).toBeDefined();
            expect(match?.item).toEqual(keys[0]);

            const matches = await index.nearestNeighbors(
                embeddings[0],
                2,
                SimilarityType.Dot,
            );
            expect(matches.length).toEqual(2);
        },
        testTimeout,
    );
});
