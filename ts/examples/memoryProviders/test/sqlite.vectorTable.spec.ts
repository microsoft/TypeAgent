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
