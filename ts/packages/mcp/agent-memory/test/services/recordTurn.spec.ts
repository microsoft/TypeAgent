// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    DomainError,
    FixedClock,
    SequenceIdGenerator,
    createAccessScope,
    type AccessScope,
    type MemoryProvenance,
} from "../../src/domain/index.js";
import {
    SqliteMemoryRepository,
    openDatabaseConnection,
} from "../../src/repository/index.js";
import {
    RecordTurnService,
    type RecordTurnRequest,
} from "../../src/services/index.js";

const now = "2026-08-06T12:00:00.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "record-turn-test",
    observedAt: now,
};

describe("RecordTurnService", () => {
    let directory: string;
    let database: Database.Database;
    let repository: SqliteMemoryRepository;
    let service: RecordTurnService;
    let ids: SequenceIdGenerator;
    let scope: AccessScope;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-turn-"));
        database = openDatabaseConnection(path.join(directory, "memory.db"));
        repository = new SqliteMemoryRepository(database);
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 6));
        scope = createAccessScope(ids.generate("Scope"), {
            userId: "record-turn-user",
            agentId: "test-agent",
        });
        repository.saveScope(scope);
        service = new RecordTurnService(
            repository,
            new FixedClock(new Date(now)),
            ids,
        );
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("records a complete turn and warning-only missing note link atomically", () => {
        const artifactId = ids.generate("Artifact");
        const missingNoteId = ids.generate("DesignNote");
        const request = createRequest(ids, scope, {
            secondaryTopicPaths: ["/project/testing", "/project/testing"],
            terms: [
                { text: "SQLite", role: "method" },
                { text: " sqlite ", role: "artifact" },
            ],
            actions: [
                {
                    sequence: 0,
                    name: "record",
                    summary: "Stored the turn",
                    status: "completed",
                    affectedArtifactIds: [artifactId],
                },
            ],
            artifactChanges: [
                {
                    artifactId,
                    change: "created",
                    kind: "source",
                    name: "memory.ts",
                    summary: "Created memory service",
                },
            ],
            outputs: [
                {
                    artifactId,
                    designNotes: [{ designNoteId: missingNoteId }],
                },
            ],
            properties: [
                {
                    name: "validated",
                    valueType: "boolean",
                    value: true,
                },
            ],
        });

        const result = service.record(request);

        expect(result.secondaryTopicIds).toHaveLength(1);
        expect(result.termIds).toHaveLength(1);
        expect(result.warnings).toEqual([
            `Design note ${missingNoteId} revision current was not found`,
        ]);
        expect(countRows(database, "turns")).toBe(1);
        expect(countRows(database, "turn_topics")).toBe(2);
        expect(countRows(database, "artifact_changes")).toBe(1);
        expect(countRows(database, "topic_outputs")).toBe(1);
        expect(countRows(database, "topic_property_values")).toBe(1);
        expect(countRows(database, "search_documents")).toBeGreaterThan(0);
        expect(countRows(database, "idempotency_records")).toBe(1);
    });

    test("rolls back every write when a late facet fails", () => {
        const request = createRequest(ids, scope, {
            terms: [{ text: "rollback" }],
            outputs: [{ artifactId: ids.generate("Artifact") }],
        });

        expect(() => service.record(request)).toThrow();

        for (const table of [
            "topics",
            "terms",
            "turns",
            "topic_outputs",
            "search_documents",
            "idempotency_records",
        ]) {
            expect(countRows(database, table)).toBe(0);
        }
    });

    test("replays identical input and rejects changed input for the same key", () => {
        const request = createRequest(ids, scope);
        const first = service.record(request);

        expect(service.record(request)).toEqual(first);
        expect(countRows(database, "turns")).toBe(1);

        expectDomainError(
            () =>
                service.record({
                    ...request,
                    outcomeSummary: "Different result",
                }),
            "IDEMPOTENCY_CONFLICT",
        );
        expect(countRows(database, "turns")).toBe(1);
    });

    test("serializes duplicate submissions to one stored turn", async () => {
        const request = createRequest(ids, scope);

        const [left, right] = await Promise.all([
            Promise.resolve().then(() => service.record(request)),
            Promise.resolve().then(() => service.record(request)),
        ]);

        expect(right).toEqual(left);
        expect(countRows(database, "turns")).toBe(1);
        expect(countRows(database, "idempotency_records")).toBe(1);
    });
});

function createRequest(
    ids: SequenceIdGenerator,
    scope: AccessScope,
    overrides: Partial<RecordTurnRequest> = {},
): RecordTurnRequest {
    return {
        turnId: ids.generate("Turn"),
        idempotencyKey: "record-turn-1",
        scope,
        conversationId: "conversation-1",
        sequence: 1,
        primaryTopicPath: "/project/memory",
        requestSummary: "Create durable memory",
        outcomeSummary: "Recorded durable memory",
        occurredAt: now,
        provenance,
        ...overrides,
    };
}

function countRows(database: Database.Database, table: string): number {
    return database
        .prepare(`SELECT COUNT(*) FROM ${table}`)
        .pluck()
        .get() as number;
}

function expectDomainError(
    operation: () => unknown,
    code: DomainError["code"],
): void {
    try {
        operation();
        throw new Error("Expected operation to throw");
    } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe(code);
    }
}
