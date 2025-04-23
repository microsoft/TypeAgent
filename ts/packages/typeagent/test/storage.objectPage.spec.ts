// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHashObjectFolder } from "../src/storage/objectPage.js";
import { testDirectoryPath } from "./common.js";

describe("storage.objectHashFolder", () => {
    const timeoutMs = 30000;
    const folderPath = testDirectoryPath("./data/test/objectHash");
    test(
        "end2end",
        async () => {
            const hashFolder = await createHashObjectFolder<string>(
                folderPath,
                true,
            );
            const values = ["One", "Two", "Three", "Four", "Foo", "Bar"];
            for (const value of values) {
                await hashFolder.put(value, value);
            }
            for (const value of values) {
                const stored = await hashFolder.get(value);
                expect(stored).toEqual(value);
            }
        },
        timeoutMs,
    );
    test(
        "numbers",
        async () => {
            await testNumbers(17);
        },
        timeoutMs,
    );
    test(
        "numbersWithCache",
        async () => {
            await testNumbers(17, 4);
        },
        timeoutMs,
    );

    async function testNumbers(
        numBuckets: number,
        cacheSize?: number | undefined,
    ) {
        const hashFolder = await createHashObjectFolder<number>(
            folderPath,
            true,
            numBuckets,
            {
                cacheSize,
            },
        );
        let count = 256;
        for (let i = 0; i < count; ++i) {
            await hashFolder.put(i.toString(), i);
        }
        await hashFolder.save();
        for (let i = 0; i < count; ++i) {
            const value = await hashFolder.get(i.toString());
            expect(value).toEqual(i);
        }
    }
});
