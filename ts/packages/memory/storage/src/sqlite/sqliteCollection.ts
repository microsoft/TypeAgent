// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import * as kp from "@typeagent/knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteCollection<T, TOrdinal extends number>
    implements kp.ICollection<T, TOrdinal>
{
    protected db: sqlite.Database;
    private sql_get: sqlite.Statement;
    private sql_append: sqlite.Statement;
    private sql_getAll: sqlite.Statement;
    private sql_slice: sqlite.Statement;

    private serializer: kp.JsonSerializer<T> | undefined;

    constructor(
        db: sqlite.Database,
        serializer: kp.JsonSerializer<T> | undefined,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        this.db = db;
        this.serializer = serializer;
        if (ensureExists) {
            this.ensureDb();
        }
        this.sql_get = this.sqlGet();
        this.sql_append = this.sqlAppend();
        this.sql_getAll = this.sqlGetAll();
        this.sql_slice = this.sqlSlice();
    }

    public get isPersistent(): boolean {
        return true;
    }

    public get length(): number {
        // Read the transaction's count, including after an outer rollback.
        return this.loadCount();
    }

    public append(...items: T[]): void {
        this.db.transaction(() => {
            for (const item of items) this.appendObject(item);
        })();
    }

    public get(ordinal: TOrdinal): T {
        const actualOrdinal = ordinal + 1;
        const row = this.sql_get.get(actualOrdinal);
        if (row === undefined) {
            throw new Error(
                `Ordinal ${ordinal} not found. Collection length is ${this.length}`,
            );
        }
        return this.deserializeObject(row);
    }

    public getSlice(start: TOrdinal, end: TOrdinal): T[] {
        return this.rowsToArray(this.sql_slice.iterate(start + 1, end + 1));
    }

    public getMultiple(ordinals: TOrdinal[]): T[] {
        const byOrdinal = new Map<number, T>();
        const unique = [...new Set(ordinals)];
        for (let start = 0; start < unique.length; start += 128) {
            const batch = unique.slice(start, start + 128);
            const sql = this.db.prepare(
                `SELECT ordinal, value FROM ${this.tableName} WHERE ordinal IN (${sql_makeInPlaceholders(batch.length)})`,
            );
            for (const row of sql.iterate(
                ...batch.map((ordinal) => ordinal + 1),
            )) {
                const data = row as CollectionRow;
                byOrdinal.set(data.ordinal - 1, this.deserializeObject(data));
            }
        }
        return ordinals.map((ordinal) => {
            if (!Number.isSafeInteger(ordinal) || !byOrdinal.has(ordinal))
                throw new Error(
                    `Ordinal ${ordinal} not found. Collection length is ${this.length}`,
                );
            return byOrdinal.get(ordinal)!;
        });
    }

    public getAll(): T[] {
        return this.rowsToArray(this.sql_getAll.iterate());
    }

    public *[Symbol.iterator](): Iterator<T, any, any> {
        for (const row of this.sql_getAll.iterate()) {
            const value = this.deserializeObject(row);
            if (value !== undefined) {
                yield value;
            }
        }
    }

    private rowsToArray(rows: IterableIterator<unknown>): T[] {
        const objects: T[] = [];
        for (const row of rows) {
            const value = this.deserializeObject(row);
            objects.push(value);
        }
        return objects;
    }

    private loadCount(): number {
        const sql = this.db.prepare(`
            SELECT ordinal as count FROM ${this.tableName}
            ORDER BY ordinal DESC
            LIMIT 1
        `);
        const row = sql.get();
        const count = row ? (row as { count: number }).count : 0;
        return count;
    }

    private appendObject(obj: T): void {
        const json = this.serializer
            ? this.serializer.serialize(obj)
            : JSON.stringify(obj);
        this.sql_append.run(json);
    }

    private deserializeObject(row: unknown): T {
        const data = row as CollectionRow;
        return this.serializer
            ? this.serializer.deserialize(data.value)
            : JSON.parse(data.value);
    }

    private ensureDb() {
        const schemaSql = `CREATE TABLE IF NOT EXISTS ${this.tableName} (
            ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
            value TEXT NOT NULL)`;
        this.db.exec(schemaSql);
    }

    private sqlGet() {
        return this.db.prepare(
            `SELECT value FROM ${this.tableName} WHERE ordinal = ?`,
        );
    }
    private sqlSlice() {
        return this.db.prepare(
            `SELECT value FROM ${this.tableName} WHERE ordinal >= ? AND ordinal < ?`,
        );
    }
    private sqlGetAll() {
        return this.db.prepare(`SELECT value FROM ${this.tableName}`);
    }
    private sqlAppend() {
        return this.db.prepare(
            `INSERT INTO ${this.tableName} (value) VALUES (?)`,
        );
    }
}

type CollectionRow = {
    ordinal: number;
    value: string;
};
