// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as sqlite from "better-sqlite3";
import { ICollection } from "knowpro";

export class SqliteCollection<T, TOrdinal extends number>
    implements ICollection<T, TOrdinal>
{
    private db: sqlite.Database;
    private rowCount: number | undefined;

    constructor(
        db: sqlite.Database,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        this.db = db;
        this.ensureDb();
    }

    public get length(): number {
        if (this.rowCount === undefined) {
            this.rowCount = this.loadRowCount();
        }
        return this.rowCount;
    }

    public push(...items: T[]): void {
        throw new Error("Method not implemented.");
    }

    public get(ordinal: TOrdinal): T | undefined {
        throw new Error("Method not implemented.");
    }

    public getMultiple(ordinals: TOrdinal[]): (T | undefined)[] {
        throw new Error("Method not implemented.");
    }

    public getAll(): T[] {
        throw new Error("Method not implemented.");
    }

    public [Symbol.iterator](): Iterator<T, any, any> {
        throw new Error("Method not implemented.");
    }

    private ensureDb() {
        const schemaSql = `CREATE TABLE IF NOT EXISTS ${this.tableName} (
            ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
            value TEXT NOT NULL,
        )'`;
        this.db.exec(schemaSql);
    }

    private loadRowCount(): number {
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
