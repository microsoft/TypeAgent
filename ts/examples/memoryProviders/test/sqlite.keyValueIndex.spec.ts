// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDb } from "../src/sqlite/common.js";
import { ensureTestDir, testFilePath } from "./testCore.js";
import {
    ColumnType,
    createKeyValueIndex,
} from "../src/sqlite/keyValueIndex.js";

describe("sqlite.keyValueIndex", () => {
    const testTimeout = 1000 * 60 * 5;
    beforeAll(async () => {
        await ensureTestDir();
    });

    test(
        "string_string",
        async () => {
            const db = await createDb(testFilePath("kvIndex.db"), true);
            const index = createKeyValueIndex<string, string>(
                db,
                "Postings",
                "TEXT",
                "TEXT",
            );
            const keyValues = makeKeyValues<string>(4, 4);
            for (let k = 0; k < 4; ++k) {
                await index.put(keyValues[k], k.toString());
            }
            for (let k = 0; k < 4; ++k) {
                const values = await index.get(k.toString());
                expect(values).toBeDefined();
                if (values) {
                    let expectedValues = keyValues[k];
                    expect(values.length).toEqual(keyValues[k].length);
                    for (let v = 0; v < values.length; ++v) {
                        expect(values[v]).toEqual(expectedValues[v]);
                    }
                }
            }
        },
        testTimeout,
    );

    function makeKeyValues<TKey extends ColumnType>(
        keyCount: number,
        valueCount: number,
    ) {
        let kv: string[][] = [];
        for (let k = 0; k < keyCount; ++k) {
            kv.push(makeValues(k, valueCount));
        }
        return kv;
    }

    function makeValues(k: number, count: number) {
        let values: string[] = [];
        for (let v = 0; v < 4; ++v) {
            values.push(`${k}_${v}`);
        }
        return values;
    }
});
