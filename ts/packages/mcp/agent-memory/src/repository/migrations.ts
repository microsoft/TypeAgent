// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Clock } from "../domain/index.js";
import { SystemClock } from "../domain/index.js";

export type Migration = {
    version: number;
    name: string;
    sql: string;
    checksum: string;
};

type AppliedMigration = {
    version: number;
    name: string;
    checksum: string;
};

const migrationFilePattern = /^(\d+)_([a-z0-9_]+)\.sql$/;

export function defaultMigrationsDirectory(): string {
    return fileURLToPath(new URL("../../../migrations/", import.meta.url));
}

export function loadMigrations(
    directory: string = defaultMigrationsDirectory(),
): Migration[] {
    const migrations = readdirSync(directory, { withFileTypes: true })
        .filter(
            (entry) => entry.isFile() && migrationFilePattern.test(entry.name),
        )
        .map((entry) => {
            const match = migrationFilePattern.exec(entry.name)!;
            const sql = readFileSync(path.join(directory, entry.name), "utf8");
            return {
                version: Number.parseInt(match[1]!, 10),
                name: match[2]!,
                sql,
                checksum: checksum(sql),
            };
        })
        .sort((left, right) => left.version - right.version);

    for (let index = 0; index < migrations.length; index++) {
        const migration = migrations[index]!;
        if (migration.version !== index + 1) {
            throw new Error(
                `Expected migration version ${index + 1}, found ${migration.version}`,
            );
        }
    }

    return migrations;
}

export function applyMigrations(
    database: Database.Database,
    migrations: readonly Migration[],
    clock: Clock = new SystemClock(),
): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        ) STRICT
    `);

    const applied = database
        .prepare(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
        )
        .all() as AppliedMigration[];

    for (const migration of applied) {
        const expected = migrations.find(
            (candidate) => candidate.version === migration.version,
        );
        if (
            expected === undefined ||
            expected.name !== migration.name ||
            expected.checksum !== migration.checksum
        ) {
            throw new Error(
                `Applied migration ${migration.version} does not match the packaged migration`,
            );
        }
    }

    const insertMigration = database.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
    `);
    const applyMigration = database.transaction((migration: Migration) => {
        database.exec(migration.sql);
        insertMigration.run(
            migration.version,
            migration.name,
            migration.checksum,
            clock.now().toISOString(),
        );
    });

    const appliedVersions = new Set(
        applied.map((migration) => migration.version),
    );
    for (const migration of migrations) {
        if (!appliedVersions.has(migration.version)) {
            applyMigration(migration);
        }
    }
}

export function createMigration(
    version: number,
    name: string,
    sql: string,
): Migration {
    return { version, name, sql, checksum: checksum(sql) };
}

function checksum(sql: string): string {
    return createHash("sha256").update(sql).digest("hex");
}
