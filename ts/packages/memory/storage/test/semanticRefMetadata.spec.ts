// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type * as sqlite from "better-sqlite3";
import * as kp from "@typeagent/knowpro";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import { SqlSemanticRefCollection } from "../src/sqlite/sqliteProvider.js";
import { SqliteCollection } from "../src/sqlite/sqliteCollection.js";

function refs(count: number): kp.SemanticRef[] {
    return Array.from({ length: count }, (_, ordinal) => ({
        semanticRefOrdinal: ordinal,
        knowledgeType: "topic",
        range: { start: { messageOrdinal: ordinal, chunkOrdinal: 0 } },
        knowledge: { text: `Synthetic topic ${ordinal}` },
    }));
}

describe("positional semantic-reference metadata across storage providers", () => {
    let directory: string;
    let db: sqlite.Database;
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "semantic-metadata-"));
        db = createDatabase(path.join(directory, "test.db"), true);
    });
    afterEach(async () => {
        db.close();
        await rm(directory, { recursive: true, force: true });
    });

    test.each(["memory", "sqlite"] as const)(
        "%s preserves positions, duplicates and errors",
        (backend) => {
            const collection =
                backend === "memory"
                    ? new kp.SemanticRefCollection()
                    : new SqlSemanticRefCollection(db);
            collection.append(...refs(4));
            const ordinals = [3, 0, 3, 1];
            expect([
                ...kp.getSemanticRefMetadata(collection, ordinals),
            ]).toEqual(
                ordinals.map((ordinal) => {
                    const { knowledge: _knowledge, ...metadata } =
                        refs(4)[ordinal];
                    return metadata;
                }),
            );
            expect(collection.getMultiple(ordinals)).toEqual(
                ordinals.map((ordinal) => refs(4)[ordinal]),
            );
            expect([...kp.getSemanticRefMetadata(collection, [])]).toEqual([]);
            expect(collection.getMultiple([])).toEqual([]);
            for (const ordinal of [-1, 4, 0.5, NaN])
                expect(() => [
                    ...kp.getSemanticRefMetadata(collection, [0, ordinal]),
                ]).toThrow();
        },
    );

    test("4096 metadata candidates use 32 metadata reads and no full knowledge", () => {
        const collection = new SqlSemanticRefCollection(db);
        collection.append(...refs(4096));
        const queries: string[] = [];
        db.pragma("journal_mode = WAL");
        // Invalid full JSON proves that the metadata read never parses the knowledge payload.
        db.exec("UPDATE semanticRefs SET value = 'not JSON'");
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            queries.push(sql);
            return originalPrepare(sql);
        }) as typeof db.prepare;
        const survivors = [
            ...kp.getSemanticRefMetadata(
                collection,
                Array.from({ length: 4096 }, (_, ordinal) => ordinal),
            ),
        ].filter((metadata) => metadata.range.start.messageOrdinal < 32);
        expect(survivors).toHaveLength(32);
        expect(queries).toHaveLength(32);
        expect(
            queries.every(
                (sql) =>
                    sql.includes("FROM semanticRefsMetadata") &&
                    !sql.includes("value"),
            ),
        ).toBe(true);
        db.prepare = originalPrepare;
    });

    test("legacy backfill, failed append, outer rollback and retry retain count parity", () => {
        const legacy = new SqliteCollection<kp.SemanticRef, number>(
            db,
            undefined,
            "semanticRefs",
        );
        legacy.append(...refs(2));
        const collection = new SqlSemanticRefCollection(db);
        expect(collection.getMetadataMultiple([1, 0])).toHaveLength(2);
        db.exec(
            "CREATE TRIGGER failMetadata BEFORE INSERT ON semanticRefsMetadata BEGIN SELECT RAISE(ABORT, 'injected'); END",
        );
        expect(() => collection.append(refs(3)[2])).toThrow("injected");
        expect(collection.length).toBe(2);
        db.exec("DROP TRIGGER failMetadata");
        expect(() =>
            db.transaction(() => {
                collection.append(refs(3)[2]);
                expect(collection.length).toBe(3);
                throw new Error("outer rollback");
            })(),
        ).toThrow("outer rollback");
        expect(collection.length).toBe(2);
        collection.append(refs(3)[2]);
        expect(collection.getMultiple([2, 0, 2])).toEqual([
            refs(3)[2],
            refs(3)[0],
            refs(3)[2],
        ]);
        db.close();
        db = createDatabase(path.join(directory, "test.db"), false);
        const reopened = new SqlSemanticRefCollection(db);
        expect(reopened.length).toBe(3);
        expect(reopened.getMetadataMultiple([2])[0].semanticRefOrdinal).toBe(2);
    });

    test("failed migration is explicit and retryable; future versions are rejected", () => {
        const legacy = new SqliteCollection<kp.SemanticRef, number>(
            db,
            undefined,
            "semanticRefs",
        );
        legacy.append(...refs(1));
        db.exec("UPDATE semanticRefs SET value = 'broken'");
        expect(() => new SqlSemanticRefCollection(db)).toThrow();
        expect(
            db.prepare("SELECT state FROM semanticRefsMetadataSchema").get(),
        ).toEqual({ state: "failed" });
        db.prepare("UPDATE semanticRefs SET value = ?").run(
            JSON.stringify(refs(1)[0]),
        );
        const collection = new SqlSemanticRefCollection(db);
        expect(collection.getMetadataMultiple([0])).toHaveLength(1);
        db.exec("UPDATE semanticRefsMetadataSchema SET version = 2");
        expect(() => new SqlSemanticRefCollection(db)).toThrow("Unsupported");
    });
});
