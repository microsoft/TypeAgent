// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";

export type ColumnType = string | number;

export type SqlColumnType<T> = T extends string
    ? "TEXT"
    : T extends number
      ? "INTEGER"
      : never;

export function createKeyValueIndex<
    TKeyId extends ColumnType = string,
    TValueId extends ColumnType = string,
>(
    db: sqlite.Database,
    tableName: string,
    keyType: SqlColumnType<TKeyId>,
    valueType: SqlColumnType<TValueId>,
    ensureExists: boolean = true,
): knowLib.KeyValueIndex<TKeyId, TValueId> {
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
        getMultiple,
        put,
        replace,
        remove,
    };

    function get(id: TKeyId): Promise<TValueId[] | undefined> {
        const rows = sql_get.all(id) as KeyValueRow[];
        return Promise.resolve(
            rows.length > 0 ? rows.map((r) => r.valueId) : undefined,
        );
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
        if (!id) {
            // TODO: support
            throw new Error("Not supported");
        }
        // TODO: investigate batches
        for (let i = 0; i < values.length; ++i) {
            sql_add.run(id, values[i]);
        }

        return Promise.resolve(id);
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
