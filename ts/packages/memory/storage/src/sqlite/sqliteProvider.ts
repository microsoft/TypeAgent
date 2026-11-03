// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "@typeagent/knowpro";
import type * as sqlite from "better-sqlite3";
import path from "path";
import { SqliteCollection } from "./sqliteCollection.js";
import { createDatabase } from "./sqliteCommon.js";
import { SqliteDataFrame } from "./sqliteDataFrame.js";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqlMessageCollection<TMessage extends kp.IMessage = kp.IMessage>
    extends SqliteCollection<TMessage, kp.MessageOrdinal>
    implements kp.IMessageCollection<TMessage>
{
    constructor(
        db: sqlite.Database,
        serializer?: kp.JsonSerializer<TMessage>,
        tableName: string = "messages",
        ensureExists: boolean = true,
    ) {
        super(db, serializer, tableName, ensureExists);
    }
}

export class SqlSemanticRefCollection
    extends SqliteCollection<kp.SemanticRef, kp.SemanticRefOrdinal>
    implements kp.ISemanticRefCollection
{
    private readonly metadataTable: string;
    private readonly schemaTable: string;
    constructor(
        db: sqlite.Database,
        tableName: string = "semanticRefs",
        ensureExists: boolean = true,
    ) {
        super(db, undefined, tableName, ensureExists);
        this.metadataTable = `${tableName}Metadata`;
        this.schemaTable = `${this.metadataTable}Schema`;
        this.ensureMetadata();
    }

    public override append(...items: kp.SemanticRef[]): void {
        this.db.transaction(() => {
            const start = this.length;
            items.forEach((item, index) => {
                if (item.semanticRefOrdinal !== start + index)
                    throw new Error(
                        "Semantic-reference ordinal must match collection position",
                    );
            });
            super.append(...items);
            const insert = this.metadataInsert();
            items.forEach((item) =>
                insert.run(
                    item.semanticRefOrdinal + 1,
                    JSON.stringify(item.range),
                    item.knowledgeType,
                ),
            );
        })();
    }

    public getMetadataMultiple(
        ordinals: kp.SemanticRefOrdinal[],
    ): kp.SemanticRefMetadata[] {
        const byOrdinal = new Map<number, kp.SemanticRefMetadata>();
        const unique = [...new Set(ordinals)];
        for (let start = 0; start < unique.length; start += 128) {
            const batch = unique.slice(start, start + 128);
            const sql = this.db.prepare(
                `SELECT ordinal, range, knowledgeType FROM ${this.metadataTable} WHERE ordinal IN (${sql_makeInPlaceholders(batch.length)})`,
            );
            for (const row of sql.iterate(
                ...batch.map((ordinal) => ordinal + 1),
            )) {
                const data = row as {
                    ordinal: number;
                    range: string;
                    knowledgeType: kp.KnowledgeType;
                };
                byOrdinal.set(data.ordinal - 1, {
                    semanticRefOrdinal: data.ordinal - 1,
                    range: JSON.parse(data.range),
                    knowledgeType: data.knowledgeType,
                });
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

    private metadataInsert(): sqlite.Statement {
        return this.db.prepare(
            `INSERT INTO ${this.metadataTable} (ordinal, range, knowledgeType) VALUES (?, ?, ?)`,
        );
    }

    private ensureMetadata(): void {
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.schemaTable} (
            id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, state TEXT NOT NULL)`);
        const schema = this.db
            .prepare(
                `SELECT version, state FROM ${this.schemaTable} WHERE id = 1`,
            )
            .get() as { version: number; state: string } | undefined;
        if (schema && schema.version !== 1)
            throw new Error(
                "Unsupported semantic-reference metadata schema version",
            );
        if (schema?.state === "complete") return;
        try {
            this.db.transaction(() => {
                this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.metadataTable} (
                    ordinal INTEGER PRIMARY KEY, range TEXT NOT NULL, knowledgeType TEXT NOT NULL)`);
                this.db.exec(`DELETE FROM ${this.metadataTable}`);
                const insert = this.metadataInsert();
                const select = this.db.prepare(
                    `SELECT ordinal, value FROM ${this.tableName} WHERE ordinal > ? ORDER BY ordinal LIMIT 128`,
                );
                let last = 0;
                while (true) {
                    const rows = select.all(last) as {
                        ordinal: number;
                        value: string;
                    }[];
                    if (!rows.length) break;
                    for (const data of rows) {
                        const ref: kp.SemanticRef = JSON.parse(data.value);
                        if (ref.semanticRefOrdinal !== data.ordinal - 1)
                            throw new Error(
                                "Invalid persisted semantic-reference ordinal",
                            );
                        insert.run(
                            data.ordinal,
                            JSON.stringify(ref.range),
                            ref.knowledgeType,
                        );
                        last = data.ordinal;
                    }
                }
                this.db
                    .prepare(
                        `INSERT OR REPLACE INTO ${this.schemaTable} VALUES (1, 1, 'complete')`,
                    )
                    .run();
            })();
        } catch (error) {
            this.db
                .prepare(
                    `INSERT OR REPLACE INTO ${this.schemaTable} VALUES (1, 1, 'failed')`,
                )
                .run();
            throw error;
        }
    }
}

export class SqliteStorageProvider
    implements kp.IStorageProvider, kp.dataFrame.IDataFrameStorageProvider
{
    private db: sqlite.Database;

    constructor(dbPath: string, createNew: boolean) {
        this.db = createDatabase(dbPath, createNew);
    }

    public createMessageCollection<TMessage extends kp.IMessage = kp.IMessage>(
        serializer?: kp.JsonSerializer<TMessage>,
    ): kp.IMessageCollection<TMessage> {
        return new SqlMessageCollection(this.db, serializer);
    }

    public createSemanticRefCollection(): kp.ISemanticRefCollection {
        return new SqlSemanticRefCollection(this.db);
    }

    public createDataFrame(
        name: string,
        columns:
            | kp.dataFrame.DataFrameColumns
            | [string, kp.dataFrame.DataFrameColumnDef][],
    ): kp.dataFrame.IDataFrame {
        return new SqliteDataFrame(this.db, name, columns);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}

export function createSqlStorageProvider(
    dirPath: string,
    baseFileName: string,
    createNew: boolean,
): SqliteStorageProvider {
    const dbPath = path.join(dirPath, baseFileName + ".db");
    return new SqliteStorageProvider(dbPath, createNew);
}
