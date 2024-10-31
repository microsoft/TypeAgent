// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

import { ColumnType, SqlColumnType, tablePath } from "./common.js";
import { createKeyValueIndex } from "./keyValueIndex.js";
import {
    TextBlock,
    TextBlockType,
    TextIndex,
    TextIndexSettings,
} from "knowledge-processor";
/*
import { createSemanticIndex, SemanticIndex } from "typeagent";
import { createVectorStore } from "./semanticIndex.js";
*/
export type StringTableRow = {
    stringId: number;
    value: string;
};

export interface StringTable {
    readonly schemaSql: string;
    ids(): IterableIterator<number>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<StringTableRow>;
    getId(value: string): number | undefined;
    getText(id: number): string | undefined;
    add(value: string): number;
    remove(value: string): void;
}

export function createStringTable(
    db: sqlite.Database,
    tableName: string,
    caseSensitive: boolean = false,
    ensureExists: boolean = true,
): StringTable {
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      stringId INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT ${caseSensitive ? "COLLATE NOCASE" : ""} NOT NULL,
      UNIQUE(value)  
    );`;

    if (ensureExists) {
        db.exec(schemaSql);
    }

    const sql_entries = db.prepare(`SELECT * from ${tableName}`);
    const sql_ids = db.prepare(`SELECT stringId from ${tableName}`);
    const sql_values = db.prepare(`SELECT value from ${tableName}`);
    const sql_getId = db.prepare(
        `SELECT stringId from ${tableName} WHERE value = ?`,
    );
    const sql_getText = db.prepare(
        `SELECT value from ${tableName} WHERE stringId = ?`,
    );
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (value) VALUES (?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE value = ?`);
    return {
        schemaSql,
        ids,
        values,
        entries,
        getId,
        getText,
        add,
        remove,
    };

    function* entries(): IterableIterator<StringTableRow> {
        for (const row of sql_entries.iterate()) {
            yield row as StringTableRow;
        }
    }

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

    function getText(id: number): string | undefined {
        const row: StringTableRow = sql_getText.get(id) as StringTableRow;
        return row ? row.value : undefined;
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
}

export interface TextTable<TTextId = any, TSourceId = any>
    extends TextIndex<TTextId, TSourceId> {}

export async function createTextIndex<TSourceId extends ColumnType = string>(
    settings: TextIndexSettings,
    db: sqlite.Database,
    name: string,
    valueType: SqlColumnType<TSourceId>,
) {
    type TextId = number;
    const textTable = createStringTable(db, tablePath(name, "entries"));
    const postingsTable = createKeyValueIndex<number, TSourceId>(
        db,
        tablePath(name, "postings"),
        "INTEGER",
        valueType,
    );
    /*
    let semanticIndex: SemanticIndex<TextId> | undefined;
    if (settings.semanticIndex !== undefined && settings.semanticIndex) {
        const store = createVectorStore<TextId>(
            db,
            tablePath(name, "embeddings"),
            "INTEGER",
        );
        semanticIndex = createSemanticIndex<TextId>(
            store,
            settings.embeddingModel,
        );
    }
        */
    return {
        text,
        ids,
        entries,
        get,
        getById,
        getByIds,
        getId,
        getIds,
        getText,
        getTextMultiple,
        put,
        putMultiple,
    };

    async function* text(): AsyncIterableIterator<string> {
        for (const value of textTable.values()) {
            yield value;
        }
    }

    async function* ids(): AsyncIterableIterator<TextId> {
        for (const value of textTable.ids()) {
            yield value;
        }
    }

    async function* entries(): AsyncIterableIterator<TextBlock<TSourceId>> {
        for (const entry of textTable.entries()) {
            yield {
                type: TextBlockType.Sentence,
                value: entry.value,
                sourceIds: await postingsTable.get(entry.stringId),
            };
        }
    }

    async function get(text: string): Promise<TSourceId[] | undefined> {
        const textId = textTable.getId(text);
        if (textId) {
            return postingsTable.getSync(textId);
        }
        return undefined;
    }

    async function getById(id: TextId): Promise<TSourceId[] | undefined> {
        return postingsTable.getSync(id);
    }

    async function getByIds(
        ids: TextId[],
    ): Promise<(TSourceId[] | undefined)[]> {
        const postings = ids.map((id) => postingsTable.getSync(id));
        return postings;
    }

    async function getId(text: string): Promise<TextId | undefined> {
        return textTable.getId(text);
    }

    async function getIds(texts: string[]): Promise<(TextId | undefined)[]> {
        return texts.map((t) => textTable.getId(t));
    }

    async function getText(id: TextId): Promise<string | undefined> {
        return textTable.getText(id);
    }

    async function getTextMultiple(
        ids: TextId[],
    ): Promise<(string | undefined)[]> {
        return ids.map((id) => textTable.getText(id));
    }

    async function put(text: string, postings?: TSourceId[]): Promise<TextId> {
        return putSync(text, postings);
    }

    async function putMultiple(
        blocks: TextBlock<TSourceId>[],
    ): Promise<TextId[]> {
        const ids: TextId[] = [];
        for (const b of blocks) {
            const id = putSync(b.value, b.sourceIds);
            ids.push(id);
        }
        return ids;
    }

    function putSync(text: string, postings?: TSourceId[]): TextId {
        let textId = textTable.add(text);
        if (postings && postings.length > 0) {
            postingsTable.putSync(postings, textId);
        }
        return textId;
    }
}
