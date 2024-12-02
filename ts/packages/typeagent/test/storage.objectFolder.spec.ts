// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray } from "../src/index.js";
import { removeDir } from "../src/objStream.js";
import {
    createFileNameGenerator,
    createObjectFolder,
    generateTimestampString,
    ObjectFolder,
    ObjectFolderSettings,
} from "../src/storage/objectFolder.js";
import { testDirectoryPath } from "./common.js";

type TestObject = {
    key: string;
    value: string | number;
};

function makeObjects(count: number): TestObject[] {
    const items: TestObject[] = [];
    for (let i = 0; i < count; ++i) {
        items.push({ key: "key" + i, value: "value" + i });
    }
    return items;
}

async function addObjects(folder: ObjectFolder<TestObject>, objCount: number) {
    const objects = makeObjects(objCount);
    return await asyncArray.mapAsync(objects, 1, async (o) => folder!.put(o));
}

async function ensureStore<T>(
    folderPath: string,
    createNew: boolean = true,
    safeWrites: boolean | undefined = undefined,
) {
    if (createNew) {
        await removeDir(folderPath);
    }
    const settings: ObjectFolderSettings = { safeWrites };
    return await createObjectFolder<T>(folderPath, settings);
}

describe("storage.objectFolder", () => {
    const timeoutMs = 1000 * 60 * 5;
    let folder: ObjectFolder<TestObject> | undefined;
    const folderPath = testDirectoryPath("./data/test/testStore");
    beforeAll(async () => {
        folder = await ensureStore(folderPath, true);
    }, timeoutMs);
    test(
        "idGen",
        () => {
            const nameGenerator = createFileNameGenerator(
                generateTimestampString,
                (name: string) => true,
            );
            const maxNames = 256;
            let prevName = "";
            for (let i = 0; i < maxNames; ++i) {
                const objFileName = nameGenerator.next().value;
                expect(objFileName).not.toEqual(prevName);
                prevName = objFileName;
            }
        },
        timeoutMs,
    );
    test(
        "putAndGet",
        async () => {
            const obj: TestObject = {
                key: "Foo",
                value: "Bar",
            };
            const id = await folder!.put(obj);
            const loaded = await folder!.get(id);
            expect(loaded).toEqual(obj);
        },
        timeoutMs,
    );
    test(
        "putMultiple",
        async () => {
            const objCount = 10;
            const ids = await addObjects(folder!, objCount);
            expect(ids.length).toBe(objCount);
        },
        timeoutMs,
    );
    test(
        "remove",
        async () => {
            await folder!.clear();
            const size = await folder!.size();
            expect(size).toBe(0);
        },
        timeoutMs,
    );
    test(
        "readAll",
        async () => {
            await folder!.clear();
            const objCount = 17;
            await addObjects(folder!, objCount);
            let countRead = 0;
            for await (const _ of folder!.all()) {
                countRead++;
            }
            expect(countRead).toBe(objCount);
        },
        timeoutMs,
    );
});

describe("storage.objectFolder.safeWrites", () => {
    const timeoutMs = 1000 * 60 * 5;
    let folder: ObjectFolder<TestObject> | undefined;
    const folderPath = testDirectoryPath("./data/test/testStoreSafe");
    beforeAll(async () => {
        folder = await ensureStore(folderPath, true, true);
    }, timeoutMs);
    test(
        "putAndGet",
        async () => {
            const obj: TestObject = {
                key: "Foo",
                value: "Bar",
            };
            const id = await folder!.put(obj);
            let loaded = await folder!.get(id);
            expect(loaded).toEqual(obj);

            obj.value = "Goo";
            await folder!.put(obj, id);
            loaded = await folder!.get(id);
            expect(loaded).toEqual(obj);

            const allIds = await folder!.allNames();
            expect(allIds).toHaveLength(1);
        },
        timeoutMs,
    );
});
