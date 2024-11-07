// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { dateTime, NameValue } from "typeagent";
import { getTypeSerializer, sql_makeInClause } from "./common.js";
import { ValueType, ValueDataType } from "knowledge-processor";

export type TemporalLogRow<T> = {
    logId: number;
    timestamp: string;
    dateTime: string;
    value: T | number;
};

export interface TemporalTable<TLogId = any, T = any>
    extends knowLib.TemporalLog<TLogId, T> {
    // Additional behaviors that we can supply because we are using sqlite

    addSync(value: T, timestamp?: Date): TLogId;
    getSync(id: TLogId): dateTime.Timestamped<T> | undefined;
    iterateIdsRange(startAt: Date, stopAt?: Date): IterableIterator<TLogId>;
    iterateRange(
        startAt: Date,
        stopAt?: Date,
    ): IterableIterator<dateTime.Timestamped<T>>;
    iterateOldest(count: number): IterableIterator<dateTime.Timestamped>;
    iterateNewest(count: number): IterableIterator<dateTime.Timestamped>;

    sql_joinRange(startAt: Date, stopAt?: Date): string;
}

export function createTemporalLogTable<
    T = any,
    TValue extends ValueType = string,
    TLogId extends ValueType = number,
>(
    db: sqlite.Database,
    tableName: string,
    keyType: ValueDataType<TLogId>,
    valueType: ValueDataType<TValue>,
    ensureExists: boolean = true,
): TemporalTable<TLogId, T> {
    const [isIdInt, idSerializer] = getTypeSerializer<TLogId>(keyType);
    const isValueInt = valueType === "INTEGER";
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (
      logId INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      dateTime TEXT NOT NULL,
      value ${valueType} NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${tableName}_timestamp ON ${tableName} (timestamp);
    `;

    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_size = db.prepare(
        `SELECT count(logId) as count from ${tableName}`,
    );
    const sql_get = db.prepare(
        `SELECT dateTime, value FROM ${tableName} WHERE logId = ?`,
    );
    const sql_add = db.prepare(
        `INSERT INTO ${tableName} (timestamp, dateTime, value) VALUES (?, ?, ?)`,
    );
    const sql_rangeStartAt = db.prepare(
        `SELECT logId FROM ${tableName} WHERE timestamp >= ?`,
    );
    const sql_range = db.prepare(
        `SELECT logId FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_rangeStartAtObj = db.prepare(
        `SELECT logId, dateTime, value FROM ${tableName} WHERE timestamp >= ?`,
    );
    const sql_rangeObj = db.prepare(
        `SELECT logId, dateTime, value FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_oldest = db.prepare(
        `SELECT dateTime, value FROM ${tableName}
         WHERE timestamp IN (
            SELECT DISTINCT timestamp 
            FROM ${tableName} 
            ORDER BY timestamp ASC 
            LIMIT ?
        )
        ORDER BY timestamp ASC`,
    );
    const sql_newest = create_sql_newest();
    const sql_minMax = db.prepare(`
        SELECT 
            (SELECT timestamp from ${tableName} ORDER BY timestamp ASC LIMIT 1) 
            AS start,
            (SELECT timestamp from ${tableName} ORDER BY timestamp DESC LIMIT 1) 
            AS end`);
    return {
        size,
        all,
        allObjects,
        addSync,
        put,
        get,
        getMultiple,
        getSync,
        getIdsInRange,
        getEntriesInRange,
        getNewest,
        getOldest,
        getTimeRange,
        newestObjects,
        remove,
        removeInRange,
        clear,
        iterateIdsRange,
        iterateRange,
        iterateOldest,
        iterateNewest,
        sql_joinRange,
    };

    function size(): Promise<number> {
        const row = sql_size.get();
        const count = row ? (row as any).count : 0;
        return Promise.resolve(count);
    }

    async function* all(): AsyncIterableIterator<
        NameValue<dateTime.Timestamped<T>, TLogId>
    > {
        const sql = create_sql_all();
        for (const row of sql.iterate()) {
            yield {
                name: idSerializer.serialize((row as TemporalLogRow<T>).logId),
                value: deserialize(row),
            };
        }
    }

    async function* allObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        const sql = create_sql_all();
        for (const row of sql.iterate()) {
            yield deserialize(row);
        }
    }

    function put(value: any, timestamp?: Date): Promise<TLogId> {
        return Promise.resolve(addSync(value, timestamp));
    }

    function addSync(value: T, timestamp?: Date): TLogId {
        let rowValue: string | number | undefined;
        if (isValueInt) {
            if (typeof value !== "number") {
                throw Error(`${value} must be a number`);
            }
            rowValue = value as number;
        } else {
            rowValue = JSON.stringify(value);
        }
        timestamp ??= new Date();
        const timestampString = dateTime.timestampString(timestamp);
        const result = sql_add.run(
            timestampString,
            timestamp.toISOString(),
            rowValue,
        );
        return idSerializer.serialize(result.lastInsertRowid);
    }

    function get(id: TLogId): Promise<dateTime.Timestamped<T> | undefined> {
        return Promise.resolve(getSync(id));
    }

    async function getMultiple(
        ids: TLogId[],
    ): Promise<(dateTime.Timestamped<T> | undefined)[]> {
        const idsClause = isIdInt ? ids : sql_makeInClause(ids);
        const sql = db.prepare(
            `SELECT dateTime, value FROM ${tableName} WHERE logId IN (${idsClause})`,
        );
        const objects: dateTime.Timestamped<T>[] = [];
        for (const row of sql.iterate()) {
            objects.push(deserialize(row));
        }
        return objects;
    }

    function getSync(id: TLogId): dateTime.Timestamped<T> | undefined {
        const row = sql_get.get(idSerializer.deserialize(id));
        return row ? deserialize(row) : undefined;
    }

    async function getIdsInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<TLogId[]> {
        return [...iterateIdsRange(startAt, stopAt)];
    }

    async function getEntriesInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<dateTime.Timestamped<T>[]> {
        return [...iterateRange(startAt, stopAt)];
    }

    async function getTimeRange(): Promise<dateTime.DateRange | undefined> {
        const row = sql_minMax.get();
        if (row) {
            const { min, max } = row as any;
            return {
                startDate: new Date(min),
                stopDate: new Date(max),
            };
        }
        return undefined;
    }

    async function getNewest(
        count: number,
    ): Promise<dateTime.Timestamped<T>[]> {
        return [...iterateNewest(count)];
    }

    async function getOldest(
        count: number,
    ): Promise<dateTime.Timestamped<T>[]> {
        return [...iterateOldest(count)];
    }

    async function* newestObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        // Async iterable. Use a separate statement
        const sql = create_sql_allNewest();
        for (const row of sql.iterate()) {
            yield deserialize(row);
        }
    }

    async function remove(id: TLogId): Promise<void> {
        const stmt = db.prepare(`DELETE FROM ${tableName} WHERE logId = ?`);
        stmt.run(idSerializer.deserialize(id));
    }

    async function removeInRange(startAt: Date, stopAt: Date): Promise<void> {
        const rangeStart = dateTime.timestampString(startAt);
        const rangeEnd = dateTime.timestampString(stopAt);
        const stmt = db.prepare(
            `DELETE FROM ${tableName} WHERE timestamp >= ? AND timestamp <= rangeEnd`,
        );
        stmt.run(rangeStart, rangeEnd);
    }

    async function clear() {
        const stmt = db.prepare(`DELETE * FROM ${tableName}`);
        stmt.run();
    }

    function* iterateRange(
        startAt: Date,
        stopAt?: Date,
    ): IterableIterator<dateTime.Timestamped<T>> {
        const rangeStart = dateTime.timestampString(startAt);
        const rangeEnd = stopAt ? dateTime.timestampString(stopAt) : undefined;
        if (rangeEnd) {
            for (const row of sql_rangeObj.iterate(rangeStart, rangeEnd)) {
                yield deserialize(row);
            }
        } else {
            for (const row of sql_rangeStartAtObj.iterate(rangeStart)) {
                yield deserialize(row);
            }
        }
    }

    function* iterateIdsRange(
        startAt: Date,
        stopAt?: Date,
    ): IterableIterator<TLogId> {
        const range = dateTime.timestampRange(startAt, stopAt);
        if (range.endTimestamp) {
            for (const row of sql_range.iterate(
                range.startTimestamp,
                range.endTimestamp,
            )) {
                yield idSerializer.serialize((row as TemporalLogRow<T>).logId);
            }
        } else {
            for (const row of sql_rangeStartAt.iterate(range.startTimestamp)) {
                yield idSerializer.serialize((row as TemporalLogRow<T>).logId);
            }
        }
    }

    function* iterateOldest(
        count: number,
    ): IterableIterator<dateTime.Timestamped> {
        for (const row of sql_oldest.iterate(count)) {
            yield deserialize(row);
        }
    }

    function* iterateNewest(
        count: number,
    ): IterableIterator<dateTime.Timestamped> {
        for (const row of sql_newest.iterate(count)) {
            yield deserialize(row);
        }
    }

    function sql_joinRange(startAt: Date, stopAt?: Date): string {
        const range = dateTime.timestampRange(startAt, stopAt);
        let sql = `INNER JOIN ${tableName} ON ${tableName}.value = valueId\n`;
        sql += `WHERE ${tableName}.timestamp >= '${range.startTimestamp}'`;
        if (range.endTimestamp) {
            sql += ` AND ${tableName}.timestamp <= '${range.endTimestamp}'`;
        }
        return sql;
    }

    function deserialize(row: any): dateTime.Timestamped<T> {
        const logRow = row as TemporalLogRow<T>;
        return {
            timestamp: new Date(logRow.dateTime),
            value: isValueInt
                ? (logRow.value as number)
                : JSON.parse(logRow.value as string),
        };
    }

    function create_sql_all() {
        return db.prepare(`SELECT logId, dateTime, value FROM ${tableName}`);
    }

    function create_sql_newest() {
        return db.prepare(
            `SELECT dateTime, value FROM ${tableName}
             WHERE timestamp IN (
                SELECT DISTINCT timestamp 
                FROM ${tableName} 
                ORDER BY timestamp DESC 
                LIMIT ?
            )
            ORDER BY timestamp DESC`,
        );
    }

    function create_sql_allNewest() {
        return db.prepare(
            `SELECT dateTime, value FROM ${tableName} ORDER BY timestamp DESC`,
        );
    }
}
