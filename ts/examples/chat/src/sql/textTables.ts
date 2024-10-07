// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
import Database from "better-sqlite3";
import fs from "fs";

export type TextTableId = bigint;
export type TextId = bigint;

export interface TextTables {
    getTableId(name: string): TextTableId | undefined;
    addTable(name: string): TextTableId;
    getTextId(
        tableIdOrName: TextTableId | string,
        value: string,
    ): TextId | undefined;
    addText(
        tableIdOrName: TextTableId | string,
        value: string,
    ): TextId | undefined;
}

export function createTextTables(filePath: string): TextTables {
    const isNew = !fs.existsSync(filePath);
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");

    const schemaSql =
        `  
    CREATE TABLE IF NOT EXISTS TextTableNames (  
      tableId INTEGER PRIMARY KEY AUTOINCREMENT,  
      name TEXT UNIQUE NOT NULL  
    );` +
        `  
    CREATE TABLE IF NOT EXISTS TextTables (  
      textId INTEGER PRIMARY KEY AUTOINCREMENT,
      tableId INTEGER,  
      value TEXT NOT NULL,
      UNIQUE(tableId, value)  
    );`;

    if (isNew) {
        ensureDb();
    }
    const queries: any = {
        getTableId: db.prepare(
            "SELECT tableId from TextTableNames where name = ?",
        ),
        addTable: db.prepare(
            "INSERT OR IGNORE INTO TextTableNames (name) VALUES (?)",
        ),
        getTextId: db.prepare(
            "SELECT textId from TextTables where tableId = ? and value = ?",
        ),
        addText: db.prepare(
            "INSERT OR IGNORE INTO TextTables (tableId, value) VALUES (?, ?)",
        ),
    };

    return {
        getTableId,
        addTable,
        getTextId,
        addText,
    };

    function getTableId(name: string): TextTableId | undefined {
        const row: any = queries.getTableId.get(name);
        return row ? row.tableId : undefined;
    }

    function addTable(name: string): TextTableId {
        return rowId(queries.addTable.run(name));
    }

    function getTextId(
        tableIdOrName: TextTableId | string,
        value: string,
    ): TextId | undefined {
        if (!value) {
            return undefined;
        }
        let tableId =
            typeof tableIdOrName === "string"
                ? getTableId(tableIdOrName)
                : tableIdOrName;
        return tableId
            ? rowId(queries.getTextId.run(tableId, value))
            : undefined;
    }

    function addText(
        tableIdOrName: TextTableId | string,
        value: string,
    ): TextId | undefined {
        if (!value) {
            return undefined;
        }
        let tableId =
            typeof tableIdOrName === "string"
                ? getTableId(tableIdOrName)
                : tableIdOrName;
        return tableId ? rowId(queries.addText.run(tableId, value)) : undefined;
    }

    function ensureDb() {
        db.exec(schemaSql);
    }

    function rowId(result: Database.RunResult): bigint {
        return result.lastInsertRowid as bigint;
    }
}
*/
