// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

import Database, * as sqlite from "better-sqlite3";

import { SpelunkerContext } from "./spelunkerActionHandler.js";

import { console_log } from "./searchCode.js";

const databaseSchema = `
CREATE TABLE IF NOT EXISTS Files (
    fileName TEXT PRIMARY KEY,
    mtime FLOAT NOT NULL,
    size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS Chunks (
    chunkId TEXT PRIMARY KEY,
    treeName TEXT NOT NULL,
    codeName TEXT NOT NULL,
    parentId TEXT KEY REFERENCES Chunks(chunkId), -- May be null
    fileName TEXT KEY REFERENCES files(fileName) NOT NULL,
    lineNo INTEGER NOT NULL -- 1-based
);
CREATE TABLE IF NOT EXISTS Blobs (
    chunkId TEXT KEY REFERENCES Chunks(chunkId) NOT NULL,
    start INTEGER NOT NULL, -- 0-based
    lines TEXT NOT NULL,
    breadcrumb TEXT -- Chunk ID or empty string or NULL
);
CREATE TABLE IF NOT EXISTS Summaries (
    chunkId TEXT PRIMARY KEY REFERENCES Chunks(chunkId),
    language TEXT, -- "python", "typescript", etc.
    summary TEXT,
    signature TEXT
)
`;

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    const r = createRequire(import.meta.url);
    const betterSqlitePath = r.resolve("better-sqlite3/package.json");
    const nativeBinding = path.join(
        betterSqlitePath,
        "../build/Release/better_sqlite3.n.node",
    );
    return { nativeBinding };
}

export function createDatabase(context: SpelunkerContext): sqlite.Database {
    if (!context.queryContext) {
        throw new Error("context.queryContext must be set before calling createDatabase");
    }
    const loc = context.queryContext.databaseLocation;
    const db0 = context.queryContext.database;
    if (db0) {
        console_log(`  [Using database at ${loc}]`);
        return db0;
    }
    if (fs.existsSync(loc)) {
        console_log(`  [Opening database at ${loc}]`);
    } else {
        console_log(`  [Creating database at ${loc}]`);
    }
    const db = new Database(loc, getDbOptions());
    // Write-Ahead Logging, improving concurrency and performance
    db.pragma("journal_mode = WAL");
    // Fix permissions to be read/write only by the owner
    fs.chmodSync(context.queryContext.databaseLocation, 0o600);
    // Create all the tables we'll use
    db.exec(databaseSchema);
    context.queryContext.database = db;
    return db;
}
