// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { removeFile } from "typeagent";

export async function createDatabase(
    filePath: string,
    createNew: boolean,
): Promise<sqlite.Database> {
    if (createNew) {
        await deleteDatabase(filePath);
    }
    const db = new Database(filePath);
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
