// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { createDb } from "../src/sqlite/common.js";
import { ensureTestDir, testFilePath } from "./testCore.js";
import { createKeyValueIndex } from "../src/sqlite/keyValueIndex.js";

describe("sqlite.keyValueIndex", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    beforeAll(async () => {
        await ensureTestDir();
        db = await createDb(testFilePath("kvIndex.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });
    test(
        "string_string",
        async () => {
            const index = createKeyValueIndex<string, string>(
                db!,
                "string_string",
                "TEXT",
                "TEXT",
            );
            const idsForKey = makeStringIds(4, 4);
            for (let k = 0; k < 4; ++k) {
                await index.put(idsForKey[k], k.toString());
            }
            for (let k = 0; k < 4; ++k) {
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
        },
        testTimeout,
    );
    test(
        "string_number",
        async () => {
            const index = createKeyValueIndex<string, number>(
                db!,
                "string_number",
                "TEXT",
                "INTEGER",
            );
            7;
            const idsForKey = makeNumberIds(4, 4);
            for (let k = 0; k < 4; ++k) {
                await index.put(idsForKey[k], k.toString());
            }
            for (let k = 0; k < 4; ++k) {
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
        },
        testTimeout,
    );

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
