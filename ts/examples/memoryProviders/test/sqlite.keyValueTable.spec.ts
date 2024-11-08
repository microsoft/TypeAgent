// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { createDatabase } from "../src/sqlite/common.js";
import { ensureTestDir, testFilePath } from "./testCore.js";
import { createKeyValueTable } from "../src/sqlite/keyValueTable.js";

describe("sqlite.keyValueTable", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("kvIndex.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });
    test(
        "string_string",
        async () => {
            const index = createKeyValueTable<string, string>(
                db!,
                "string_string",
                "TEXT",
                "TEXT",
            );
            const idsForKey = makeStringIds(4, 4);
            const maxK = 4;
            for (let k = 0; k < maxK; ++k) {
                await index.put(idsForKey[k], k.toString());
            }
            verifyTable(index, maxK, idsForKey);
        },
        testTimeout,
    );
    test(
        "string_number",
        async () => {
            const index = createKeyValueTable<string, number>(
                db!,
                "string_number",
                "TEXT",
                "INTEGER",
            );
            7;
            const idsForKey = makeNumberIds(4, 4);
            const maxK = 4;
            for (let k = 0; k < maxK; ++k) {
                await index.put(idsForKey[k], k.toString());
            }
            verifyTable(index, maxK, idsForKey);
        },
        testTimeout,
    );
    test(
        "number_number",
        async () => {
            const index = createKeyValueTable<number, number>(
                db!,
                "number_number",
                "INTEGER",
                "INTEGER",
            );
            7;
            const idsForKey = makeNumberIds(4, 4);
            const maxK = 4;
            for (let k = 0; k < maxK; ++k) {
                await index.put(idsForKey[k], k);
            }
            verifyTable(index, maxK, idsForKey);
        },
        testTimeout,
    );

    async function verifyTable(
        index: knowLib.KeyValueIndex,
        maxK: number,
        idsForKey: any[],
    ) {
        for (let k = 0; k < maxK; ++k) {
            const ids = await index.get(k.toString());
            expect(ids).toBeDefined();
            if (ids) {
                let expectedIds = idsForKey[k];
                expect(ids.length).toEqual(idsForKey[k].length);
                for (let v = 0; v < ids.length; ++v) {
                    expect(ids[v]).toEqual(expectedIds[v]);
                }
            }
        }
    }

    function makeStringIds(keyCount: number, valueCount: number) {
        let kv: string[][] = [];
        for (let k = 0; k < keyCount; ++k) {
            kv.push(makeIds(k, valueCount));
        }
        return kv;

        function makeIds(k: number, count: number) {
            let values: string[] = [];
            for (let v = 0; v < 4; ++v) {
                values.push(`${k}_${v}`);
            }
            return values;
        }
    }

    function makeNumberIds(keyCount: number, valueCount: number) {
        let kv: number[][] = [];
        for (let k = 0; k < keyCount; ++k) {
            kv.push(makeIds(k, valueCount));
        }
        return kv;

        function makeIds(k: number, count: number) {
            let values: number[] = [];
            for (let v = 0; v < 4; ++v) {
                values.push(k * 1000 + v);
            }
            return values;
        }
    }
});
