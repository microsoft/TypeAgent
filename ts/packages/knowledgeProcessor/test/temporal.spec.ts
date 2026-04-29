// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "path";
import { cleanDir } from "typeagent";
import { createTemporalLog } from "../src/temporal.js";

function testRootPath(name: string) {
    return path.join(os.tmpdir(), "knowProc-tests", name);
}

describe("temporal.getTimeRange", () => {
    const settings = { concurrency: 2 };

    test("returns undefined for empty log", async () => {
        const folderPath = testRootPath("temporal-empty");
        await cleanDir(folderPath);
        const log = await createTemporalLog<string>(settings, folderPath);
        const range = await log.getTimeRange();
        expect(range).toBeUndefined();
    });

    test("returns correct range after entries are added", async () => {
        const folderPath = testRootPath("temporal-range");
        await cleanDir(folderPath);
        const log = await createTemporalLog<string>(settings, folderPath);

        const t1 = new Date("2024-01-01T00:00:00Z");
        const t2 = new Date("2024-06-15T00:00:00Z");
        const t3 = new Date("2024-12-31T00:00:00Z");
        await log.put("first", t1);
        await log.put("second", t2);
        await log.put("last", t3);

        const range = await log.getTimeRange();
        expect(range).toBeDefined();
        expect(range!.startDate.toISOString()).toBe(t1.toISOString());
        expect(range!.stopDate!.toISOString()).toBe(t3.toISOString());
    });

    test("caches and returns consistent result on repeated calls", async () => {
        const folderPath = testRootPath("temporal-cache");
        await cleanDir(folderPath);
        const log = await createTemporalLog<string>(settings, folderPath);

        const t1 = new Date("2024-03-01T00:00:00Z");
        const t2 = new Date("2024-09-01T00:00:00Z");
        await log.put("alpha", t1);
        await log.put("beta", t2);

        const range1 = await log.getTimeRange();
        const range2 = await log.getTimeRange();
        // Both calls return the same object (cached)
        expect(range1).toBe(range2);
    });

    test("invalidates cache after put", async () => {
        const folderPath = testRootPath("temporal-invalidate-put");
        await cleanDir(folderPath);
        const log = await createTemporalLog<string>(settings, folderPath);

        const t1 = new Date("2024-01-01T00:00:00Z");
        await log.put("first", t1);
        const before = await log.getTimeRange();
        expect(before!.stopDate!.toISOString()).toBe(t1.toISOString());

        const t2 = new Date("2024-12-01T00:00:00Z");
        await log.put("second", t2);
        const after = await log.getTimeRange();
        expect(after!.stopDate!.toISOString()).toBe(t2.toISOString());
    });

    test("invalidates cache after clear", async () => {
        const folderPath = testRootPath("temporal-invalidate-clear");
        await cleanDir(folderPath);
        const log = await createTemporalLog<string>(settings, folderPath);

        const t1 = new Date("2024-05-01T00:00:00Z");
        await log.put("entry", t1);
        const before = await log.getTimeRange();
        expect(before).toBeDefined();

        await log.clear();
        const after = await log.getTimeRange();
        expect(after).toBeUndefined();
    });
});
