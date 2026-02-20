// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { removeFile, ensureDir } from "../fileSystem.js";
import { createRequire } from "node:module";

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    // Use Release-Node if available (created by electron-rebuild for Node.js).
    // Otherwise, return undefined to let better-sqlite3's default bindings
    // resolution find the correct native module for the running Node version.
    try {
        const r = createRequire(import.meta.url);
        const betterSqlitePath = r.resolve("better-sqlite3/package.json");
        const releaseNodeBinding = path.join(
            betterSqlitePath,
            "../build/Release-Node/better_sqlite3.node",
        );
        if (fs.existsSync(releaseNodeBinding)) {
            return { nativeBinding: releaseNodeBinding };
        }
    } catch {
        // Fall through to default resolution
    }
    return undefined;
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
