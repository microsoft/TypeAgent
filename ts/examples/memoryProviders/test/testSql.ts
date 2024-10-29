// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
import { ensureDir, removeFile } from "typeagent";
import {
    createTextTables,
    TextTableId,
    TextTables,
} from "../sql/textTables.js";
import path from "path";

export async function testStringTables() {
    const rootDir = "/data/test/sql";
    await ensureDir(rootDir);
    const tablePath = path.join(rootDir, "strings.db");
    await removeFile(tablePath);

    const tableName = "entity.names";
    const tables = createTextTables(tablePath);
    let tableId = tables.getTableId(tableName);
    if (!tableId) {
        tableId = tables.addTable(tableName);
    }
    console.log(tableId);

    tableId = tables.addTable(tableName);
    console.log(tableId);

    testAdd(tables, tableId, "One");
    testAdd(tables, tableId, "Two");
}

function testAdd(db: TextTables, tableId: TextTableId, text: string) {
    let addedId = db.addText(tableId, text);
    let gotId = db.getTextId(tableId, text);
    console.log(`${addedId}, ${gotId}`);
    addedId = db.addText(tableId, text);
    console.log(addedId);
}

*/
