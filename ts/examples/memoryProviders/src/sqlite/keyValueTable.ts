// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { ColumnType, SqlColumnType } from "./common.js";

export interface KeyValueTable<
    TKeyId extends ColumnType = string,
    TValueId extends ColumnType = string,
> extends knowLib.KeyValueIndex<TKeyId, TValueId> {
    getSync(id: TKeyId): TValueId[] | undefined;
    iterate(id: TKeyId): IterableIterator<TValueId> | undefined;
    iterateMultiple(ids: TKeyId[]): IterableIterator<TValueId> | undefined;
    putSync(postings: TValueId[], id: TKeyId): TKeyId;
}

export function createKeyValueTable<
    TKeyId extends ColumnType = string,
    TValueId extends ColumnType = string,
>(
    db: sqlite.Database,
    tableName: string,
    keyType: SqlColumnType<TKeyId>,
    valueType: SqlColumnType<TValueId>,
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
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (keyId, valueId) VALUES (?, ?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE keyId = ?`);
    return {
        get,
        getSync,
        getMultiple,
        iterate,
        iterateMultiple,
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

    function* iterate(id: TKeyId): IterableIterator<TValueId> | undefined {
        const rows = sql_get.iterate(id);
        let count = 0;
        for (const row of rows) {
            yield (row as KeyValueRow).valueId;
            ++count;
        }
        if (count === 0) {
            return undefined;
        }
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

        const sql = `SELECT DISTINCT valueId from ${tableName} WHERE keyId IN (${ids}) ORDER BY valueId ASC`;
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

    function getMultiple(
        ids: TKeyId[],
        concurrency?: number,
    ): Promise<TValueId[][]> {
        let matches: TValueId[][] = [];
        for (const id of ids) {
            const rows = sql_get.all(id) as KeyValueRow[];
            if (rows.length > 0) {
                matches.push(rows.map((r) => r.valueId));
            }
        }
        return Promise.resolve(matches);
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

    type KeyValueRow = {
        keyId: TKeyId;
        valueId: TValueId;
    };
}
