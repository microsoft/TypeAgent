// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { Embedding, ScoredItem, SimilarityType, VectorStore } from "typeagent";
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
      embedding BLOB NOT NULL,
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
        const buffer = Buffer.from(value);
        sql_add.run(id, buffer);
        return Promise.resolve(id);
    }

    function get(id: TKeyId): Promise<Embedding | undefined> {
        const row = sql_getEmbedding.get(id) as VectorRow;
        const embedding = row
            ? new Float32Array(row.embedding.buffer)
            : undefined;
        return Promise.resolve(embedding);
    }

    function remove(id: TKeyId): Promise<void> {
        sql_remove.run(id);
        return Promise.resolve();
    }

    function nearestNeighbor(
        value: Embedding,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<TKeyId> | undefined> {
        return Promise.resolve(undefined);
    }

    function nearestNeighbors(
        value: Embedding,
        maxMatches: number,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<TKeyId>[]> {
        return Promise.resolve([]);
    }

    type VectorRow = {
        keyId: TKeyId;
        embedding: Buffer;
    };
}
