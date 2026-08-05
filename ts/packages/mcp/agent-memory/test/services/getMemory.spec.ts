// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FixedClock,
    MemoryGetService,
    RecordTurnService,
    SequenceIdGenerator,
    createAccessScope,
    type AccessScope,
    type MemoryProvenance,
    type RecordTurnRequest,
} from "../../src/index.js";
import { SqliteMemoryRepository } from "../../src/repository/index.js";

const now = "2026-08-10T12:00:00.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "get-service-test",
    observedAt: now,
};

describe("MemoryGetService", () => {
    let directory: string;
    let repository: SqliteMemoryRepository;
    let ids: SequenceIdGenerator;
    let scope: AccessScope;
    let recorder: RecordTurnService;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-get-"));
        repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 10));
        scope = createAccessScope(ids.generate("Scope"), {
            userId: "get-service-user",
        });
        repository.saveScope(scope);
        recorder = new RecordTurnService(
            repository,
            new FixedClock(new Date(now)),
            ids,
        );
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("retrieves an exact historical goal revision", () => {
        const goalId = ids.generate("Goal");
        recorder.record(
            createTurn(ids, scope, 1, {
                goalId,
                desiredState: "Ship the first query contract",
                revision: 1,
            }),
        );
        recorder.record(
            createTurn(ids, scope, 2, {
                goalId,
                desiredState: "Ship the complete MCP surface",
                revision: 2,
            }),
        );

        const result = new MemoryGetService(repository).get({
            scopeId: scope.scopeId,
            memoryIds: [goalId],
            revision: 1,
            tokenBudget: 4096,
        });

        expect(result.text).toContain("Ship the first query contract");
        expect(result.text).not.toContain("complete MCP surface");
        expect(result.references).toEqual([
            expect.objectContaining({ entityId: goalId, revision: 1 }),
        ]);
    });
});

function createTurn(
    ids: SequenceIdGenerator,
    scope: AccessScope,
    sequence: number,
    goal: NonNullable<RecordTurnRequest["goals"]>[number],
): RecordTurnRequest {
    return {
        turnId: ids.generate("Turn"),
        idempotencyKey: `get-service-turn-${sequence}`,
        scope,
        conversationId: "get-service-conversation",
        sequence,
        primaryTopicPath: "/project/memory",
        requestSummary: `Update goal revision ${sequence}`,
        outcomeSummary: `Updated goal revision ${sequence}`,
        occurredAt: now,
        provenance,
        goals: [goal],
    };
}
