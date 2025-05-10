// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import {
    NormalizedEmbedding,
    ScoredItem,
    createTopNList,
    createTopNListAll,
    dotProduct,
} from "typeagent";

export type EmbeddingOrdinal = number;

export class SqliteEmbeddingIndex implements kp.IEmbeddingIndex {
    private count: number;
    private sql_add: sqlite.Statement;
    private sql_all: sqlite.Statement;
    private sql_get: sqlite.Statement;

    constructor(
        public db: sqlite.Database,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        if (ensureExists) {
            this.ensureDb();
        }
        this.sql_add = this.sqlAdd();
        this.sql_all = this.sqlAll();
        this.sql_get = this.sqlGet();
        this.count = this.loadCount();
    }

    public get size(): number {
        return this.count;
    }

    public push(embeddings: NormalizedEmbedding | NormalizedEmbedding[]): void {
        if (Array.isArray(embeddings)) {
            for (const embedding of embeddings) {
                this.append(embedding);
            }
        } else {
            this.append(embeddings);
        }
    }

    public append(embedding: NormalizedEmbedding): EmbeddingOrdinal {
        const buffer = Buffer.from(embedding.buffer);
        const result = this.sql_add.run(buffer);
        ++this.count;
        return result.lastInsertRowid as number;
    }

    public get(ordinal: EmbeddingOrdinal): NormalizedEmbedding | undefined {
        const row = this.sql_get.get(ordinal) as VectorRow;
        const embedding = row ? this.deserialize(row.embedding) : undefined;
        return embedding;
    }

    public nearestNeighbor(
        value: NormalizedEmbedding,
        minScore?: number,
    ): ScoredItem<EmbeddingOrdinal> | undefined {
        minScore ??= 0;
        let bestScore = Number.MIN_VALUE;
        let bestKey: EmbeddingOrdinal | undefined;
        for (const row of this.allRows()) {
            const score = dotProduct(this.deserialize(row.embedding), value);
            if (score >= minScore && score > bestScore) {
                bestScore = score;
                bestKey = row.ordinal - 1;
            }
        }
        return bestKey !== undefined
            ? {
                  score: bestScore,
                  item: bestKey,
              }
            : undefined;
    }

    public nearestNeighbors(
        value: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): ScoredItem<EmbeddingOrdinal>[] {
        minScore ??= 0;
        const matches =
            maxMatches && maxMatches > 0
                ? createTopNList<EmbeddingOrdinal>(maxMatches)
                : createTopNListAll<EmbeddingOrdinal>();
        for (const row of this.allRows()) {
            const score: number = dotProduct(
                this.deserialize(row.embedding),
                value,
            );
            if (score >= minScore) {
                matches.push(row.ordinal - 1, score);
            }
        }
        return matches.byRank();
    }

    private *allRows(): IterableIterator<VectorRow> {
        for (const row of this.sql_all.iterate()) {
            yield row as VectorRow;
        }
    }

    private deserialize(embedding: Buffer): Float32Array {
        return new Float32Array(embedding.buffer);
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

    private ensureDb() {
        const schemaSql = `  
        CREATE TABLE IF NOT EXISTS ${this.tableName} (  
          ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          embedding BLOB NOT NULL
        );`;
        this.db.exec(schemaSql);
    }

    private sqlAdd() {
        return this.db.prepare(
            `INSERT INTO ${this.tableName} (embedding) VALUES (?)`,
        );
    }

    private sqlAll() {
        return this.db.prepare(`SELECT * from ${this.tableName}`);
    }

    private sqlGet() {
        return this.db.prepare(
            `SELECT embedding from ${this.tableName} WHERE ordinal = ?`,
        );
    }
}

type VectorRow = {
    ordinal: EmbeddingOrdinal;
    embedding: Buffer;
};
