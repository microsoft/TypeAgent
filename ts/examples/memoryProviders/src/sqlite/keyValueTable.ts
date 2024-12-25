// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { ValueType, ValueDataType } from "knowledge-processor";
import { ScoredItem } from "typeagent";

export interface KeyValueTable<
    TKeyId extends ValueType = string,
    TValueId extends ValueType = string,
> extends knowLib.KeyValueIndex<TKeyId, TValueId> {
    readonly schemaSql: string;
    readonly tableName: string;

    getSync(id: TKeyId): TValueId[] | undefined;
    putSync(postings: TValueId[], id: TKeyId): TKeyId;
    iterate(id: TKeyId): IterableIterator<TValueId> | undefined;
    iterateScored(
        id: TKeyId,
        score?: number,
    ): IterableIterator<ScoredItem<TValueId>> | undefined;
    iterateMultiple(ids: TKeyId[]): IterableIterator<TValueId> | undefined;
    iterateMultipleScored(
        items: ScoredItem<TKeyId>[],
    ): IterableIterator<ScoredItem<TValueId>> | undefined;
    getHits(
        ids: TKeyId[],
        join?: string,
    ): IterableIterator<ScoredItem<TValueId>> | undefined;
}

export function createKeyValueTable<
    TKeyId extends ValueType = string,
    TValueId extends ValueType = string,
>(
    db: sqlite.Database,
    tableName: string,
    keyType: ValueDataType<TKeyId>,
    valueType: ValueDataType<TValueId>,
    ensureExists: boolean = true,
): KeyValueTable<TKeyId, TValueId> {
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      keyId ${keyType} NOT NULL,
      valueId ${valueType} NOT NULL,
      PRIMARY KEY(keyId, valueId)  
    );`;

    if (ensureExists) {
        db.exec(schemaSql);
    }

    const sql_get = db.prepare(
        `SELECT valueId from ${tableName} WHERE keyId = ? ORDER BY valueId ASC`,
    );
    const sql_getScored = db.prepare(
        `SELECT valueId as item, @score as score 
        FROM ${tableName} WHERE keyId = @keyId ORDER BY valueId ASC`,
    );
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (keyId, valueId) VALUES (?, ?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE keyId = ?`);
    return {
        schemaSql,
        tableName,
        get,
        getSync,
        getMultiple,
        getHits,
        iterate,
        iterateScored,
        iterateMultiple,
        iterateMultipleScored,
        put,
        putSync,
        replace,
        remove,
    };

    function get(id: TKeyId): Promise<TValueId[] | undefined> {
        const rows = sql_get.all(id) as KeyValueRow[];
        return Promise.resolve(
            rows.length > 0 ? rows.map((r) => r.valueId) : undefined,
        );
    }

    function getSync(id: TKeyId): TValueId[] | undefined {
        const rows = sql_get.all(id) as KeyValueRow[];
        return rows.length > 0 ? rows.map((r) => r.valueId) : undefined;
    }

    function* iterate(keyId: TKeyId): IterableIterator<TValueId> | undefined {
        const rows = sql_get.iterate(keyId);
        let count = 0;
        for (const row of rows) {
            yield (row as KeyValueRow).valueId;
            ++count;
        }
        if (count === 0) {
            return undefined;
        }
    }

    function iterateScored(
        keyId: TKeyId,
        score: number,
    ): IterableIterator<ScoredItem<TValueId>> {
        return sql_getScored.iterate({
            score: score,
            keyId,
        }) as IterableIterator<ScoredItem<TValueId>>;
    }

    function* iterateMultiple(
        ids: TKeyId[],
    ): IterableIterator<TValueId> | undefined {
        if (ids.length === 0) {
            return undefined;
        }
        if (ids.length === 0) {
            return iterate(ids[0]);
        }

        const sql = `SELECT DISTINCT valueId FROM ${tableName} 
        WHERE keyId IN (${ids}) 
        ORDER BY valueId ASC`;
        const stmt = db.prepare(sql);
        const rows = stmt.iterate();
        let count = 0;
        for (const row of rows) {
            yield (row as KeyValueRow).valueId;
            ++count;
        }
        if (count === 0) {
            return undefined;
        }
    }

    function iterateMultipleScored(
        items: ScoredItem<TKeyId>[],
    ): IterableIterator<ScoredItem<TValueId>> | undefined {
        if (items.length === 0) {
            return undefined;
        }
        const sql = sql_multipleScored(items);
        const stmt = db.prepare(sql);
        return stmt.iterate() as IterableIterator<ScoredItem<TValueId>>;
    }

    function getMultiple(
        ids: TKeyId[],
        concurrency?: number,
    ): Promise<TValueId[][]> {
        let matches: TValueId[][] = [];
        let valueIds: TValueId[] = [];
        for (const id of ids) {
            const rows = sql_get.iterate(id);
            for (const row of rows) {
                valueIds.push((row as KeyValueRow).valueId);
            }
            if (valueIds.length > 0) {
                matches.push(valueIds);
                valueIds = [];
            }
        }
        return Promise.resolve(matches);
    }

    function* getHits(
        ids: TKeyId[],
        join?: string,
    ): IterableIterator<ScoredItem<TValueId>> | undefined {
        if (ids.length === 0) {
            return undefined;
        }
        const sql = join
            ? `SELECT valueId AS item, count(*) AS score FROM ${tableName}
        ${join} AND keyId IN (${ids})
        GROUP BY valueId 
        ORDER BY score DESC`
            : `SELECT valueId AS item, count(*) AS score FROM ${tableName}
        WHERE keyId IN (${ids})
        GROUP BY valueId 
        ORDER BY score DESC`;
        const stmt = db.prepare(sql);
        for (const row of stmt.iterate()) {
            yield row as ScoredItem<TValueId>;
        }
    }

    function put(values: TValueId[], id?: TKeyId): Promise<TKeyId> {
        if (id === undefined) {
            // TODO: support
            throw new Error("Not supported");
        }
        return Promise.resolve(putSync(values, id));
    }

    function putSync(values: TValueId[], id: TKeyId): TKeyId {
        for (let i = 0; i < values.length; ++i) {
            sql_add.run(id, values[i]);
        }
        return id;
    }

    function replace(values: TValueId[], id: TKeyId): Promise<TKeyId> {
        sql_remove.run(id);
        return put(values, id);
    }

    function remove(id: TKeyId): Promise<void> {
        sql_remove.run(id);
        return Promise.resolve();
    }

    function sql_multipleScored(items: ScoredItem<TKeyId>[]) {
        let sql = "SELECT item, SUM(score) AS score FROM (\n";
        sql += sql_unionAllPostings(items);
        sql += "\n)\n";
        sql += "GROUP BY item";
        return sql;
    }

    function sql_unionAllPostings(items: ScoredItem<TKeyId>[]) {
        let sql = "";
        for (const item of items) {
            if (sql.length > 0) {
                sql += "\nUNION ALL\n";
            }
            sql += `SELECT valueId as item, ${item.score} as score 
            FROM ${tableName} WHERE keyId = ${item.item}`;
        }
        sql += "\nORDER BY valueId ASC";
        return sql;
    }

    type KeyValueRow = {
        keyId: TKeyId;
        valueId: TValueId;
    };
}
