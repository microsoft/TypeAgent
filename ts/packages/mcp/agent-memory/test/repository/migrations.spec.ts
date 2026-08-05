// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    applyMigrations,
    createMigration,
    loadMigrations,
    openDatabaseConnection,
    verifyFts5,
} from "../../src/repository/index.js";

describe("SQLite migrations", () => {
    let directory: string;
    let database: Database.Database | undefined;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-db-"));
    });

    afterEach(async () => {
        database?.close();
        database = undefined;
        await rm(directory, { recursive: true, force: true });
    });

    test("migrates an empty database and configures SQLite", () => {
        database = openDatabaseConnection(path.join(directory, "memory.db"));

        expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
        expect(
            database
                .prepare("SELECT version, name FROM schema_migrations")
                .all(),
        ).toEqual([{ version: 1, name: "initial_schema" }]);
        expect(
            database
                .prepare(
                    "SELECT name FROM sqlite_master WHERE name = 'search_fts'",
                )
                .get(),
        ).toEqual({ name: "search_fts" });
        expect(() => verifyFts5(database!)).not.toThrow();
    });

    test("reopening an up-to-date database changes nothing", () => {
        const filename = path.join(directory, "memory.db");
        database = openDatabaseConnection(filename);
        const firstAppliedAt = database
            .prepare(
                "SELECT applied_at FROM schema_migrations WHERE version = 1",
            )
            .pluck()
            .get();
        database.close();

        database = openDatabaseConnection(filename);
        expect(
            database
                .prepare(
                    "SELECT applied_at FROM schema_migrations WHERE version = 1",
                )
                .pluck()
                .get(),
        ).toBe(firstAppliedAt);
    });

    test("rolls back a failed migration", () => {
        database = openDatabaseConnection(path.join(directory, "memory.db"));
        const migrations = [
            ...loadMigrations(),
            createMigration(
                2,
                "failing_probe",
                "CREATE TABLE rollback_probe(value TEXT); INVALID SQL;",
            ),
        ];

        expect(() => applyMigrations(database!, migrations)).toThrow();
        expect(
            database
                .prepare(
                    "SELECT name FROM sqlite_master WHERE name = 'rollback_probe'",
                )
                .get(),
        ).toBeUndefined();
        expect(
            database
                .prepare("SELECT COUNT(*) FROM schema_migrations")
                .pluck()
                .get(),
        ).toBe(1);
    });
});
