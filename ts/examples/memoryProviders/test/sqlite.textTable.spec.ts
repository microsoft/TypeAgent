// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import * as sqlite from "better-sqlite3";
import { AssignedId, createDb } from "../src/sqlite/common.js";
import {
    createStringTable,
    createTextIndex,
    StringTable,
} from "../src/sqlite/textTable.js";
import {
    createEmbeddingModel,
    ensureTestDir,
    hasEmbeddingEndpoint,
    testFilePath,
    testIf,
} from "./testCore.js";
import * as knowLib from "knowledge-processor";

describe("sqlite.textTable", () => {
    const testTimeout = 1000 * 60 * 5;
    const smallEndpoint = "3_SMALL";
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
    test("getNearest_exact", async () => {
        const table = await createTextIndex<number>(
            { caseSensitive: false, concurrency: 2, semanticIndex: false },
            db!,
            "NameIndex_Exact",
            "INTEGER",
        );
        const blocks = composers();
        await table.putMultiple(blocks);
        for (let i = 0; i < blocks.length; ++i) {
            const matches = await table.getNearest(blocks[i].value);
            expect(matches).toEqual(blocks[i].sourceIds);
        }
    });
    testIf(
        () => hasEmbeddingEndpoint(smallEndpoint),
        "getNearest",
        async () => {
            const embeddingModel = createEmbeddingModel(smallEndpoint, 256);
            const table = await createTextIndex<number>(
                {
                    caseSensitive: false,
                    concurrency: 2,
                    semanticIndex: true,
                    embeddingModel,
                },
                db!,
                "NameIndex",
                "INTEGER",
            );

            const composerBlocks = composers();
            await table.putMultiple(composerBlocks);

            const fruitBlocks = fruits();
            await table.putMultiple(fruitBlocks);

            let matches = await table.getNearest("Mango", fruitBlocks.length);
            expect(matches.length).toBeGreaterThan(0);
            expect(matches).toEqual(uniqueSourceIds(fruitBlocks));

            matches = await table.getNearest(
                "Beethoven",
                composerBlocks.length,
            );
            expect(matches.length).toBeGreaterThan(0);
            expect(matches).toEqual(uniqueSourceIds(composerBlocks));
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

    function composers() {
        const blocks: knowLib.TextBlock<number>[] = [
            {
                type: knowLib.TextBlockType.Raw,
                value: "Bach",
                sourceIds: [1, 3, 5, 7],
            },
            {
                type: knowLib.TextBlockType.Raw,
                value: "Debussy",
                sourceIds: [2, 3, 4, 7],
            },
            {
                type: knowLib.TextBlockType.Raw,
                value: "Gershwin",
                sourceIds: [1, 5, 8, 9],
            },
        ];
        return blocks;
    }

    function fruits() {
        const blocks: knowLib.TextBlock<number>[] = [
            {
                type: knowLib.TextBlockType.Raw,
                value: "Banana",
                sourceIds: [11, 13, 15, 17],
            },
            {
                type: knowLib.TextBlockType.Raw,
                value: "Apple",
                sourceIds: [12, 13, 14, 17],
            },
            {
                type: knowLib.TextBlockType.Raw,
                value: "Peach",
                sourceIds: [11, 15, 18, 19],
            },
        ];
        return blocks;
    }

    function uniqueSourceIds(blocks: knowLib.TextBlock[]): number[] {
        const set = new Set<number>();
        for (const block of blocks) {
            block.sourceIds?.forEach((id) => set.add(id));
        }
        return [...set.values()].sort();
    }
});
