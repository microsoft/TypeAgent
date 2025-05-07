// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteCollection<T, TOrdinal extends number>
    implements kp.ICollection<T, TOrdinal>
{
    private db: sqlite.Database;
    private count: number;
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
        this.count = this.loadCount();
        this.sql_get = this.sqlGet();
        this.sql_append = this.sqlAppend();
        this.sql_getAll = this.sqlGetAll();
        this.sql_slice = this.sqlSlice();
    }

    public get isPersistent(): boolean {
        return true;
    }

    public get length(): number {
        return this.count;
    }

    public append(...items: T[]): void {
        for (const item of items) {
            this.appendObject(item);
        }
    }

    public get(ordinal: TOrdinal): T {
        const actualOrdinal = ordinal + 1;
        const row = this.sql_get.get(actualOrdinal);
        if (row === undefined) {
            throw new Error(
                `Ordinal ${ordinal} not found. Collection length is ${this.count}`,
            );
        }
        return this.deserializeObject(row);
    }

    public getSlice(start: TOrdinal, end: TOrdinal): T[] {
        return this.rowsToArray(this.sql_slice.iterate(start + 1, end + 1));
    }

    public getMultiple(ordinals: TOrdinal[]): T[] {
        let actualOrdinals: number[] = new Array<number>(ordinals.length);
        for (let i = 0; i < ordinals.length; ++i) {
            actualOrdinals[i] = ordinals[i] + 1;
        }
        const placeholder = sql_makeInPlaceholders(ordinals.length);
        const sql = this.db.prepare(
            `SELECT value FROM ${this.tableName} WHERE ordinal IN (${placeholder})`,
        );
        const objects = this.rowsToArray(sql.iterate(...actualOrdinals));
        if (objects.length !== ordinals.length) {
            throw new Error(
                `Expected ${ordinals.length} ordinals, found ${objects.length}`,
            );
        }
        return objects;
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
        const count = row ? (row as any).count : 0;
        return count;
    }

    private appendObject(obj: T): void {
        const json = this.serializer
            ? this.serializer.serialize(obj)
            : JSON.stringify(obj);
        this.sql_append.run(json);
        this.count++;
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
