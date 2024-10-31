// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

import {
    AssignedId,
    ColumnType,
    createInQuery,
    SqlColumnType,
    tablePath,
} from "./common.js";
import { createKeyValueTable } from "./keyValueTable.js";
import {
    TextBlock,
    TextBlockType,
    TextIndex,
    TextIndexSettings,
} from "knowledge-processor";
import {
    createSemanticIndex,
    ScoredItem,
    SemanticIndex,
    VectorStore,
} from "typeagent";
import { createVectorTable } from "./vectorTable.js";
import * as knowLib from "knowledge-processor";

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
    getTextMultiple(ids: number[]): IterableIterator<string>;
    add(value: string): AssignedId<number>;
    add(values: string[]): AssignedId<number>[];
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
      value TEXT ${caseSensitive ? "" : "COLLATE NOCASE"} NOT NULL,
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
        getTextMultiple,
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
            yield (value as StringTableRow).value;
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

    function* getTextMultiple(ids: number[]): IterableIterator<string> {
        if (ids.length > 0) {
            const stmt = createInQuery(db, tableName, "value", "stringId", ids);
            let rows = stmt.iterate();
            for (const row of rows) {
                yield (row as StringTableRow).value;
            }
        }
    }

    function add(values: string[]): AssignedId<number>[];
    function add(value: string): AssignedId<number>;
    function add(
        values: string | string[],
    ): AssignedId<number> | AssignedId<number>[] {
        if (typeof values === "string") {
            return addOne(values);
        } else {
            const ids: AssignedId<number>[] = [];
            for (const value of values) {
                ids.push(addOne(value));
            }
            return ids;
        }
    }
    function addOne(value: string): AssignedId<number> {
        if (!value) {
            throw Error("value is empty");
        }
        const result = sql_add.run(value);
        if (result.changes > 0) {
            return { id: result.lastInsertRowid as number, isNew: true };
        }
        const row = sql_getId.get(value) as StringTableRow;
        return { id: row.stringId, isNew: false };
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
    const postingsTable = createKeyValueTable<number, TSourceId>(
        db,
        tablePath(name, "postings"),
        "INTEGER",
        valueType,
    );
    let [vectorStore, semanticIndex] =
        settings.semanticIndex !== undefined && settings.semanticIndex
            ? createVectorIndex()
            : [undefined, undefined];

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
        getNearest,
        put,
        putMultiple,
        nearestNeighbors,
        nearestNeighborsText,
    };

    function createVectorIndex(): [VectorStore<TextId>, SemanticIndex<TextId>] {
        const store = createVectorTable<TextId>(
            db,
            tablePath(name, "embeddings"),
            "INTEGER",
        );
        const index = createSemanticIndex<TextId>(
            store,
            settings.embeddingModel,
        );
        return [store, index];
    }

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
                sourceIds: postingsTable.getSync(entry.stringId),
            };
        }
    }

    function get(text: string): Promise<TSourceId[] | undefined> {
        return Promise.resolve(getSync(text));
    }

    function getSync(text: string): TSourceId[] | undefined {
        const textId = textTable.getId(text);
        if (textId) {
            return postingsTable.getSync(textId);
        }
        return undefined;
    }

    function getById(id: TextId): Promise<TSourceId[] | undefined> {
        return postingsTable.get(id);
    }

    function getByIds(ids: TextId[]): Promise<(TSourceId[] | undefined)[]> {
        const postings = ids.map((id) => postingsTable.getSync(id));
        return Promise.resolve(postings);
    }

    function getId(text: string): Promise<TextId | undefined> {
        return Promise.resolve(textTable.getId(text));
    }

    function getIds(texts: string[]): Promise<(TextId | undefined)[]> {
        // TODO: use IN clause
        return Promise.resolve(texts.map((t) => textTable.getId(t)));
    }

    function getText(id: TextId): Promise<string | undefined> {
        return Promise.resolve(textTable.getText(id));
    }

    function getTextMultiple(ids: TextId[]): Promise<(string | undefined)[]> {
        return Promise.resolve(ids.map((id) => textTable.getText(id)));
    }

    async function put(text: string, postings?: TSourceId[]): Promise<TextId> {
        let assignedId = textTable.add(text);
        if (postings && postings.length > 0) {
            postingsTable.putSync(postings, assignedId.id);
        }
        if (
            semanticIndex &&
            (assignedId.isNew || !vectorStore?.exists(assignedId.id))
        ) {
            await semanticIndex.put(text, assignedId.id);
        }
        return assignedId.id;
    }

    async function putMultiple(
        blocks: TextBlock<TSourceId>[],
    ): Promise<TextId[]> {
        const ids: TextId[] = [];
        for (const b of blocks) {
            const id = await put(b.value, b.sourceIds);
            ids.push(id);
        }
        return ids;
    }

    async function getNearest(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]> {
        maxMatches ??= 1;
        // Check exact match first
        let matchedIds: TextId[] | undefined;

        let exactId = textTable.getId(value);
        if (exactId) {
            matchedIds = [exactId];
        }
        let nearestIds: TextId[] | undefined;
        if (maxMatches > 1) {
            nearestIds = await getNearestTextIds(value, maxMatches, minScore);
        } else if (!exactId) {
            const nearestId = await getNearestTextId(value, minScore);
            if (nearestId) {
                nearestIds = [nearestId];
            }
        }
        matchedIds = knowLib.sets.unionArrays(matchedIds, nearestIds);
        if (matchedIds && matchedIds.length > 0) {
            // Iterate over matched postings
            const postings = postingsTable.iterateMultiple(matchedIds);
            if (postings) {
                return [...postings];
            }
        }
        return [];
    }

    async function nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TSourceId[]>[]> {
        const matches = await nearestNeighborsText(value, maxMatches, minScore);
        const scoredPostings = matches.map((m) => {
            const item = postingsTable.getSync(m.item) ?? [];
            return {
                score: m.score,
                item,
            };
        });
        return scoredPostings;
    }

    async function nearestNeighborsText(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TextId>[]> {
        if (!semanticIndex) {
            return [];
        }
        let matches = await semanticIndex.nearestNeighbors(
            value,
            maxMatches,
            minScore,
        );
        // Also do an exact match
        let textId = textTable.getId(value);
        if (textId) {
            // Remove prior match
            const pos = matches.findIndex((m) => m.item === textId);
            if (pos >= 0) {
                matches.splice(pos, 1);
            }
            matches.splice(0, 0, { score: 1.0, item: textId });
        }
        return matches;
    }

    async function getNearestTextId(
        value: string,
        minScore?: number,
    ): Promise<TextId | undefined> {
        if (semanticIndex) {
            const nearest = await semanticIndex.nearestNeighbor(
                value,
                minScore,
            );
            return nearest ? nearest.item : undefined;
        }
        return undefined;
    }

    async function getNearestTextIds(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<TextId[] | undefined> {
        if (semanticIndex) {
            const scoredTextIds = await semanticIndex.nearestNeighbors(
                value,
                maxMatches,
                minScore,
            );
            return scoredTextIds.map((s) => s.item);
        }
        return undefined;
    }
}
