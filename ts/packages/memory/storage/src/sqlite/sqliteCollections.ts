// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as sqlite from "better-sqlite3";

export class SqliteCollection {
    private db: sqlite.Database;
    private maxOrdinal: number | undefined;

    constructor(
        db: sqlite.Database,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        this.db = db;
        this.ensureDb();
    }

    public get size(): number {
        if (this.maxOrdinal === undefined) {
            this.maxOrdinal = this.loadMaxOrdinal();
        }
        return this.maxOrdinal;
    }

    private ensureDb() {
        const schemaSql = `CREATE TABLE IF NOT EXISTS ${this.tableName} (
            ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
            value TEXT NOT NULL,
        )'`;
        this.db.exec(schemaSql);
    }

    private loadMaxOrdinal(): number {
        const sql_size = this.db.prepare(`
            SELECT ordinal FROM ${this.tableName}
            ORDER BY ordinal DESC
            LIMIT 1
        `);
        const row = sql_size.get();
        const ordinal = row ? (row as any).ordinal : 0;
        return ordinal;
    }
}
