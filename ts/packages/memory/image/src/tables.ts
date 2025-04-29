// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sqlite from "better-sqlite3";
import * as ms from "memory-storage";

export class GeoTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
    }
}

export class ExposureTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "exposure", [
            ["shutterSpeed", { type: "number" }],
            ["aperature", { type: "number" }]
        ]);
    }
}