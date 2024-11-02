// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

import {
    AssignedId,
    ColumnType,
    getTypeSerializer,
    sql_makeInClause,
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
    asyncArray,
    collections,
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
    readonly tableName: string;
    readonly schemaSql: string;
    ids(): IterableIterator<number>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<StringTableRow>;
    exists(value: string): boolean;
    getId(value: string): number | undefined;
    getIds(value: string[]): IterableIterator<number>;
    getText(id: number): string | undefined;
    getTexts(ids: number[]): IterableIterator<string>;
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
    const sql_exists = db.prepare(`SELECT 1 from ${tableName} WHERE value = ?`);
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
        tableName,
        schemaSql,
        ids,
        values,
        entries,
        exists,
        getId,
        getIds,
        getText,
        getTexts,
        add,
        remove,
    };

    function* entries(): IterableIterator<StringTableRow> {
        for (const row of sql_entries.iterate()) {
            yield row as StringTableRow;
        }
    }

    function* ids(): IterableIterator<number> {
        for (const row of sql_ids.iterate()) {
            yield (row as StringTableRow).stringId;
        }
    }

    function* values(): IterableIterator<string> {
        for (const row of sql_values.iterate()) {
            yield (row as StringTableRow).value;
        }
    }

    function exists(value: string): boolean {
        const row = sql_exists.get(value);
        return row !== undefined;
    }

    function getId(value: string): number | undefined {
        const row: StringTableRow = sql_getId.get(value) as StringTableRow;
        return row ? row.stringId : undefined;
    }

    function* getIds(values: string[]): IterableIterator<number> {
        if (values.length > 0) {
            const inClause = sql_makeInClause(values);
            const sql = `SELECT stringId from ${tableName} WHERE value IN (${inClause})`;
            const stmt = db.prepare(sql);
            let rows = stmt.all();
            for (const row of rows) {
                yield (row as StringTableRow).stringId;
            }
        }
    }

    function getText(id: number): string | undefined {
        const row: StringTableRow = sql_getText.get(id) as StringTableRow;
        return row ? row.value : undefined;
    }

    function* getTexts(ids: number[]): IterableIterator<string> {
        if (ids.length > 0) {
            const stmt = db.prepare(
                `SELECT value from ${tableName} WHERE stringId IN (${ids})`,
            );
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
    extends TextIndex<TTextId, TSourceId> {
    getHitsSync(values: string[]): IterableIterator<ScoredItem<TSourceId>>;
}

export async function createTextIndex<
    TTextId extends ColumnType = number,
    TSourceId extends ColumnType = string,
>(
    settings: TextIndexSettings,
    db: sqlite.Database,
    baseName: string,
    textType: SqlColumnType<TTextId>,
    valueType: SqlColumnType<TSourceId>,
    ensureExists: boolean = true,
): Promise<TextTable<TTextId, TSourceId>> {
    type TextId = number;
    const [isIdInt, serializer] = getTypeSerializer<TTextId>(textType);
    const textTable = createStringTable(
        db,
        tablePath(baseName, "entries"),
        ensureExists,
    );
    const postingsTable = createKeyValueTable<number, TSourceId>(
        db,
        tablePath(baseName, "postings"),
        "INTEGER",
        valueType,
        ensureExists,
    );
    const sql_getPostings = db.prepare(
        `SELECT valueId 
         FROM ${textTable.tableName} 
         INNER JOIN ${postingsTable.tableName} 
         ON keyId = stringId          
         WHERE value = ?`,
    );

    let [vectorStore, semanticIndex] =
        settings.semanticIndex !== undefined && settings.semanticIndex
            ? createVectorIndex()
            : [undefined, undefined];

    return {
        text: () => textTable.values(),
        ids,
        entries,
        get,
        getById,
        getByIds,
        getId,
        getIds,
        getText,
        getHitsSync,
        getNearest,
        getNearestMultiple,
        getNearestText,
        getNearestHits,
        getNearestHitsMultiple,
        put,
        putMultiple,
        nearestNeighbors,
        nearestNeighborsText,
        remove,
    };

    function createVectorIndex(): [VectorStore<TextId>, SemanticIndex<TextId>] {
        const store = createVectorTable<TextId>(
            db,
            tablePath(baseName, "embeddings"),
            "INTEGER",
        );
        const index = createSemanticIndex<TextId>(
            store,
            settings.embeddingModel,
        );
        return [store, index];
    }

    async function* ids(): AsyncIterableIterator<TTextId> {
        for (const value of textTable.ids()) {
            yield serializer.serialize(value);
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
        const rows = sql_getPostings.all(text);
        return rows.length > 0
            ? rows.map((r) => (r as any).valueId)
            : undefined;
    }

    function getById(id: TTextId): Promise<TSourceId[] | undefined> {
        return postingsTable.get(serializer.deserialize(id));
    }

    function getByIds(ids: TTextId[]): Promise<(TSourceId[] | undefined)[]> {
        const postings = ids.map((id) =>
            postingsTable.getSync(serializer.deserialize(id)),
        );
        return Promise.resolve(postings);
    }

    function getId(text: string): Promise<TTextId | undefined> {
        return Promise.resolve(serializer.serialize(textTable.getId(text)));
    }

    function getIds(texts: string[]): Promise<(TTextId | undefined)[]> {
        // TODO: use IN clause
        return Promise.resolve(
            texts.map((t) => serializer.serialize(textTable.getId(t))),
        );
    }

    function getText(id: TTextId): Promise<string | undefined> {
        return Promise.resolve(textTable.getText(serializer.deserialize(id)));
    }

    async function put(text: string, postings?: TSourceId[]): Promise<TTextId> {
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
        return serializer.serialize(assignedId.id);
    }

    async function putMultiple(
        blocks: TextBlock<TSourceId>[],
    ): Promise<TTextId[]> {
        const ids: TTextId[] = [];
        for (const b of blocks) {
            const id = await put(b.value, b.sourceIds);
            ids.push(serializer.serialize(id));
        }
        return ids;
    }

    function getHitsSync(
        values: string[],
    ): IterableIterator<ScoredItem<TSourceId>> {
        // TODO: use a JOIN
        const textIds = [...textTable.getIds(values)];
        return postingsTable.getHitsSync(textIds);
    }

    async function getNearest(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]> {
        maxMatches ??= 1;
        let matchedTextIds = await getExactAndNearestTextIds(
            value,
            maxMatches,
            minScore,
        );
        if (matchedTextIds && matchedTextIds.length > 0) {
            // Iterate over matched postings
            const postings = postingsTable.iterateMultiple(matchedTextIds);
            if (postings) {
                return [...postings];
            }
        }
        return [];
    }

    // This can be optimized
    async function getNearestMultiple(
        values: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]> {
        const matches = await asyncArray.mapAsync(
            values,
            settings.concurrency,
            (t) => getNearest(t, maxMatches, minScore),
        );

        const combined = knowLib.sets.intersectMultiple(...matches);
        return Array.isArray(combined) ? combined : [...combined];
    }

    async function getNearestHits(
        value: string,
        hitTable: knowLib.sets.HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void> {
        let matchedTextIds = await getExactAndNearestTextIdsScored(
            value,
            maxMatches,
            minScore,
        );
        if (matchedTextIds && matchedTextIds.length > 0) {
            for (const textId of matchedTextIds) {
                const scoredPostings = postingsTable.iterateScored(
                    textId.item,
                    scoreBoost ? scoreBoost * textId.score : textId.score,
                );
                if (scoredPostings) {
                    hitTable.addMultipleScored(scoredPostings);
                }
            }
        }
    }

    async function getNearestHitsMultiple(
        values: string[],
        hitTable: knowLib.sets.HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void> {
        return asyncArray.forEachAsync(values, settings.concurrency, (v) =>
            getNearestHits(v, hitTable, maxMatches, minScore, scoreBoost),
        );
    }

    async function getNearestText(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TTextId[]> {
        maxMatches ??= 1;
        const matches = await getNearestTextIds(value, maxMatches, minScore);
        if (matches) {
            return isIdInt
                ? matches
                : matches.map((m) => serializer.serialize(m));
        }
        return [];
    }

    async function nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TSourceId[]>[]> {
        const matches = await nearestNeighborsTextIds(
            value,
            maxMatches,
            minScore,
        );
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
    ): Promise<ScoredItem<TTextId>[]> {
        if (!semanticIndex) {
            return [];
        }
        let matches = await nearestNeighborsTextIds(
            value,
            maxMatches,
            minScore,
        );
        return isIdInt ? matches : matches.map((m) => serializer.serialize(m));
    }

    async function nearestNeighborsTextIds(
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

    // TODO: Optimize
    async function remove(
        textId: TTextId,
        postings: TSourceId | TSourceId[],
    ): Promise<void> {
        const id = serializer.deserialize(textId);
        const existingPostings = await postingsTable.get(id);
        if (!existingPostings || existingPostings.length === 0) {
            return;
        }
        let updatedPostings = collections.removeItemFromArray(
            existingPostings,
            postings,
        );
        if (updatedPostings.length === 0) {
            await postingsTable.remove(id);
        } else {
            await postingsTable.replace(updatedPostings, id);
        }
    }

    async function getNearestTextId(
        value: string,
        minScore?: number,
    ): Promise<TextId | undefined> {
        const match = await getNearestTextIdScored(value, minScore);
        return match ? match.item : undefined;
    }

    async function getExactAndNearestTextIds(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TextId[] | undefined> {
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
        return matchedIds;
    }

    async function getExactAndNearestTextIdsScored(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<ScoredItem<TextId>[] | undefined> {
        maxMatches ??= 1;
        // Check exact match first
        let matchedIds: ScoredItem<TextId>[] | undefined;
        let exactId = textTable.getId(value);
        if (exactId) {
            matchedIds = [
                {
                    item: exactId,
                    score: 1.0,
                },
            ];
        }
        let nearestIds: ScoredItem<TextId>[] | undefined;
        if (maxMatches > 1) {
            nearestIds = await getNearestTextIdsScored(
                value,
                maxMatches,
                minScore,
            );
        } else if (!exactId) {
            const nearestId = await getNearestTextIdScored(value, minScore);
            if (nearestId) {
                nearestIds = [nearestId];
            }
        }
        matchedIds = [
            ...knowLib.sets.unionMultipleScored(matchedIds, nearestIds),
        ];
        return matchedIds;
    }

    async function getNearestTextIds(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<TextId[] | undefined> {
        const scoredTextIds = await getNearestTextIdsScored(
            value,
            maxMatches,
            minScore,
        );
        return scoredTextIds && scoredTextIds.length > 0
            ? scoredTextIds.map((s) => s.item)
            : undefined;
    }

    async function getNearestTextIdScored(
        value: string,
        minScore?: number,
    ): Promise<ScoredItem<TextId> | undefined> {
        return semanticIndex
            ? semanticIndex.nearestNeighbor(value, minScore)
            : undefined;
    }

    async function getNearestTextIdsScored(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TextId>[] | undefined> {
        return semanticIndex
            ? semanticIndex.nearestNeighbors(value, maxMatches, minScore)
            : undefined;
    }
}
