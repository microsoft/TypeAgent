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
    composers,
    createEmbeddingModel,
    ensureTestDir,
    fruits,
    hasEmbeddingEndpoint,
    testFilePath,
    testIf,
    uniqueSourceIds,
} from "./testCore.js";
import * as knowLib from "knowledge-processor";
import { asyncArray } from "typeagent";

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
        () => {
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

            expect(table.exists(strings[0])).toBeTruthy();
            expect(table.exists("Unknown")).toBeFalsy();

            // All values
            const all = [...table.values()];
            expect(all).toEqual(strings);
            // Retrieve all texts based on the Ids we got earlier
            const all2 = [...table.getTexts(stringIds.map((id) => id.id))];
            expect(all2).toHaveLength(all.length);
            // Retrieve all ids
            const allIds = [...table.getIds(strings)].sort();
            expect(allIds).toHaveLength(stringIds.length);
        },
        testTimeout,
    );
    test("getNearest_exact_number", async () => {
        // This index does *not* have semantic indexing
        const table = await createTextIndex<number, number>(
            { caseSensitive: false, concurrency: 2, semanticIndex: false },
            db!,
            "NameIndex_Exact",
            "INTEGER",
            "INTEGER",
        );

        // Add composers
        const composerBlocks = composers();
        await table.putMultiple(composerBlocks);
        // Get all ids of what we added
        const allIds = await asyncArray.toArray(table.ids());
        // Each id should be a number
        allIds.forEach((id) => expect(typeof id === "number").toBeTruthy());
        // Now,get ids for each text...
        let textIds = await table.getIds(composerBlocks.map((b) => b.value));
        expect(allIds).toEqual(textIds);
        // Retrieve postings by text...
        const ids = await table.get(composerBlocks[0].value);
        expect(ids).toEqual(composerBlocks[0].sourceIds);
        // Nearest... will do exact matches
        for (let i = 0; i < composerBlocks.length; ++i) {
            const matches = await table.getNearest(composerBlocks[i].value);
            expect(matches).toEqual(composerBlocks[i].sourceIds);
        }
        // And lastly, a group by
        const hits = [
            ...table.getHitsSync([
                composerBlocks[0].value,
                composerBlocks[1].value,
                composerBlocks[2].value,
            ]),
        ];
        const expectedHits = knowLib.sets.createHitTable();
        for (const block of composerBlocks) {
            expectedHits.addMultiple(block.sourceIds!, 1);
        }
        for (const hit of hits) {
            const expectedItem = expectedHits.get(hit.item);
            expect(expectedItem).toBeDefined();
            if (expectedItem) {
                expect(hit.score).toEqual(expectedItem.score);
            }
        }
    });
    test("getNearest_exact_string", async () => {
        const table = await createTextIndex<string, number>(
            { caseSensitive: false, concurrency: 2, semanticIndex: false },
            db!,
            "NameIndex_Exact_string",
            "TEXT",
            "INTEGER",
        );
        const blocks = composers();
        await table.putMultiple(blocks);

        const names = blocks.map((b) => b.value);
        const allTextIds = await asyncArray.toArray(table.ids());
        allTextIds.forEach((id) => expect(typeof id === "string").toBeTruthy());
        let textIds = await table.getIds(names);
        expect(allTextIds).toEqual(textIds);
        const gotNames = await asyncArray.mapAsync(allTextIds, 1, (id) =>
            table.getText(id),
        );
        expect(gotNames).toEqual(names);

        let ids = await table.get(blocks[0].value);
        expect(ids).toEqual(blocks[0].sourceIds);

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
            const table = await createTextIndex<number, number>(
                {
                    caseSensitive: false,
                    concurrency: 2,
                    semanticIndex: true,
                    embeddingModel,
                },
                db!,
                "NameIndex",
                "INTEGER",
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
});
