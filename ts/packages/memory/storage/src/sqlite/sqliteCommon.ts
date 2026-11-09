// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import path from "node:path";
import { removeFile, ensureDir } from "../fileSystem.js";
import { createRequire } from "node:module";

type BetterSqlite3Ctor = new (filePath: string) => sqlite.Database;

let sqliteCtor: BetterSqlite3Ctor | undefined;

function getSqliteCtor(): BetterSqlite3Ctor {
    if (!sqliteCtor) {
        try {
            const r = createRequire(import.meta.url);
            sqliteCtor = r("better-sqlite3") as BetterSqlite3Ctor;
        } catch (error) {
            const details =
                error instanceof Error ? error.message : String(error);
            throw new Error(
                `SQLite support is unavailable because 'better-sqlite3' could not be loaded. Install 'better-sqlite3' to enable persistent SQLite storage. Details: ${details}`,
            );
        }
    }
    return sqliteCtor;
}

export function createDatabase(
    filePath: string,
    createNew: boolean,
): sqlite.Database {
    if (createNew) {
        deleteDatabase(filePath);
    }
    ensureDir(path.dirname(filePath));
    const Database = getSqliteCtor();
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");
    return db;
}

export function deleteDatabase(filePath: string): void {
    removeFile(filePath);
    removeFile(filePath + "-shm");
    removeFile(filePath + "-wal");
}

export function tablePath(rootName: string, name: string): string {
    return rootName + "_" + name;
}

export function sql_makeInPlaceholders(count: number): string {
    if (count > 1) {
        let placeholder = "?, ".repeat(count - 1);
        placeholder += "?";
        return placeholder;
    }
    return "?";
}
