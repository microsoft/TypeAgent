// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { checkHistoryRecords } from "./viewHistoryRecordsTestCommon.js";

test.each([100, 1000])(
    "%i commits match legacy ordering and exact records without parsing unrelated state",
    async (count) => {
        const root = await mkdtemp(
            path.join(process.cwd(), ".b12-view-records-regression-"),
        );
        try {
            await checkHistoryRecords(root, count);
        } finally {
            import.meta.jest.restoreAllMocks();
            await rm(root, { recursive: true, force: true });
        }
    },
    180_000,
);
