// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { describeIf, hasTestKeys } from "test-lib";
import { ensureTestDir, testFilePath } from "./testCommon.js";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import { SqliteEmbeddingIndex } from "../src/sqlite/sqliteEmbeddingIndex.js";
import { createNormalized, NormalizedEmbedding } from "typeagent";

describeIf(
    "memory.sqlite.embeddingIndex",
    () => hasTestKeys(),
    () => {
        const testTimeout = 1000 * 60 * 5;
        let db: sqlite.Database | undefined;
        const embeddingLength = 1536;

        beforeAll(async () => {
            await ensureTestDir();
            db = createDatabase(testFilePath("embeddings.db"), true);
        });
        afterAll(() => {
            if (db) {
                db.close();
            }
        });

        test(
            "end2end",
            async () => {
                const index = new SqliteEmbeddingIndex(db!, "end2end");
                const embeddings: NormalizedEmbedding[] = [
                    generateTestEmbedding(1, embeddingLength),
                    generateTestEmbedding(0.5, embeddingLength),
                    generateTestEmbedding(0.2, embeddingLength),
                ];
                index.push(embeddings);
                expect(index.size).toBe(embeddings.length);
                const match = index.nearestNeighbor(embeddings[0]);
                expect(match).toBeDefined();
                expect(match?.item).toEqual(0);

                const matches = await index.nearestNeighbors(embeddings[0], 2);
                expect(matches.length).toEqual(2);
            },
            testTimeout,
        );
    },
);

export function generateTestEmbedding(
    value: number,
    length: number,
): NormalizedEmbedding {
    const embedding = new Array<number>(length);
    embedding.fill(value);
    return createNormalized(embedding);
}
