// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { dateTime, generateMonotonicName } from "typeagent";

export function createTemporalLogTable<T = any>(
    db: sqlite.Database,
    tableName: string,
    ensureExists: boolean = true,
) {
    type Timestamp = string;
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      timestamp TEXT PRIMARY KEY,
      value TEXT NOT NULL,
    );`;

    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_exists = db.prepare(
        `SELECT 1 from ${tableName} WHERE timestamp = ?`,
    );
    const sql_add = db.prepare(
        `INSERT INTO ${tableName} (timestamp, value) VALUES (?, ?)`,
    );

    return {
        exists,
        add,
    };

    function exists(timestamp: Timestamp): boolean {
        const row = sql_exists.get(timestamp);
        return row !== undefined;
    }

    function add(value: any, timestamp?: Date): Promise<Timestamp> {
        timestamp ??= new Date();
        const tValue = dateTime.stringifyTimestamped(value, timestamp);
        let timestampId: string | undefined =
            dateTime.timestampString(timestamp);
        timestampId = ensureUniqueTimestamp(timestampId);
        if (!timestampId) {
            throw new Error(
                `${tableName}\nCould not create unique timestamp for base: ${timestamp}`,
            );
        }
        sql_add.run(timestampId, tValue);
        return Promise.resolve(timestampId);
    }

    function ensureUniqueTimestamp(timestamp: Timestamp): string | undefined {
        if (!exists(timestamp)) {
            return timestamp;
        }
        return generateMonotonicName(1, timestamp, (name: string) => {
            return !exists(name);
        }).name;
    }
}
