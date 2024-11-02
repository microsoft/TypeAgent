// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { dateTime } from "typeagent";

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
    type Timestamp = string;
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
        `SELECT sequenceNumber FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_oldestTimestamps = db.prepare(
        `SELECT DISTINCT timestamp 
         FROM ${tableName} 
         ORDER BY timestamp ASC 
         LIMIT ?`,
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

    return {
        size,
        addSync,
        put,
        get,
        getSync,
        getIdsInRange,
        getNewest,
        getOldest,
        iterateRange,
        iterateOldestTimestamps,
        iterateOldest,
        iterateNewest,
    };

    function size(): Promise<number> {
        const row = sql_size.run();
        const count = row ? (row as any).count : 0;
        return Promise.resolve(count);
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

    function getSync(id: SequenceNumber): dateTime.Timestamped<T> | undefined {
        const row = sql_get.get(id);
        return row ? deserialize(row as TemporalLogRow) : undefined;
    }

    function getIdsInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<SequenceNumber[]> {
        return Promise.resolve([...iterateRange(startAt, stopAt)]);
    }

    function getNewest(count: number): Promise<dateTime.Timestamped<T>[]> {
        return Promise.resolve([...iterateNewest(count)]);
    }
    function getOldest(count: number): Promise<dateTime.Timestamped<T>[]> {
        return Promise.resolve([...iterateOldest(count)]);
    }

    function* iterateRange(
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

    function* iterateOldestTimestamps(
        count: number,
    ): IterableIterator<Timestamp> {
        for (const row of sql_oldestTimestamps.iterate(count)) {
            yield (row as TemporalLogRow).timestamp;
        }
    }

    function* iterateOldest(
        count: number,
    ): IterableIterator<dateTime.Timestamped> {
        for (const row of sql_oldest.iterate(count)) {
            yield deserialize(row as TemporalLogRow);
        }
    }

    function* iterateNewest(
        count: number,
    ): IterableIterator<dateTime.Timestamped> {
        for (const row of sql_newest.iterate(count)) {
            yield deserialize(row as TemporalLogRow);
        }
    }

    function deserialize(row: TemporalLogRow): dateTime.Timestamped<T> {
        return {
            timestamp: new Date(row.dateTime),
            value: JSON.parse(row.value),
        };
    }
}
