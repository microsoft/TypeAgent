// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { AssignedId, createDb } from "../src/sqlite/common.js";
import { createStringTable, StringTable } from "../src/sqlite/textTable.js";
import { ensureTestDir, testFilePath } from "./testCore.js";

describe("sqlite.textTable", () => {
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

            const stringIds = table.add(strings);
            expect(stringIds).toHaveLength(strings.length);
            checkIsNew(stringIds, true);
            checkExists(table, strings, stringIds);
            // Add dupes
            const dupeIds = table.add(strings);
            expect(dupeIds).toHaveLength(stringIds.length);
            checkIsNew(dupeIds, false);

            // All values
            const all = [...table.values()];
            expect(all).toEqual(strings);

            const all2 = [
                ...table.getTextMultiple(stringIds.map((id) => id.id)),
            ];
            expect(all2).toHaveLength(all.length);
        },
        testTimeout,
    );

    function checkIsNew(ids: AssignedId<number>[], expected: boolean) {
        for (const id of ids) {
            expect(id.isNew).toEqual(expected);
        }
    }

    function checkExists(
        table: StringTable,
        strings: string[],
        expectedIds: AssignedId<number>[],
    ) {
        for (let i = 0; i < strings.length; ++i) {
            const id = table.getId(strings[i]);
            expect(id).toBeDefined();
            expect(id).toEqual(expectedIds[i].id);
        }
    }
});
