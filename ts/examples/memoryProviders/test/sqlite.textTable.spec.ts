// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import * as sqlite from "better-sqlite3";
import { AssignedId, createDatabase } from "../src/sqlite/common.js";
import {
    createStringTable,
    createTextIndex,
    StringTable,
    TextTable,
} from "../src/sqlite/textTable.js";
import {
    composers,
    countSourceIds,
    createEmbeddingModel,
    ensureTestDir,
    fruits,
    hasEmbeddingEndpoint,
    testFilePath,
    testIf,
    uniqueSourceIds,
} from "./testCore.js";
import * as knowLib from "knowledge-processor";
import { asyncArray, ScoredItem } from "typeagent";

import {
    createTemporalLogTable,
    TemporalTable,
} from "../src/sqlite/temporalTable.js";

type HitTable<T = any> = knowLib.sets.HitTable<T>;

describe("sqlite.textTable", () => {
    const testTimeout = 1000 * 60 * 5;
    const smallEndpoint = "3_SMALL";
    let db: sqlite.Database | undefined;

    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("strings.db"), true);
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

    test(
        "getNearest_exact_number",
        async () => {
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
            await table.addUpdateMultiple(composerBlocks);
            // Get all ids of what we added
            const allIds = await asyncArray.toArray(table.ids());
            // Each id should be a number
            allIds.forEach((id) => expect(typeof id === "number").toBeTruthy());
            // Now,get ids for each text...
            let textIds = await table.getIds(
                composerBlocks.map((b) => b.value),
            );
            expect(allIds).toEqual(textIds);
            // Retrieve postings by text...
            const ids = await table.get(composerBlocks[0].value);
            expect(ids).toEqual(composerBlocks[0].sourceIds);
            // Should match frequencies
            const freq = await table.getFrequency(composerBlocks[0].value);
            expect(freq).toEqual(composerBlocks[0].sourceIds?.length);

            // Nearest... will do exact matches
            for (let i = 0; i < composerBlocks.length; ++i) {
                const matches = await table.getNearest(composerBlocks[i].value);
                expect(matches).toEqual(composerBlocks[i].sourceIds);
            }
            const hits = [
                ...table.getExactHits([
                    composerBlocks[0].value,
                    composerBlocks[1].value,
                    composerBlocks[2].value,
                ]),
            ];
            const expectedHits = knowLib.sets.createHitTable();
            for (const block of composerBlocks) {
                expectedHits.addMultiple(block.sourceIds!, 1);
            }
            compareHitScores(hits, expectedHits);
        },
        testTimeout,
    );

    test(
        "getNearest_exact_string",
        async () => {
            const table = await createTextIndex<string, number>(
                { caseSensitive: false, concurrency: 2, semanticIndex: false },
                db!,
                "NameIndex_Exact_string",
                "TEXT",
                "INTEGER",
            );
            const blocks = composers();
            await table.addUpdateMultiple(blocks);

            const names = blocks.map((b) => b.value);
            const allTextIds = await asyncArray.toArray(table.ids());
            allTextIds.forEach((id) =>
                expect(typeof id === "string").toBeTruthy(),
            );
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
        },
        testTimeout,
    );

    testIf(
        "getNearest",
        () => hasEmbeddingEndpoint(smallEndpoint),
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
            await table.addUpdateMultiple(composerBlocks);

            const fruitBlocks = fruits();
            await table.addUpdateMultiple(fruitBlocks);

            let matches = await table.getNearest("Mango", fruitBlocks.length);
            expect(matches.length).toBeGreaterThan(0);
            expect(matches).toEqual(uniqueSourceIds(fruitBlocks));

            const uniqueIds = uniqueSourceIds(composerBlocks);
            matches = await table.getNearest(
                "Beethoven",
                composerBlocks.length,
            );
            expect(matches.length).toBeGreaterThan(0);
            expect(matches).toEqual(uniqueIds);

            const hits = knowLib.sets.createHitTable<number>();
            await table.getNearestHits(
                "Beethoven",
                hits,
                composerBlocks.length,
            );
            expect(hits.size).toEqual(uniqueIds.length);
            for (const hit of hits.values()) {
                expect(hit.score).toBeGreaterThan(0);
            }

            hits.clear();
            await table.getNearestHitsMultiple(
                ["Beethoven", "Mozart"],
                hits,
                composerBlocks.length,
            );
            expect(hits.size).toEqual(uniqueIds.length);
        },
        testTimeout,
    );

    test(
        "getIds_in_clause",
        async () => {
            // Explicitly tests the IN clause batch lookup path in getIds()
            const table = await createTextIndex<number, number>(
                { caseSensitive: false, concurrency: 2, semanticIndex: false },
                db!,
                "getIds_in_clause",
                "INTEGER",
                "INTEGER",
            );
            const blocks = composers();
            await table.addUpdateMultiple(blocks);

            const texts = blocks.map((b) => b.value);

            // Empty array returns empty
            const emptyResult = await table.getIds([]);
            expect(emptyResult).toEqual([]);

            // Single value lookup via IN clause
            const singleResult = await table.getIds([texts[0]]);
            expect(singleResult).toHaveLength(1);
            expect(singleResult[0]).toBeDefined();

            // Multi-value batch lookup via IN clause preserves order
            const allIds = await table.getIds(texts);
            expect(allIds).toHaveLength(texts.length);
            allIds.forEach((id) => expect(id).toBeDefined());

            // Unknown text maps to undefined
            const withUnknown = await table.getIds([texts[0], "Unknown_XYZ"]);
            expect(withUnknown).toHaveLength(2);
            expect(withUnknown[0]).toBeDefined();
            expect(withUnknown[1]).toBeUndefined();

            // Round-trip: getIds then getText
            const fetchedId = allIds[0]!;
            const fetched = await table.getText(fetchedId);
            expect(fetched).toEqual(texts[0]);
        },
        testTimeout,
    );

    test(
        "getExactHits_join",
        async () => {
            // Explicitly tests the JOIN-based getExactHits() path
            const table = await createTextIndex<number, number>(
                { caseSensitive: false, concurrency: 2, semanticIndex: false },
                db!,
                "getExactHits_join",
                "INTEGER",
                "INTEGER",
            );
            const blocks = composers();
            await table.addUpdateMultiple(blocks);

            // No values returns nothing
            const emptyHits = [...table.getExactHits([])];
            expect(emptyHits).toHaveLength(0);

            // Single value — hits should include all source ids for that value
            const hitsOne = [...table.getExactHits([blocks[0].value])];
            const hitItems0 = hitsOne.map((h) => h.item);
            for (const sourceId of blocks[0].sourceIds!) {
                expect(hitItems0).toContain(sourceId);
            }

            // Multiple values — source ids shared across values score higher
            // blocks[0] (Bach) and blocks[1] (Debussy) both list sourceId 3 and 7
            const sharedSourceId = 3;
            const hitsMulti = [
                ...table.getExactHits([blocks[0].value, blocks[1].value]),
            ];
            const sharedHit = hitsMulti.find((h) => h.item === sharedSourceId);
            const singleHit = hitsMulti.find(
                (h) => h.item === blocks[0].sourceIds![0],
            );
            expect(sharedHit).toBeDefined();
            expect(singleHit).toBeDefined();
            // shared sourceId appears in both → score 2; exclusive → score 1
            expect(sharedHit!.score).toBeGreaterThanOrEqual(singleHit!.score);
        },
        testTimeout,
    );

    test(
        "getNearest_exact_range",
        async () => {
            // This index does *not* have semantic indexing
            const index = await createTextIndex<number, number>(
                { caseSensitive: false, concurrency: 2, semanticIndex: false },
                db!,
                "Exact_Timestamp",
                "INTEGER",
                "INTEGER",
            );
            const log = await createTemporalLogTable<number, number>(
                db!,
                "Exact_Timestamp_Log",
                "INTEGER",
                "INTEGER",
            );
            let timestamps: Date[] = [];
            let totalSourceIds = 0;
            let blocks = composers();
            totalSourceIds += countSourceIds(blocks);
            timestamps.push(await indexBlocks(index, log, blocks, 1));

            blocks = fruits();
            totalSourceIds += countSourceIds(blocks);
            timestamps.push(await indexBlocks(index, log, blocks, 2));

            blocks = composers(1000);
            totalSourceIds += countSourceIds(blocks);
            timestamps.push(await indexBlocks(index, log, blocks, 3));

            const all = await asyncArray.toArray(log.all());
            expect(all).toHaveLength(totalSourceIds);

            const newest = await log.getNewest(1);
            expect(newest.length).toEqual(countSourceIds(blocks));

            const sqlJoin = log.sql_joinRange(timestamps[2]);
            const hits = [...index.getExactHits([blocks[0].value], sqlJoin)];
            expect(hits.map((h) => h.item)).toEqual(blocks[0].sourceIds!);
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

    function compareHitScores(
        hits: Iterable<ScoredItem>,
        expectedHits: HitTable,
    ) {
        for (const hit of hits) {
            const expectedItem = expectedHits.get(hit.item);
            expect(expectedItem).toBeDefined();
            if (expectedItem) {
                expect(hit.score).toEqual(expectedItem.score);
            }
        }
    }

    async function indexBlocks(
        index: TextTable,
        log: TemporalTable,
        blocks: knowLib.TextBlock[],
        day: number,
    ): Promise<Date> {
        const timestamp = new Date(2024, 2, day);
        for (const block of blocks) {
            await index.addUpdate(block.value, block.sourceIds);
            for (const id of block.sourceIds!) {
                await log.put(id, timestamp);
            }
        }
        return timestamp;
    }
});
