// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import {
    Embedding,
    ScoredItem,
    SimilarityType,
    VectorStore,
    createTopNList,
    dotProduct,
    similarity,
} from "typeagent";
import { ValueType, ValueDataType } from "knowledge-processor";

export interface VectorTable<TKeyId extends ValueType = string>
    extends VectorStore<TKeyId> {}

export function createVectorTable<TKeyId extends ValueType = string>(
    db: sqlite.Database,
    tableName: string,
    keyType: ValueDataType<TKeyId>,
    ensureExists: boolean = true,
): VectorTable<TKeyId> {
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

    /*
    let dotProductParam: NormalizedEmbedding | undefined;
    db.function("dotProduct_1", dotProduct_1);
    const sql_dot1 = db.prepare(
        `SELECT keyId as item, dotProduct_1(embedding) as score FROM ${tableName}`,
    );
    */

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
        minScore ??= 0;
        let bestScore = Number.MIN_VALUE;
        let bestKey: TKeyId | undefined;
        for (const row of allRows()) {
            //const score = similarity(deserialize(row.embedding), value, type);
            const score = dotProduct(deserialize(row.embedding), value);
            if (score >= minScore && score > bestScore) {
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

    /*
    function dotProduct_1(xBuffer: unknown): number {
        const x = deserialize(xBuffer as Buffer);
        const y = dotProductParam!;
        return dotProduct(x, y);
    }
    */

    type VectorRow = {
        keyId: TKeyId;
        embedding: Buffer;
    };
}
