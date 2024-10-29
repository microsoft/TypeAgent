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
): StringTable {
    ensureTable();

    const idSql = db.prepare(`SELECT stringId from ${tableName}`);
    const valuesSql = db.prepare(`SELECT value from ${tableName}`);
    const getIdSql = db.prepare(
        `SELECT stringId from ${tableName} where value = ?`,
    );
    const addSql = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (value) VALUES (?)`,
    );
    const removeSql = db.prepare(`DELETE FROM ${tableName} WHERE value = ?`);

    return {
        ids,
        values,
        getId,
        add,
        remove,
    };

    function ensureTable() {
        const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      stringId INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL,
      UNIQUE(value)  
    );`;
        db.exec(schemaSql);
    }

    function* ids(): IterableIterator<number> {
        for (const id of idSql.iterate()) {
            yield id as number;
        }
    }

    function* values(): IterableIterator<string> {
        for (const value of valuesSql.iterate()) {
            yield value as string;
        }
    }

    function getId(value: string): number | undefined {
        const row: StringTableRow = getIdSql.get(value) as StringTableRow;
        return row ? row.stringId : undefined;
    }

    function add(value: string): number {
        if (!value) {
            throw Error("value is empty");
        }
        return addSql.run(value).lastInsertRowid as number;
    }

    function remove(value: string) {
        removeSql.run(value);
    }
    type StringTableRow = {
        stringId: number;
        value: string;
    };
}
