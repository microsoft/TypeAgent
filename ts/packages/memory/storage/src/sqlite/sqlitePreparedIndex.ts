// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import type * as kp from "@typeagent/knowpro";
import { timeSearchStage } from "@typeagent/knowpro";
import { createHash } from "node:crypto";
import { SqliteCollection } from "./sqliteCollection.js";

export type PreparedIndexCheckpoint = (
    point: "rows" | "postings" | "receipt",
) => void;

export class SqlitePreparedIndexStorage implements kp.IPreparedIndexStorage {
    private readonly table: string;
    constructor(
        private readonly db: sqlite.Database,
        private readonly messages: SqliteCollection<kp.IMessage, number>,
        private readonly refs: SqliteCollection<kp.SemanticRef, number>,
        private readonly checkpoint?: PreparedIndexCheckpoint,
    ) {
        this.table = `${refs.tableName}PreparedIndex`;
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (
            id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
            source_stamp TEXT NOT NULL, data TEXT NOT NULL)`);
    }

    private sourceStamp(messageCount = this.messages.length): string {
        const hash = createHash("sha256");
        for (const [table, count] of [
            [this.messages.tableName, messageCount],
            [this.refs.tableName, this.refs.length],
        ] as const) {
            hash.update(table);
            for (const row of this.db
                .prepare(
                    `SELECT ordinal,value FROM ${table} WHERE ordinal<=? ORDER BY ordinal`,
                )
                .iterate(count))
                hash.update(JSON.stringify(row));
        }
        return hash.digest("hex");
    }

    public capture(includeIndex = true): kp.PreparedIndexSnapshot {
        return this.db.transaction(() => {
            const row = this.db
                .prepare(
                    `SELECT version,source_stamp,data FROM ${this.table} WHERE id=1`,
                )
                .get() as
                | { version: number; source_stamp: string; data: string }
                | undefined;
            if (row && row.version !== 1)
                throw new Error("Unsupported prepared index schema version");
            const stamp = createHash("sha256")
                .update(this.sourceStamp())
                .update(JSON.stringify(row) ?? "")
                .digest("hex");
            if (!includeIndex || !row) return { stamp };
            const data: kp.PreparedIndexData = JSON.parse(
                row.data,
                (key, value: unknown) =>
                    key === "embeddings" && Array.isArray(value)
                        ? value.map((vector: number[]) =>
                              Float32Array.from(vector),
                          )
                        : value,
            );
            if (
                !Number.isSafeInteger(data.indexedMessageCount) ||
                data.indexedMessageCount < 0 ||
                data.indexedMessageCount > this.messages.length ||
                this.sourceStamp(data.indexedMessageCount) !== row.source_stamp
            )
                throw new Error(
                    "Prepared index source revision changed; rebuild the index",
                );
            return { stamp, data };
        })();
    }

    public commit(expectedStamp: string, batch: kp.PreparedIndexBatch): void {
        if (this.db.inTransaction)
            throw new Error("Prepared commit must own its SQLite transaction");
        if (batch.data.indexedMessageCount !== batch.messages.length)
            throw new Error(
                "Prepared receipt must cover the complete message batch",
            );
        const data = JSON.stringify(batch.data, (_key, value: unknown) =>
            value instanceof Float32Array ? Array.from(value) : value,
        );
        timeSearchStage(
            "ingestion.sqlite.commit",
            () =>
                this.db.transaction(() => {
                    if (this.capture(false).stamp !== expectedStamp)
                        throw new Error("Prepared index snapshot is stale");
                    if (batch.messages.length !== this.messages.length)
                        throw new Error(
                            "Prepared batch cannot drop accepted source messages",
                        );
                    this.messages.replaceAll(batch.messages);
                    this.refs.replaceAll(batch.semanticRefs);
                    this.checkpoint?.("rows");
                    // Postings and vectors share one versioned artifact; publication is its receipt.
                    this.db
                        .prepare(
                            `INSERT OR REPLACE INTO ${this.table} VALUES(1,1,?,?)`,
                        )
                        .run(this.sourceStamp(), data);
                    this.checkpoint?.("postings");
                    this.checkpoint?.("receipt");
                })(),
            {
                messageCount: batch.messages.length,
                semanticRefCount: batch.semanticRefs.length,
            },
        );
    }
}
