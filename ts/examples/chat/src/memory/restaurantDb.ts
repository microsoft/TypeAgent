// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as ms from "memory-storage";

export class RestaurantDb {
    private db: sqlite.Database;
    public geo: GeoTable;
    public restaurants: RestaurantsTable;

    constructor(dbPath: string) {
        this.db = ms.sqlite.createDatabase(dbPath, true);
        this.restaurants = new RestaurantsTable(this.db);
        this.geo = new GeoTable(this.db);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}

export class RestaurantsTable extends ms.sqlite.SqliteDataFrame {
    constructor(db: sqlite.Database) {
        super(db, "restaurant", [
            ["rating", { type: "number" }],
            ["city", { type: "string", index: true }],
            ["country", { type: "string", index: true }],
        ]);
    }
}

export class GeoTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
    }
}
