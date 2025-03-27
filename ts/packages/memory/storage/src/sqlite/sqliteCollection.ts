// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as sqlite from "better-sqlite3";
import { ICollection, IMessage, MessageOrdinal } from "knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteCollection<T, TOrdinal extends number>
    implements ICollection<T, TOrdinal>
{
    private db: sqlite.Database;
    private count: number;
    private sql_get: sqlite.Statement;
    private sql_push: sqlite.Statement;
    private sql_getAll: sqlite.Statement;

    constructor(
        db: sqlite.Database,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        this.db = db;
        if (ensureExists) {
            this.ensureDb();
        }
        this.count = this.loadCount();
        this.sql_get = this.sqlGet();
        this.sql_push = this.sqlPush();
        this.sql_getAll = this.sqlGetAll();
    }

    public get length(): number {
        return this.count;
    }

    public push(...items: T[]): void {
        for (const item of items) {
            this.pushObject(item);
        }
    }

    public get(ordinal: TOrdinal): T | undefined {
        const actualOrdinal = ordinal + 1;
        const row = this.sql_get.get(actualOrdinal);
        if (row !== undefined) {
            return this.deserializeObject(row);
        }
        return undefined;
    }

    public getMultiple(ordinals: TOrdinal[]): (T | undefined)[] {
        let actualOrdinals: number[] = new Array<number>(ordinals.length);
        for (let i = 0; i < ordinals.length; ++i) {
            actualOrdinals[i] = ordinals[i] + 1;
        }
        const placeholder = sql_makeInPlaceholders(ordinals.length);
        const sql = this.db.prepare(
            `SELECT value FROM ${this.tableName} WHERE ordinal IN (${placeholder})`,
        );
        const objects: (T | undefined)[] = [];
        for (const row of sql.iterate(...actualOrdinals)) {
            objects.push(this.deserializeObject(row));
        }
        return objects;
    }

    public getAll(): T[] {
        const objects: T[] = [];
        for (const row of this.sql_getAll.iterate()) {
            const value = this.deserializeObject(row);
            if (value !== undefined) {
                objects.push(value);
            }
        }
        return objects;
    }

    public *[Symbol.iterator](): Iterator<T, any, any> {
        for (const row of this.sql_getAll.iterate()) {
            const value = this.deserializeObject(row);
            if (value !== undefined) {
                yield value;
            }
        }
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

    private pushObject(obj: T): void {
        const json = JSON.stringify(obj);
        this.sql_push.run(json);
        this.count++;
    }

    private deserializeObject(row: unknown): T | undefined {
        try {
            const data = row as CollectionRow;
            if (data.value) {
                return JSON.parse(data.value);
            }
        } catch {}
        return undefined;
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
    private sqlPush() {
        return this.db.prepare(
            `INSERT INTO ${this.tableName} (value) VALUES (?)`,
        );
    }
    private sqlGetAll() {
        return this.db.prepare(`SELECT value FROM ${this.tableName}`);
    }
}

type CollectionRow = {
    ordinal: number;
    value: string;
};

export class SqlMessageCollection<
    TMessage extends IMessage,
> extends SqliteCollection<TMessage, MessageOrdinal> {
    constructor(
        db: sqlite.Database,
        tableName: string,
        ensureExists: boolean = true,
    ) {
        super(db, tableName, ensureExists);
    }
}
