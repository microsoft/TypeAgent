// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHashObjectFolder } from "../src/storage/objectPage";
import { testDirectoryPath } from "./common";

describe("storage.objectHashFolder", () => {
    const folderPath = testDirectoryPath("./data/test/objectHash");
    test("end2end", async () => {
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
    });
    test("numbers", async () => {
        const hashFolder = await createHashObjectFolder<number>(
            folderPath,
            true,
        );
        let count = 1024;
        for (let i = 0; i < count; ++i) {
            await hashFolder.put(i.toString(), i);
        }
        for (let i = 0; i < count; ++i) {
            const value = await hashFolder.get(i.toString());
            expect(value).toEqual(i);
        }
    });
});
