// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDbPath } from "test-lib";
import * as kp from "knowpro";
import { SqliteStorageProvider } from "../src/sqlite/sqliteProvider.js";

describe("memory.sqlite.dataFrame", () => {
    test("end2end", () => {
        const dfPath = getDbPath("dfFrame.db");
        const db = new TestDb(dfPath, true);
        try {
            kp.dataFrame.addRowToFrame(db.locations, 1, {
                latitude: "53.33",
                longitude: "55.4",
            });
            kp.dataFrame.addRowToFrame(db.locations, 1, {
                latitude: "43.45",
                longitude: "55.4",
            });
            let rows = db.locations.getRow(
                "latitude",
                "53.33",
                kp.ComparisonOp.Eq,
            );
            expect(rows).toBeDefined();
            expect(rows).toHaveLength(1);

            rows = db.locations.getRow("longitude", "55.4", kp.ComparisonOp.Eq);
            expect(rows).toBeDefined();
            expect(rows).toHaveLength(2);
        } finally {
            db.close();
        }
    });
});

export class TestDb {
    private dbProvider: SqliteStorageProvider;
    public locations: kp.dataFrame.IDataFrame;

    constructor(dbPath: string, createNew: boolean) {
        this.dbProvider = new SqliteStorageProvider(dbPath, createNew);
        this.locations = this.dbProvider.createDataFrame("locations", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
    }

    public close() {
        if (this.dbProvider) {
            this.dbProvider.close();
        }
    }
}
