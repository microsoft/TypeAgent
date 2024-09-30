import { removeDir } from "../src/objStream.js";
import {
    createObjectFolder,
    ObjectFolder,
    ObjectFolderSettings,
} from "../src/storage/objectFolder.js";

type TestObject = {
    key: string;
    value: string | number;
};

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
    let folder: ObjectFolder<TestObject> | undefined;
    const folderPath = "/data/test/testStore";
    beforeAll(async () => {
        folder = await ensureStore(folderPath, true);
    });
    test("putAndGet", async () => {
        const obj: TestObject = {
            key: "Foo",
            value: "Bar",
        };
        const id = await folder!.put(obj);
        const loaded = await folder!.get(id);
        expect(loaded).toEqual(obj);
    });
});

describe("storage.objectFolder.safeWrites", () => {
    let folder: ObjectFolder<TestObject> | undefined;
    const folderPath = "/data/test/testStoreSafe";
    beforeAll(async () => {
        folder = await ensureStore(folderPath, true, true);
    });
    test("putAndGet", async () => {
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
    });
});
