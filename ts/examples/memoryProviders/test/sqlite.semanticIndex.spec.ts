import * as sqlite from "better-sqlite3";
import {
    ensureTestDir,
    generateRandomTestEmbeddings,
    testFilePath,
} from "./testCore.js";
import { createDb } from "../src/sqlite/common.js";
import { createVectorStore } from "../src/sqlite/semanticIndex.js";

describe("sqlite.semanticIndex", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    const embeddingLength = 1024;

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
});
