// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

export interface StringTable {
    ids(): IterableIterator<number>;
    values(): IterableIterator<string>;
    getId(value: string): number | undefined;
    add(value: string): number;
    remove(value: string): void;
}

export function createStringTable(
    db: sqlite.Database,
    tableName: string,
    ensureExists: boolean = true,
): StringTable {
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      stringId INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL,
      UNIQUE(value)  
    );`;

    if (ensureExists) {
        db.exec(schemaSql);
    }

    const sql_ids = db.prepare(`SELECT stringId from ${tableName}`);
    const sql_values = db.prepare(`SELECT value from ${tableName}`);
    const sql_getId = db.prepare(
        `SELECT stringId from ${tableName} WHERE value = ?`,
    );
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (value) VALUES (?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE value = ?`);
    return {
        ids,
        values,
        getId,
        add,
        remove,
    };

    function* ids(): IterableIterator<number> {
        for (const id of sql_ids.iterate()) {
            yield id as number;
        }
    }

    function* values(): IterableIterator<string> {
        for (const value of sql_values.iterate()) {
            yield value as string;
        }
    }

    function getId(value: string): number | undefined {
        const row: StringTableRow = sql_getId.get(value) as StringTableRow;
        return row ? row.stringId : undefined;
    }

    function add(value: string): number {
        if (!value) {
            throw Error("value is empty");
        }
        const result = sql_add.run(value);
        if (result.changes > 0) {
            return result.lastInsertRowid as number;
        }
        const row = sql_getId.get(value) as StringTableRow;
        return row.stringId;
    }

    function remove(value: string) {
        sql_remove.run(value);
    }

    type StringTableRow = {
        stringId: number;
        value: string;
    };
}
