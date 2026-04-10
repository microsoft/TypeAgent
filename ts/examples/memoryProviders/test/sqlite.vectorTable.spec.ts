// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import {
    ensureTestDir,
    generateRandomTestEmbedding,
    generateRandomTestEmbeddings,
    generateTestEmbedding,
    testFilePath,
    testIf,
} from "./testCore.js";
import { createDatabase } from "../src/sqlite/common.js";
import { createVectorTable } from "../src/sqlite/vectorTable.js";
import { NormalizedEmbedding, SimilarityType } from "typeagent";

describe("sqlite.vectorTable", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    const embeddingLength = 1536;

    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("vectorIndex.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });
    test(
        "string_id",
        async () => {
            const index = createVectorTable<string>(db!, "string_id", "TEXT");
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
            const index = createVectorTable<string>(
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

    test(
        "auto_id_integer",
        async () => {
            // Test that put() without an id auto-generates an integer id
            const index = createVectorTable<number>(
                db!,
                "auto_id_integer",
                "INTEGER",
            );
            const embeddings = generateRandomTestEmbeddings(embeddingLength, 3);

            const id1 = await index.put(embeddings[0]);
            const id2 = await index.put(embeddings[1]);
            const id3 = await index.put(embeddings[2]);

            // Should get distinct integer ids
            expect(typeof id1).toBe("number");
            expect(typeof id2).toBe("number");
            expect(typeof id3).toBe("number");
            expect(id1).not.toEqual(id2);
            expect(id2).not.toEqual(id3);

            // Should be able to retrieve by auto-generated id
            const retrieved1 = await index.get(id1);
            const retrieved2 = await index.get(id2);
            expect(retrieved1).toBeDefined();
            expect(retrieved2).toBeDefined();
            expect(retrieved1).toEqual(embeddings[0]);
            expect(retrieved2).toEqual(embeddings[1]);

            // Should register as existing
            expect(index.exists(id1)).toBe(true);
            expect(index.exists(id2)).toBe(true);
            expect(index.exists(9999999)).toBe(false);
        },
        testTimeout,
    );

    test(
        "auto_id_string",
        async () => {
            // Test that put() without an id auto-generates a UUID string id
            const index = createVectorTable<string>(
                db!,
                "auto_id_string",
                "TEXT",
            );
            const embeddings = generateRandomTestEmbeddings(embeddingLength, 2);

            const id1 = await index.put(embeddings[0]);
            const id2 = await index.put(embeddings[1]);

            // Should get distinct string (UUID) ids
            expect(typeof id1).toBe("string");
            expect(typeof id2).toBe("string");
            expect(id1).not.toEqual(id2);
            // UUID format: 8-4-4-4-12 hex chars
            expect(id1).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            );
            expect(id2).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            );

            // Should be able to retrieve by auto-generated UUID
            const retrieved1 = await index.get(id1);
            expect(retrieved1).toBeDefined();
            expect(retrieved1).toEqual(embeddings[0]);

            expect(index.exists(id1)).toBe(true);
            expect(index.exists("non-existent-uuid")).toBe(false);
        },
        testTimeout,
    );

    testIf(
        "number_id_perf",
        () => false,
        async () => {
            const index = createVectorTable<number>(
                db!,
                "number_id_perf",
                "INTEGER",
            );

            const testEmbedding = generateRandomTestEmbedding(embeddingLength);
            let embeddingCount = 10000;
            console.log(
                `##${embeddingCount} Embeddings, ${embeddingLength} dimensions ###`,
            );
            console.time("put");
            const embeddings = generateRandomTestEmbeddings(
                embeddingLength,
                embeddingCount,
            );
            console.timeEnd("put");
            for (let i = 0; i < embeddings.length; ++i) {
                await index.put(embeddings[i], i);
            }
            for (let i = 0; i < 4; ++i) {
                console.log(`##${i}##`);
                console.time("nn");
                await index.nearestNeighbor(testEmbedding, SimilarityType.Dot);
                console.timeEnd("nn");
            }
        },
        testTimeout,
    );
});
