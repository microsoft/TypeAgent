// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    DomainError,
    SequenceIdGenerator,
    createAccessScope,
    createArtifact,
    createArtifactChange,
    createDesignNote,
    createGoal,
    createTerm,
    createTopic,
    createTopicOutput,
    createTopicPropertyDefinition,
    createTopicPropertyValue,
    createTurn,
    createTurnAggregate,
    type ActionEvent,
    type MemoryProvenance,
    type TurnAggregate,
} from "../../src/domain/index.js";
import {
    SqliteMemoryRepository,
    openDatabaseConnection,
} from "../../src/repository/index.js";

const now = "2026-08-05T12:00:00.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "repository-test",
    observedAt: now,
};

describe("SQLite memory repository", () => {
    let directory: string;
    let database: Database.Database;
    let repository: SqliteMemoryRepository;
    let ids: SequenceIdGenerator;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-repo-"));
        database = openDatabaseConnection(path.join(directory, "memory.db"));
        repository = new SqliteMemoryRepository(database);
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 5));
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("stores an aggregate and rebuilds deterministic search projections", () => {
        const fixture = createBaseFixture(repository, ids);

        expect(repository.rebuildSearchDocuments()).toBe(5);
        const first = repository.listSearchDocuments();
        expect(first.map((document) => document.entityKind)).toEqual([
            "action",
            "term",
            "topic",
            "topic",
            "turn",
        ]);
        expect(repository.rebuildSearchDocuments()).toBe(5);
        expect(repository.listSearchDocuments()).toEqual(first);
        expect(
            database
                .prepare(
                    `SELECT document_id FROM search_fts
                     WHERE search_fts MATCH ? ORDER BY document_id`,
                )
                .pluck()
                .all("memory"),
        ).toContain(`topic:${fixture.topic.topicId}:1`);
    });

    test("rejects cross-scope topic links before writing a turn", () => {
        const fixture = createBaseFixture(repository, ids, false);
        const secondScope = createAccessScope(ids.generate("Scope"), {
            userId: "second-user",
        });
        repository.saveScope(secondScope);
        const otherTopic = createTopic({
            topicId: ids.generate("Topic"),
            scopeId: secondScope.scopeId,
            displayName: "Other topic",
            createdAt: now,
        });
        repository.saveTopic(otherTopic);
        const aggregate = createTurnAggregate(
            fixture.turn,
            [
                {
                    turnId: fixture.turn.turnId,
                    topicId: otherTopic.topicId,
                    role: "primary",
                },
            ],
            [],
            [],
        );

        expectDomainError(
            () => repository.saveTurnAggregate(aggregate),
            "SCOPE_MISMATCH",
        );
        expect(rowCount(database, "turns")).toBe(0);
    });

    test("rolls back a partially written aggregate", () => {
        const fixture = createBaseFixture(repository, ids, false);
        const action: ActionEvent = {
            actionId: ids.generate("Action"),
            turnId: fixture.turn.turnId,
            sequence: 0,
            name: "write",
            summary: "Write memory",
            status: "completed",
            affectedGoalIds: [],
            affectedArtifactIds: [],
            affectedOutputIds: [],
            designNoteIds: [],
        };
        const aggregate: TurnAggregate = {
            turn: fixture.turn,
            topics: [
                {
                    turnId: fixture.turn.turnId,
                    topicId: fixture.topic.topicId,
                    role: "primary",
                },
            ],
            terms: [],
            actions: [action, { ...action, actionId: ids.generate("Action") }],
        };

        expect(() => repository.saveTurnAggregate(aggregate)).toThrow();
        expect(rowCount(database, "turns")).toBe(0);
        expect(rowCount(database, "turn_topics")).toBe(0);
        expect(rowCount(database, "actions")).toBe(0);
    });

    test("enforces foreign keys and one primary topic in SQLite", () => {
        const fixture = createBaseFixture(repository, ids);

        expect(() =>
            database
                .prepare(
                    "INSERT INTO turn_terms(turn_id, term_id) VALUES (?, ?)",
                )
                .run(fixture.turn.turnId, "missing-term"),
        ).toThrow();
        expect(() =>
            database
                .prepare(
                    `INSERT INTO turn_topics(turn_id, topic_id, scope_id, role)
                     VALUES (?, ?, ?, 'primary')`,
                )
                .run(
                    fixture.turn.turnId,
                    fixture.secondaryTopic.topicId,
                    fixture.scope.scopeId,
                ),
        ).toThrow();
    });

    test("stores artifacts, versioned facets, and typed properties", () => {
        const fixture = createBaseFixture(repository, ids);
        const artifact = createArtifact({
            artifactId: ids.generate("Artifact"),
            scopeId: fixture.scope.scopeId,
            kind: "file",
            name: "repository.ts",
            createdAt: now,
        });
        repository.saveArtifact(artifact);
        repository.saveArtifactChange(
            createArtifactChange(artifact, {
                turnId: fixture.turn.turnId,
                kind: "created",
                summary: "Created repository",
                occurredAt: now,
                provenance,
            }),
        );

        const goal = createGoal({
            goalId: ids.generate("Goal"),
            scopeId: fixture.scope.scopeId,
            topicId: fixture.topic.topicId,
            desiredState: "Persist agent memory",
            state: "active",
            updatedByTurnId: fixture.turn.turnId,
            updatedAt: now,
            provenance,
        });
        repository.saveGoal(goal);
        const note = createDesignNote({
            designNoteId: ids.generate("DesignNote"),
            scopeId: fixture.scope.scopeId,
            topicId: fixture.topic.topicId,
            title: "SQLite repository",
            body: "Use normalized authoritative tables.",
            addressedGoalIds: [goal.goalId],
            state: "accepted",
            updatedByTurnId: fixture.turn.turnId,
            updatedAt: now,
            provenance,
        });
        repository.saveDesignNote(note);
        const output = createTopicOutput(
            {
                outputId: ids.generate("Output"),
                scopeId: fixture.scope.scopeId,
                topicId: fixture.topic.topicId,
                artifactId: artifact.artifactId,
                state: "current",
                updatedByTurnId: fixture.turn.turnId,
                updatedAt: now,
                provenance,
            },
            [note],
        );
        repository.saveTopicOutput(output);
        repository.saveTopicOutput({
            ...output,
            state: "superseded",
            revision: 2,
        });

        const definition = createTopicPropertyDefinition({
            definitionId: ids.generate("PropertyDefinition"),
            scopeId: fixture.scope.scopeId,
            topicId: fixture.topic.topicId,
            name: "priority",
            valueType: "string",
            required: false,
            allowedValues: ["high", "low"],
        });
        repository.savePropertyDefinition(definition);
        repository.savePropertyValue(
            createTopicPropertyValue(definition, {
                value: "high",
                updatedByTurnId: fixture.turn.turnId,
                updatedAt: now,
            }),
        );

        expect(rowCount(database, "artifact_changes")).toBe(1);
        expect(rowCount(database, "goal_events")).toBe(1);
        expect(rowCount(database, "design_note_revisions")).toBe(1);
        expect(rowCount(database, "output_design_notes")).toBe(1);
        expect(
            database
                .prepare("SELECT output_revision FROM output_design_notes")
                .pluck()
                .get(),
        ).toBe(2);
        expect(
            database
                .prepare("SELECT value_json FROM topic_property_values")
                .pluck()
                .get(),
        ).toBe('"high"');
        expect(repository.rebuildSearchDocuments()).toBe(8);
    });

    test("rejects skipped facet revisions without partial history", () => {
        const fixture = createBaseFixture(repository, ids);
        const goal = createGoal({
            goalId: ids.generate("Goal"),
            scopeId: fixture.scope.scopeId,
            topicId: fixture.topic.topicId,
            desiredState: "Persist memory",
            state: "active",
            updatedByTurnId: fixture.turn.turnId,
            updatedAt: now,
            provenance,
        });
        repository.saveGoal(goal);

        expectDomainError(
            () => repository.saveGoal({ ...goal, revision: 3 }),
            "REVISION_CONFLICT",
        );
        expect(rowCount(database, "goal_events")).toBe(1);
    });
});

function createBaseFixture(
    repository: SqliteMemoryRepository,
    ids: SequenceIdGenerator,
    saveTurn = true,
) {
    const scope = createAccessScope(ids.generate("Scope"), {
        userId: "test-user",
        workspaceId: "test-workspace",
    });
    repository.saveScope(scope);
    const topic = createTopic({
        topicId: ids.generate("Topic"),
        scopeId: scope.scopeId,
        displayName: "Agent memory",
        createdAt: now,
    });
    repository.saveTopic(topic);
    const secondaryTopic = createTopic({
        topicId: ids.generate("Topic"),
        scopeId: scope.scopeId,
        displayName: "SQLite",
        createdAt: now,
    });
    repository.saveTopic(secondaryTopic);
    const term = createTerm(ids.generate("Term"), scope.scopeId, "Memory", now);
    repository.saveTerm(term);
    const turn = createTurn({
        turnId: ids.generate("Turn"),
        scopeId: scope.scopeId,
        conversationId: "conversation-1",
        sequence: 0,
        requestSummary: "Build agent memory",
        outcomeSummary: "Stored memory in SQLite",
        occurredAt: now,
        recordedAt: now,
        provenance,
    });
    if (saveTurn) {
        repository.saveTurnAggregate(
            createTurnAggregate(
                turn,
                [
                    {
                        turnId: turn.turnId,
                        topicId: topic.topicId,
                        role: "primary",
                    },
                    {
                        turnId: turn.turnId,
                        topicId: secondaryTopic.topicId,
                        role: "secondary",
                    },
                ],
                [{ turnId: turn.turnId, termId: term.termId, role: "subject" }],
                [
                    {
                        actionId: ids.generate("Action"),
                        turnId: turn.turnId,
                        sequence: 0,
                        name: "store",
                        summary: "Stored memory",
                        status: "completed",
                        affectedGoalIds: [],
                        affectedArtifactIds: [],
                        affectedOutputIds: [],
                        designNoteIds: [],
                    },
                ],
            ),
        );
    }
    return { scope, topic, secondaryTopic, term, turn };
}

function rowCount(database: Database.Database, table: string): number {
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
        throw new Error(`Expected domain error ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe(code);
    }
}
