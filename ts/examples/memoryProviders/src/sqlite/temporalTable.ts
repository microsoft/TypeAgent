// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { dateTime, NameValue } from "typeagent";

export type TemporalLogRow = {
    sequenceNumber: number;
    timestamp: string;
    dateTime: string;
    value: string;
};

export interface TemporalTable<TId = any, T = any>
    extends knowLib.TemporalLog<TId, T> {
    iterateRange(startAt: Date, stopAt?: Date): IterableIterator<string>;
}

export function createTemporalLogTable<T = any>(
    db: sqlite.Database,
    tableName: string,
    ensureExists: boolean = true,
) {
    type SequenceNumber = number;
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (
      sequenceNumber INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      dateTime TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX idx_timestamp_${tableName} ON ${tableName} (timestamp);
    `;

    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_size = db.prepare(`SELECT count(*) as count from ${tableName}`);
    const sql_get = db.prepare(
        `SELECT dateTime, value FROM ${tableName} WHERE sequenceNumber = ?`,
    );
    const sql_add = db.prepare(
        `INSERT INTO ${tableName} (timestamp, dateTime, value) VALUES (?, ?, ?)`,
    );
    const sql_rangeStartAt = db.prepare(
        `SELECT sequenceNumber FROM ${tableName} WHERE timestamp >= ?`,
    );
    const sql_range = db.prepare(
        `SELECT sequenceNumber, FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_rangeStartAtObj = db.prepare(
        `SELECT sequenceNumber, dateTime, value, FROM ${tableName} WHERE timestamp >= ?`,
    );
    const sql_rangeObj = db.prepare(
        `SELECT sequenceNumber, dateTime, value, FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_oldest = db.prepare(
        `SELECT dateTime, value FROM ${tableName}
         WHERE timestamp IN (
            SELECT DISTINCT timestamp 
            FROM ${tableName} 
            ORDER BY timestamp ASC 
            LIMIT ?
        )
        ORDER BY sequenceNumber ASC`,
    );
    const sql_newest = db.prepare(
        `SELECT dateTime, value FROM ${tableName}
         WHERE timestamp IN (
            SELECT DISTINCT timestamp 
            FROM ${tableName} 
            ORDER BY timestamp DESC 
            LIMIT ?
        )
        ORDER BY sequenceNumber DESC`,
    );
    const sql_all = db.prepare(
        `SELECT sequenceNumber, dateTime, value FROM ${tableName}`,
    );
    const sql_allNewest = db.prepare(
        `SELECT dateTime, value FROM ${tableName} ORDER BY sequenceNumber DESC`,
    );
    const sql_minMax = db.prepare(`
        SELECT 
            (SELECT timestamp from ${tableName} ORDER BY sequenceNumber ASC LIMIT 1) 
            AS start,
            (SELECT timestamp from ${tableName} ORDER BY sequenceNumber DESC LIMIT 1) 
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
        iterateAll,
        iterateIdsRange,
        iterateRange,
        iterateOldest,
        iterateNewest,
    };

    function size(): Promise<number> {
        const row = sql_size.run();
        const count = row ? (row as any).count : 0;
        return Promise.resolve(count);
    }

    async function* all(): AsyncIterableIterator<
        NameValue<dateTime.Timestamped<T>, SequenceNumber>
    > {
        for (const entry of iterateAll()) {
            yield entry;
        }
    }

    async function* allObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        for (const row of sql_add.iterate()) {
            yield deserialize(row);
        }
    }

    function put(value: any, timestamp?: Date): Promise<SequenceNumber> {
        return Promise.resolve(addSync(value, timestamp));
    }

    function addSync(value: T, timestamp?: Date): SequenceNumber {
        timestamp ??= new Date();
        const timestampString = dateTime.timestampString(timestamp);
        const result = sql_add.run(
            timestampString,
            timestamp.toISOString(),
            JSON.stringify(value),
        );
        return result.lastInsertRowid as number;
    }

    function get(
        id: SequenceNumber,
    ): Promise<dateTime.Timestamped<T> | undefined> {
        return Promise.resolve(getSync(id));
    }

    async function getMultiple(
        ids: SequenceNumber[],
    ): Promise<(dateTime.Timestamped<T> | undefined)[]> {
        const stmt = db.prepare(
            `SELECT dateTime, value FROM ${tableName} WHERE sequenceNumber IN (${ids})`,
        );
        const objects: dateTime.Timestamped<T>[] = [];
        for (const row of stmt.iterate()) {
            objects.push(deserialize(row));
        }
        return objects;
    }

    function getSync(id: SequenceNumber): dateTime.Timestamped<T> | undefined {
        const row = sql_get.get(id);
        return row ? deserialize(row) : undefined;
    }

    function getIdsInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<SequenceNumber[]> {
        return Promise.resolve([...iterateIdsRange(startAt, stopAt)]);
    }

    function getEntriesInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<dateTime.Timestamped<T>[]> {
        return Promise.resolve([...iterateRange(startAt, stopAt)]);
    }

    function getTimeRange(): Promise<dateTime.DateRange | undefined> {
        const row = sql_minMax.get();
        if (row) {
            const { min, max } = row as any;
            return Promise.resolve({
                startDate: new Date(min),
                stopDate: new Date(max),
            });
        }
        return Promise.resolve(undefined);
    }

    function getNewest(count: number): Promise<dateTime.Timestamped<T>[]> {
        return Promise.resolve([...iterateNewest(count)]);
    }
    function getOldest(count: number): Promise<dateTime.Timestamped<T>[]> {
        return Promise.resolve([...iterateOldest(count)]);
    }

    async function* newestObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        const rows = sql_allNewest.iterate();
        for (const row of rows) {
            yield deserialize(row);
        }
    }

    function* iterateAll(): IterableIterator<
        NameValue<dateTime.Timestamped<T>, SequenceNumber>
    > {
        for (const row of sql_all.iterate()) {
            yield {
                name: (row as TemporalLogRow).sequenceNumber,
                value: deserialize(row),
            };
        }
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
    ): IterableIterator<SequenceNumber> {
        const rangeStart = dateTime.timestampString(startAt);
        const rangeEnd = stopAt ? dateTime.timestampString(stopAt) : undefined;
        if (rangeEnd) {
            for (const row of sql_range.iterate(rangeStart, rangeEnd)) {
                yield (row as TemporalLogRow).sequenceNumber;
            }
        } else {
            for (const row of sql_rangeStartAt.iterate(rangeStart)) {
                yield (row as TemporalLogRow).sequenceNumber;
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

    function deserialize(row: any): dateTime.Timestamped<T> {
        const logRow = row as TemporalLogRow;
        return {
            timestamp: new Date(logRow.dateTime),
            value: JSON.parse(logRow.value),
        };
    }
}
