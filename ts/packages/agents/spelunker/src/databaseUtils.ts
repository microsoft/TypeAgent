// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";

import Database, * as sqlite from "better-sqlite3";

import { SpelunkerContext } from "./spelunkerActionHandler.js";

import { console_log } from "./logging.js";

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
    fileName TEXT KEY REFERENCES Files(fileName) NOT NULL,
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
);
CREATE TABLE IF NOT EXISTS ChunkEmbeddings (
    chunkId TEXT PRIMARY KEY REFERENCES Chunks(chunkId),
    embedding BLOB NOT NULL
);
`;

export function createDatabase(context: SpelunkerContext): void {
    if (!context.queryContext) {
        throw new Error(
            "context.queryContext must be set before calling createDatabase",
        );
    }
    const loc = context.queryContext.databaseLocation;
    if (context.queryContext.database) {
        console_log(`[Using database at ${loc}]`);
        return;
    }
    if (fs.existsSync(loc)) {
        console_log(`[Opening database at ${loc}]`);
    } else {
        console_log(`[Creating database at ${loc}]`);
    }
    const db = new Database(loc);
    // Write-Ahead Logging, improving concurrency and performance
    db.pragma("journal_mode = WAL");
    // Fix permissions to be read/write only by the owner
    fs.chmodSync(context.queryContext.databaseLocation, 0o600);
    // Create all the tables we'll use
    db.exec(databaseSchema);
    context.queryContext.database = db;
}

export function purgeFile(db: sqlite.Database, fileName: string): void {
    const prepDeleteEmbeddings = db.prepare(`
        DELETE FROM ChunkEmbeddings WHERE chunkId IN (
            SELECT chunkId
            FROM chunks
            WHERE filename = ?
        )
    `);
    const prepDeleteSummaries = db.prepare(`
        DELETE FROM Summaries WHERE chunkId IN (
            SELECT chunkId
            FROM chunks
            WHERE fileName = ?
        )
    `);
    const prepDeleteBlobs = db.prepare(`
        DELETE FROM Blobs WHERE chunkId IN (
            SELECT chunkId
            FROM chunks
            WHERE filename = ?
        )
    `);
    const prepDeleteChunks = db.prepare(
        `DELETE FROM Chunks WHERE fileName = ?`,
    );
    const prepDeleteFiles = db.prepare(`DELETE FROM files WHERE fileName = ?`);

    db.exec(`BEGIN TRANSACTION`);
    prepDeleteSummaries.run(fileName);
    prepDeleteBlobs.run(fileName);
    prepDeleteEmbeddings.run(fileName);
    prepDeleteChunks.run(fileName);
    prepDeleteFiles.run(fileName);
    db.exec(`COMMIT`);
}
