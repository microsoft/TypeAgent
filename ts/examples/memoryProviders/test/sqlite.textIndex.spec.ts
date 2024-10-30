// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { createDb } from "../src/sqlite/common.js";
import { createStringTable } from "../src/sqlite/textIndex.js";
import { ensureTestDir, testFilePath } from "./testCore.js";

describe("sqlite.textIndex", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    beforeAll(async () => {
        await ensureTestDir();
        db = await createDb(testFilePath("strings.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });

    test(
        "stringTable",
        async () => {
            const table = createStringTable(db!, "Names");
            const strings: string[] = ["One", "Two", "Three"];
            const stringIds: number[] = [];

            for (const value of strings) {
                const id = table.add(value);
                stringIds.push(id);
            }
            // Add dupes
            const dupeIds: number[] = [];
            for (const value of strings) {
                const id = table.add(value);
                dupeIds.push(id);
            }
            expect(stringIds).toEqual(dupeIds);

            const all = [...table.values()];
            expect(all.length).toEqual(strings.length);

            for (let i = 0; i < strings.length; ++i) {
                const id = table.getId(strings[i]);
                expect(id).toBeDefined();
                expect(id).toEqual(stringIds[i]);
            }
        },
        testTimeout,
    );
});
