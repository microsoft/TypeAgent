// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import {
    Embedding,
    ScoredItem,
    SimilarityType,
    VectorStore,
    createTopNList,
    similarity,
} from "typeagent";
import { ColumnType, SqlColumnType } from "./common.js";

export function createVectorStore<TKeyId extends ColumnType = string>(
    db: sqlite.Database,
    tableName: string,
    keyType: SqlColumnType<TKeyId>,
    ensureExists: boolean = true,
): VectorStore<TKeyId> {
    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      keyId ${keyType} PRIMARY KEY NOT NULL,
      embedding BLOB NOT NULL
    );`;

    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_exists = db.prepare(
        `SELECT keyId from ${tableName} WHERE keyId = ?`,
    );
    const sql_getEmbedding = db.prepare(
        `SELECT embedding from ${tableName} WHERE keyId = ?`,
    );
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO ${tableName} (keyId, embedding) VALUES (?, ?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE keyId = ?`);
    const sql_all = db.prepare(`SELECT * from ${tableName}`);

    return {
        exists,
        put,
        get,
        remove,
        nearestNeighbor,
        nearestNeighbors,
    };

    function exists(id: TKeyId): boolean {
        const row = sql_exists.get(id);
        return row !== undefined;
    }

    function put(value: Embedding, id?: TKeyId | undefined): Promise<TKeyId> {
        if (id === undefined) {
            // TODO: ID generation
            throw Error("id required");
        }
        const buffer = Buffer.from(value.buffer);
        sql_add.run(id, buffer);
        return Promise.resolve(id);
    }

    function get(id: TKeyId): Promise<Embedding | undefined> {
        const row = sql_getEmbedding.get(id) as VectorRow;
        const embedding = row ? deserialize(row.embedding) : undefined;
        return Promise.resolve(embedding);
    }

    function remove(id: TKeyId): Promise<void> {
        sql_remove.run(id);
        return Promise.resolve();
    }

    function nearestNeighbor(
        value: Embedding,
        type: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<TKeyId> | undefined> {
        let bestScore = Number.MIN_VALUE;
        let bestKey: TKeyId | undefined;
        for (const row of allRows()) {
            const score = similarity(deserialize(row.embedding), value, type);
            if (score > bestScore) {
                bestScore = score;
                bestKey = row.keyId;
            }
        }
        return Promise.resolve(
            bestKey
                ? {
                      score: bestScore,
                      item: bestKey,
                  }
                : undefined,
        );
    }

    function nearestNeighbors(
        value: Embedding,
        maxMatches: number,
        type: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<TKeyId>[]> {
        minScore ??= 0;
        const matches = createTopNList<TKeyId>(maxMatches);
        for (const row of allRows()) {
            const score: number = similarity(
                deserialize(row.embedding),
                value,
                type,
            );
            if (score >= minScore) {
                matches.push(row.keyId, score);
            }
        }
        return Promise.resolve(matches.byRank());
    }

    function* allRows(): IterableIterator<VectorRow> {
        for (const row of sql_all.iterate()) {
            yield row as VectorRow;
        }
    }

    function deserialize(embedding: Buffer): Float32Array {
        return new Float32Array(embedding.buffer);
    }

    type VectorRow = {
        keyId: TKeyId;
        embedding: Buffer;
    };
}
