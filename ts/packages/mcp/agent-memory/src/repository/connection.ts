// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database from "better-sqlite3";
import type { Clock } from "../domain/index.js";
import {
    applyMigrations,
    defaultMigrationsDirectory,
    loadMigrations,
} from "./migrations.js";

export type OpenDatabaseOptions = {
    migrationsDirectory?: string;
    clock?: Clock;
    readonly?: boolean;
};

export function openDatabaseConnection(
    filename: string,
    options: OpenDatabaseOptions = {},
): Database.Database {
    const database = new Database(filename, {
        readonly: options.readonly ?? false,
        fileMustExist: options.readonly ?? false,
    });

    try {
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 5000");
        if (!options.readonly) {
            database.pragma("journal_mode = WAL");
            verifyFts5(database);
            applyMigrations(
                database,
                loadMigrations(
                    options.migrationsDirectory ?? defaultMigrationsDirectory(),
                ),
                options.clock,
            );
        }
        return database;
    } catch (error) {
        database.close();
        throw error;
    }
}

export function verifyFts5(database: Database.Database): void {
    database.exec(`
        DROP TABLE IF EXISTS temp.agent_memory_fts5_probe;
        CREATE VIRTUAL TABLE temp.agent_memory_fts5_probe USING fts5(content);
        INSERT INTO temp.agent_memory_fts5_probe(content) VALUES ('agent memory');
    `);
    try {
        const result = database
            .prepare(
                `SELECT content
                 FROM temp.agent_memory_fts5_probe
                 WHERE agent_memory_fts5_probe MATCH ?`,
            )
            .get("memory") as { content: string } | undefined;
        if (result?.content !== "agent memory") {
            throw new Error("SQLite FTS5 capability check failed");
        }
    } finally {
        database.exec("DROP TABLE IF EXISTS temp.agent_memory_fts5_probe");
    }
}
