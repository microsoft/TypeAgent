// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    DomainError,
    FixedClock,
    SequenceIdGenerator,
    asId,
    createAccessScope,
    createGoal,
    createTopicAlias,
    evaluateMemoryQuery,
    hashQuery,
    normalizeQuery,
    parseQueryLanguage,
    type AccessScope,
    type MemoryProvenance,
    type QueryIrV1,
} from "../../src/index.js";
import {
    SqliteMemoryRepository,
    openDatabaseConnection,
} from "../../src/repository/index.js";
import {
    RecordTurnService,
    type RecordTurnRequest,
    type RecordTurnResult,
} from "../../src/services/index.js";

const recordedAt = "2026-08-05T12:00:00.000Z";
const occurredAt = "2026-08-04T18:00:00.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "query-evaluator-test",
    observedAt: occurredAt,
};

describe("memory query evaluator", () => {
    let directory: string;
    let repository: SqliteMemoryRepository;
    let ids: SequenceIdGenerator;
    let scope: AccessScope;
    let service: RecordTurnService;

    beforeEach(async () => {
        directory = await mkdtemp(
            path.join(os.tmpdir(), "agent-memory-query-"),
        );
        repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 5));
        scope = createAccessScope(ids.generate("Scope"), {
            userId: "query-user",
        });
        repository.saveScope(scope);
        service = new RecordTurnService(
            repository,
            new FixedClock(new Date(recordedAt)),
            ids,
        );
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("ranks soft-AND hits and never admits another scope", () => {
        const both = recordTurn(service, scope, ids, 1, {
            requestSummary: "Build SQLite memory evaluator",
            outcomeSummary: "SQLite memory query works",
            terms: [{ text: "sqlite" }, { text: "memory" }],
        });
        const sqliteOnly = recordTurn(service, scope, ids, 2, {
            requestSummary: "Build SQLite evaluator",
            outcomeSummary: "SQLite query works",
            terms: [{ text: "sqlite" }],
        });
        const otherScope = createAccessScope(ids.generate("Scope"), {
            userId: "other-query-user",
        });
        repository.saveScope(otherScope);
        const otherService = new RecordTurnService(
            repository,
            new FixedClock(new Date(recordedAt)),
            ids,
        );
        const foreign = recordTurn(otherService, otherScope, ids, 1, {
            requestSummary: "Build SQLite memory evaluator",
            outcomeSummary: "Foreign SQLite memory query",
            terms: [{ text: "sqlite" }, { text: "memory" }],
        });

        const result = evaluateMemoryQuery(
            repository,
            parse("/topics/project/memory/turns where sqlite + memory"),
        );

        expect(result.records.map((record) => record.entityId)).toEqual([
            both.turnId,
            sqliteOnly.turnId,
        ]);
        expect(result.records.map((record) => record.hitCount)).toEqual([2, 1]);
        expect(
            result.records.some((record) => record.entityId === foreign.turnId),
        ).toBe(false);
        expect(result.records[0]!.evidence).toHaveLength(2);
    });

    test("distinguishes primary from secondary topic postings", () => {
        const secondary = recordTurn(service, scope, ids, 1, {
            secondaryTopicPaths: ["/project/sqlite"],
        });
        const primary = recordTurn(service, scope, ids, 2, {
            primaryTopicPath: "/project/sqlite",
        });
        const base = parse("/topics/project/sqlite/turns");
        const primaryOnly = normalizeQuery({
            ...base,
            topic: { ...base.topic!, roles: ["primary"] },
        });

        expect(
            evaluateMemoryQuery(repository, base).records.map(
                (record) => record.entityId,
            ),
        ).toEqual([secondary.turnId, primary.turnId].sort());
        expect(
            evaluateMemoryQuery(repository, primaryOnly).records.map(
                (record) => record.entityId,
            ),
        ).toEqual([primary.turnId]);
    });

    test("executes term, artifact, and direct-turn structural routes", () => {
        const artifactId = ids.generate("Artifact");
        const turn = recordTurn(service, scope, ids, 1, {
            terms: [{ text: "eigenvalue" }],
            artifactChanges: [
                {
                    artifactId,
                    change: "created",
                    kind: "source",
                    name: "evaluator.ts",
                    summary: "Created evaluator",
                },
            ],
        });

        for (const query of [
            parse("/terms/eigenvalue/turns"),
            parse(`/artifacts/${artifactId}/turns`),
            parse(`/turns/${turn.turnId}`),
        ]) {
            expect(
                evaluateMemoryQuery(repository, query).records.map(
                    (record) => record.entityId,
                ),
            ).toEqual([turn.turnId]);
        }
    });

    test("resolves recursive ancestors and aliases without duplicate results", () => {
        const turn = recordTurn(service, scope, ids, 1, {
            primaryTopicPath: "/project/memory/evaluator",
            secondaryTopicPaths: ["/project/memory"],
        });
        const rootTurn = recordTurn(service, scope, ids, 2, {
            primaryTopicPath: "/project",
        });
        const topic = repository.findTopicByPath(
            scope.scopeId,
            "/project/memory/evaluator",
        )!;
        repository.saveTopicAlias(
            createTopicAlias(topic, "/work/query", recordedAt),
        );

        expect(
            evaluateMemoryQuery(
                repository,
                parse("/topics/project/**/turns"),
            ).records.map((record) => record.entityId),
        ).toEqual([turn.turnId, rootTurn.turnId].sort());
        expect(
            evaluateMemoryQuery(
                repository,
                parse("/topics/work/query/turns"),
            ).records.map((record) => record.entityId),
        ).toEqual([turn.turnId]);
    });

    test("distinguishes occurred time from recorded change time", () => {
        const turn = recordTurn(service, scope, ids, 1);
        const duringOccurred = withTemporal(
            parse("/topics/project/memory/turns"),
            {
                type: "during",
                start: "2026-08-04T00:00:00.000Z",
                end: "2026-08-05T00:00:00.000Z",
            },
        );
        const changedWhenRecorded = withTemporal(
            parse("/topics/project/memory/turns"),
            {
                type: "changedDuring",
                start: "2026-08-05T00:00:00.000Z",
                end: "2026-08-06T00:00:00.000Z",
                projection: "matchingEvents",
            },
        );

        expect(
            evaluateMemoryQuery(repository, duringOccurred).records[0]!
                .entityId,
        ).toBe(turn.turnId);
        expect(
            evaluateMemoryQuery(repository, changedWhenRecorded).records[0]!
                .entityId,
        ).toBe(turn.turnId);
        expect(
            evaluateMemoryQuery(
                repository,
                withTemporal(parse("/topics/project/memory/turns"), {
                    type: "during",
                    start: "2026-08-05T00:00:00.000Z",
                    end: "2026-08-06T00:00:00.000Z",
                }),
            ).records,
        ).toHaveLength(0);
    });

    test("projects the final state at the end of the changed interval", () => {
        const firstTurn = recordTurn(service, scope, ids, 1);
        const secondTurn = recordTurn(service, scope, ids, 2);
        const goal = createGoal({
            goalId: ids.generate("Goal"),
            scopeId: scope.scopeId,
            topicId: asId(firstTurn.primaryTopicId, "Topic"),
            desiredState: "Evaluator implemented",
            state: "active",
            updatedByTurnId: asId(firstTurn.turnId, "Turn"),
            updatedAt: "2026-08-04T20:00:00.000Z",
            provenance,
        });
        repository.saveGoal(goal);
        repository.saveGoal({
            ...goal,
            state: "achieved",
            revision: 2,
            updatedByTurnId: asId(secondTurn.turnId, "Turn"),
            updatedAt: "2026-08-05T20:00:00.000Z",
        });
        repository.rebuildSearchDocuments();

        const result = evaluateMemoryQuery(
            repository,
            withTemporal(parse("/topics/project/memory/goals"), {
                type: "changedDuring",
                start: "2026-08-04T00:00:00.000Z",
                end: "2026-08-05T00:00:00.000Z",
                projection: "endState",
            }),
        );

        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            entityId: goal.goalId,
            revision: 1,
            fields: { state: "active" },
            eventReferences: [`${goal.goalId}:1`],
        });
    });

    test("binds continuation evaluation to the search index version", () => {
        recordTurn(service, scope, ids, 1);
        const query = parse("/topics/project/memory/turns");
        const first = evaluateMemoryQuery(repository, query);
        const continued = normalizeQuery({
            ...query,
            continuation: {
                queryHash: hashQuery(query),
                indexVersion: first.indexVersion,
                lastEntityId: first.records[0]!.entityId,
                sortValues: [first.records[0]!.entityId],
            },
        });

        expect(evaluateMemoryQuery(repository, continued).indexVersion).toBe(
            first.indexVersion,
        );
        repository.rebuildSearchDocuments();
        expect(() => evaluateMemoryQuery(repository, continued)).toThrow(
            DomainError,
        );
    });

    function parse(input: string): QueryIrV1 {
        return parseQueryLanguage(input, {
            scopeId: scope.scopeId,
            timeZone: "UTC",
            now: new Date(recordedAt),
        });
    }
});

function recordTurn(
    service: RecordTurnService,
    scope: AccessScope,
    ids: SequenceIdGenerator,
    sequence: number,
    overrides: Partial<RecordTurnRequest> = {},
): RecordTurnResult {
    return service.record({
        turnId: ids.generate("Turn"),
        idempotencyKey: `query-turn-${scope.scopeId}-${sequence}`,
        scope,
        conversationId: `conversation-${scope.scopeId}`,
        sequence,
        primaryTopicPath: "/project/memory",
        requestSummary: "Build durable memory",
        outcomeSummary: "Recorded durable memory",
        occurredAt,
        provenance,
        ...overrides,
    });
}

function withTemporal(
    query: QueryIrV1,
    temporal: NonNullable<QueryIrV1["temporal"]>,
): QueryIrV1 {
    return normalizeQuery({ ...query, temporal });
}
