// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as knowLib from "knowledge-processor";
import { dateTime } from "typeagent";
import { ColumnType, SqlColumnType } from "./common.js";

export type TemporalLogRow = {
    sequenceNumber: number;
    timestamp: string;
    value: string;
};

export interface TemporalTable<TId = any, T = any>
    extends knowLib.TemporalLog<TId, T> {
    iterateRange(startAt: Date, stopAt?: Date): IterableIterator<string>;
}

export function createTemporalLogTable<
    TId extends ColumnType = number,
    T = any,
>(
    db: sqlite.Database,
    tableName: string,
    idType: SqlColumnType<TId>,
    ensureExists: boolean = true,
) {
    type SequenceNumber = number;
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (
      sequenceNumber as INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp: string,
      value TEXT NOT NULL,
    );
    CREATE INDEX idx_timestamp_${tableName} ON ${tableName}.timestamp;
    `;

    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_size = db.prepare(`SELECT count(*) as count from ${tableName}`);
    const sql_add = db.prepare(
        `INSERT INTO ${tableName} (timestamp, value) VALUES (?, ?)`,
    );
    const sql_rangeStartAt = db.prepare(
        `SELECT sequenceNumber FROM ${tableName} WHERE timestamp >= ?`,
    );
    const sql_range = db.prepare(
        `SELECT sequenceNumber FROM ${tableName} WHERE timestamp >= ? AND timestamp <= ?`,
    );
    const sql_oldestLimit = db.prepare(
        `SELECT timestamp, value FROM ${tableName} ORDER BY sequenceNumber ASC LIMIT ?;`,
    );
    const sql_newestLimit = db.prepare(
        `SELECT timestamp, value FROM ${tableName} ORDER BY sequenceNumber DESC LIMIT ?;`,
    );
    return {
        size,
        add: addSync,
        put,
        getIdsInRange,
        getNewest,
        getOldest,
        iterateRange,
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

    function addSync(value: any, timestamp?: Date): SequenceNumber {
        timestamp ??= new Date();
        const result = sql_add.run(
            dateTime.timestampString(timestamp),
            JSON.stringify(value),
        );
        return result.lastInsertRowid as number;
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

    function* iterateOldest(
        count: number,
    ): IterableIterator<dateTime.Timestamped<T>> {
        for (const row of sql_oldestLimit.iterate(count)) {
            yield deserialize(row as TemporalLogRow);
        }
    }

    function* iterateNewest(
        count: number,
    ): IterableIterator<dateTime.Timestamped<T>> {
        for (const row of sql_newestLimit.iterate(count)) {
            yield deserialize(row as TemporalLogRow);
        }
    }

    function deserialize(row: TemporalLogRow): dateTime.Timestamped<T> {
        return {
            timestamp: new Date(row.timestamp),
            value: JSON.parse(row.value),
        };
    }
}
