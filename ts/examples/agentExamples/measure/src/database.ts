// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { removeFile } from "typeagent";

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

export async function createDatabase(
    filePath: string,
    createNew: boolean,
): Promise<sqlite.Database> {
    if (createNew) {
        await deleteDatabase(filePath);
    }
    const db = new Database(filePath, getDbOptions());
    db.pragma("journal_mode = WAL");
    return db;
}

async function deleteDatabase(filePath: string): Promise<void> {
    await removeFile(filePath);
    await removeFile(filePath + "-shm");
    await removeFile(filePath + "-wal");
}

export function sql_makeInClause(values: any[]): string {
    let sql = "";
    for (let i = 0; i < values.length; ++i) {
        if (i > 0) {
            sql += ", ";
        }
        sql += `'${values[i]}'`;
    }
    return sql;
}

export function sql_appendCondition(
    sql: string,
    condition: string,
    and: boolean = true,
) {
    if (sql) {
        sql += and ? " AND " : " OR ";
    }
    sql += condition;
    sql += "\n";
    return sql;
}
