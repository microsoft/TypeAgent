// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { removeFile, ensureDir } from "../fileSystem.js";
import { createRequire } from "node:module";

type BetterSqlite3Ctor = new (
    filePath: string,
    options?: unknown,
) => sqlite.Database;

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

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    const r = createRequire(import.meta.url);
    const betterSqlitePath = r.resolve("better-sqlite3/package.json");
    const nativeBinding = path.join(
        betterSqlitePath,
        "../prebuild-node/better_sqlite3.node",
    );
    // Fall back to default (build/Release) when prebuild-node doesn't exist
    if (!fs.existsSync(nativeBinding)) {
        return undefined;
    }
    return { nativeBinding };
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
    const db = new Database(filePath, getDbOptions());
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
