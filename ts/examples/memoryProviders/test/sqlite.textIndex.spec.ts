import { createDb } from "../src/sqlite/common.js";
import { createStringTable } from "../src/sqlite/textIndex.js";
import { ensureTestDir, testFilePath } from "./testCore.js";

describe("sqlite.textIndex", () => {
    const testTimeout = 1000 * 60 * 5;

    beforeAll(async () => {
        await ensureTestDir();
    });

    test(
        "stringTable",
        async () => {
            const db = await createDb(testFilePath("strings.db"), true);
            const table = createStringTable(db, "Names");
            const strings: string[] = ["One", "Two", "Three"];
            for (const value of strings) {
                table.add(value);
            }
            const all = [...table.values()];
            expect(all.length).toEqual(strings.length);

            for (let i = 0; i < strings.length; ++i) {
                const id = table.getId(strings[i]);
                expect(id).toBeDefined();
            }
        },
        testTimeout,
    );
});
