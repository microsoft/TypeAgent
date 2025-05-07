// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { createRequire } from "node:module";
import path from "node:path";
import { removeFile, ensureDir } from "../fileSystem.js";

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    const r = createRequire(import.meta.url);
    const betterSqlitePath = r.resolve("better-sqlite3/package.json");
    const nativeBinding = path.join(
        betterSqlitePath,
        "../build/Release-Node/better_sqlite3.node",
    );
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
