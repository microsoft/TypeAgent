// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { createDatabase } from "../src/sqlite/common.js";
import { ensureTestDir, testFilePath } from "./testCore.js";
import { createObjectTable } from "../src/sqlite/objectTable.js";
import { asyncArray } from "typeagent";

describe("sqlite.objectTable", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;

    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("objectFolders.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });

    test(
        "end2end",
        async () => {
            const table = createObjectTable(db!, "Entries");
            const strings = ["One", "Two", "Three"];
            const ids = await asyncArray.mapAsync(strings, 1, (s) =>
                table.put(s),
            );
            expect(ids).toHaveLength(strings.length);

            const allNames = await table.allNames();
            expect(ids).toEqual(allNames);

            const strings_get = await asyncArray.mapAsync(ids, 2, (id) =>
                table.get(id),
            );
            expect(strings_get).toEqual(strings);

            let i = 0;
            for await (const nv of table.all()) {
                expect(nv.name).toEqual(ids[i]);
                expect(nv.value).toEqual(strings[i]);
                ++i;
            }
        },
        testTimeout,
    );
});
