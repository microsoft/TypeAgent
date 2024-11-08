// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { composers, ensureTestDir, testFilePath } from "./testCore.js";
import { createDatabase } from "../src/sqlite/common.js";
import { createTemporalLogTable } from "../src/sqlite/temporalTable.js";

describe("sqlite.temporalTable", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;
    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("temporal.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });

    test(
        "addIds",
        async () => {
            const table = createTemporalLogTable(
                db!,
                "idLog",
                "INTEGER",
                "TEXT",
            );
            const blocks = composers();
            let timestamps: Date[] = [];
            let allIds: number[] = [];
            const addCount = 100;
            for (let i = 1; i <= addCount; ++i) {
                let timestamp = new Date(2024, 1, 1, i);
                timestamps.push(timestamp);
                let ids = blocks.map((b) =>
                    table.addSync(b.sourceIds, timestamp),
                );
                expect(ids).toHaveLength(blocks.length);
                allIds.push(...ids);
            }
            const size = await table.size();
            expect(size).toEqual(allIds.length);

            const windowLength = 8;
            const latest = [...table.iterateNewest(windowLength)];
            expect(latest).toHaveLength(windowLength * blocks.length);
            expect(latest[0].timestamp).toEqual(
                timestamps[timestamps.length - 1],
            );

            const oldest = [...table.iterateOldest(windowLength)];
            expect(oldest).toHaveLength(windowLength * blocks.length);
            expect(oldest[0].timestamp).toEqual(timestamps[0]);

            const iStart = 1;
            const iEnd = timestamps.length / 2;
            const entries = await table.getEntriesInRange(
                timestamps[iStart],
                timestamps[iEnd],
            );
            expect(entries).toHaveLength((iEnd - iStart + 1) * blocks.length);
        },
        testTimeout,
    );
    test("addIds_number", async () => {
        const table = createTemporalLogTable<number, number>(
            db!,
            "idLog_number",
            "INTEGER",
            "INTEGER",
        );
        let ids = [1, 2, 3, 4, 5];
        let timestamp = new Date();
        for (const id of ids) {
            table.addSync(id, timestamp);
        }
        ids = [6, 7, 8];
        timestamp = new Date();
        for (const id of ids) {
            table.addSync(id, timestamp);
        }
        const rows = await table.getNewest(1);
        expect(rows.length).toBeGreaterThan(0);
    });
});
