// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database from "better-sqlite3";
import { TextChunk, ChunkGroup, IndexState } from "./types.js";
import * as fs from "fs";
import * as path from "path";

import registerDebug from "debug";
const debug = registerDebug("kp:storage");

/**
 * SQLite storage for "cold" data: text chunks, metadata, groups.
 * These are too large to keep fully in memory for big corpora.
 *
 * The "hot" data (inverted index, dictionary, related terms) is stored
 * as JSON files loaded into memory at startup.
 */
export class ChunkStore {
    private db: Database.Database;

    constructor(dbPath: string) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.initSchema();
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chunks (
                chunkId INTEGER PRIMARY KEY,
                text TEXT NOT NULL,
                groupId TEXT,
                timestamp TEXT,
                metadata TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS chunk_groups (
                groupId TEXT PRIMARY KEY,
                groupType TEXT NOT NULL,
                label TEXT,
                chunkIds TEXT NOT NULL DEFAULT '[]',
                timeRangeStart TEXT,
                timeRangeEnd TEXT,
                metadata TEXT NOT NULL DEFAULT '{}'
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_groupId ON chunks(groupId);
            CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON chunks(timestamp);
            CREATE INDEX IF NOT EXISTS idx_groups_type ON chunk_groups(groupType);
        `);
    }

    // =========================================================================
    // Chunk Operations
    // =========================================================================

    addChunk(chunk: TextChunk): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO chunks (chunkId, text, groupId, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(
            chunk.chunkId,
            chunk.text,
            chunk.groupId ?? null,
            chunk.timestamp ?? null,
            JSON.stringify(chunk.metadata),
        );
    }

    addChunks(chunks: TextChunk[]): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO chunks (chunkId, text, groupId, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction((items: TextChunk[]) => {
            for (const chunk of items) {
                stmt.run(
                    chunk.chunkId,
                    chunk.text,
                    chunk.groupId ?? null,
                    chunk.timestamp ?? null,
                    JSON.stringify(chunk.metadata),
                );
            }
        });
        tx(chunks);
    }

    getChunk(chunkId: number): TextChunk | undefined {
        const row = this.db
            .prepare("SELECT * FROM chunks WHERE chunkId = ?")
            .get(chunkId) as any;
        if (!row) return undefined;
        return rowToChunk(row);
    }

    getChunks(chunkIds: number[]): TextChunk[] {
        if (chunkIds.length === 0) return [];
        const placeholders = chunkIds.map(() => "?").join(",");
        const rows = this.db
            .prepare(`SELECT * FROM chunks WHERE chunkId IN (${placeholders})`)
            .all(...chunkIds) as any[];
        return rows.map(rowToChunk);
    }

    getChunkCount(): number {
        const row = this.db
            .prepare("SELECT COUNT(*) as count FROM chunks")
            .get() as any;
        return row.count;
    }

    getNextChunkId(): number {
        const row = this.db
            .prepare("SELECT MAX(chunkId) as maxId FROM chunks")
            .get() as any;
        return (row.maxId ?? -1) + 1;
    }

    // =========================================================================
    // Group Operations
    // =========================================================================

    addGroup(group: ChunkGroup): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO chunk_groups
            (groupId, groupType, label, chunkIds, timeRangeStart, timeRangeEnd, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            group.groupId,
            group.groupType,
            group.label ?? null,
            JSON.stringify(group.chunkIds),
            group.timeRange?.start ?? null,
            group.timeRange?.end ?? null,
            JSON.stringify(group.metadata),
        );
    }

    getGroup(groupId: string): ChunkGroup | undefined {
        const row = this.db
            .prepare("SELECT * FROM chunk_groups WHERE groupId = ?")
            .get(groupId) as any;
        if (!row) return undefined;
        return rowToGroup(row);
    }

    getAllGroups(): ChunkGroup[] {
        const rows = this.db
            .prepare("SELECT * FROM chunk_groups")
            .all() as any[];
        return rows.map(rowToGroup);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    close(): void {
        this.db.close();
    }
}

// =========================================================================
// JSON Persistence for "hot" in-memory data
// =========================================================================

const INDEX_STATE_FILENAME = "index_state.json";

/**
 * Save the in-memory index state to a JSON file.
 */
export function saveIndexState(storagePath: string, state: IndexState): void {
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    const filePath = path.join(storagePath, INDEX_STATE_FILENAME);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    debug(`Saved index state to ${filePath}`);
}

/**
 * Load the in-memory index state from a JSON file.
 * Returns undefined if the file doesn't exist.
 */
export function loadIndexState(storagePath: string): IndexState | undefined {
    const filePath = path.join(storagePath, INDEX_STATE_FILENAME);
    if (!fs.existsSync(filePath)) return undefined;
    const data = fs.readFileSync(filePath, "utf-8");
    debug(`Loaded index state from ${filePath}`);
    return JSON.parse(data) as IndexState;
}

// =========================================================================
// Helpers
// =========================================================================

function rowToChunk(row: any): TextChunk {
    const chunk: TextChunk = {
        chunkId: row.chunkId,
        text: row.text,
        metadata: JSON.parse(row.metadata),
    };
    if (row.groupId) chunk.groupId = row.groupId;
    if (row.timestamp) chunk.timestamp = row.timestamp;
    return chunk;
}

function rowToGroup(row: any): ChunkGroup {
    const group: ChunkGroup = {
        groupId: row.groupId,
        groupType: row.groupType,
        chunkIds: JSON.parse(row.chunkIds),
        metadata: JSON.parse(row.metadata),
    };
    if (row.label) group.label = row.label;
    if (row.timeRangeStart || row.timeRangeEnd) {
        group.timeRange = {};
        if (row.timeRangeStart) group.timeRange.start = row.timeRangeStart;
        if (row.timeRangeEnd) group.timeRange.end = row.timeRangeEnd;
    }
    return group;
}
