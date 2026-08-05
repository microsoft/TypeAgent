// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    DomainError,
    SequenceIdGenerator,
    createAccessScope,
    createMemoryRevision,
    type AccessScope,
    type MemoryRevision,
} from "../../src/domain/index.js";
import { SqliteMemoryRepository } from "../../src/repository/index.js";

const now = "2026-08-05T12:00:00.000Z";

describe("durable memory repository lifecycle", () => {
    let directory: string;
    let repository: SqliteMemoryRepository;
    let ids: SequenceIdGenerator;
    let scope: AccessScope;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-m9-"));
        repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 5));
        scope = createAccessScope(ids.generate("Scope"), {
            userId: "memory-lifecycle-user",
        });
        repository.saveScope(scope);
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("revision conflicts and batch state conflicts commit no changes", () => {
        const first = createRevision(scope, ids, "First durable assertion");
        const second = createRevision(scope, ids, "Second durable assertion");
        repository.createMemory(first, []);
        repository.createMemory(second, []);

        expectDomainError(
            () =>
                repository.reviseMemory(
                    createMemoryRevision({
                        ...first,
                        revision: 2,
                        content: "This stale write must not commit",
                    }),
                    2,
                ),
            "REVISION_CONFLICT",
        );
        expect(
            repository.listMemoryHistory(scope.scopeId, first.memoryId),
        ).toHaveLength(1);

        expectDomainError(
            () =>
                repository.changeMemoryStates(scope.scopeId, [
                    {
                        memoryId: first.memoryId,
                        expectedRevision: 1,
                        event: {
                            eventId: ids.generate("StateEvent"),
                            memoryId: first.memoryId,
                            fromState: "active",
                            toState: "forgotten",
                            actorId: "memory-lifecycle-test",
                            reason: "Test atomic forget",
                            createdAt: now,
                        },
                    },
                    {
                        memoryId: second.memoryId,
                        expectedRevision: 2,
                        event: {
                            eventId: ids.generate("StateEvent"),
                            memoryId: second.memoryId,
                            fromState: "active",
                            toState: "forgotten",
                            actorId: "memory-lifecycle-test",
                            reason: "Test atomic forget",
                            createdAt: now,
                        },
                    },
                ]),
            "REVISION_CONFLICT",
        );
        expect(
            repository.getMemory(scope.scopeId, first.memoryId)?.head.state,
        ).toBe("active");
        expect(
            repository.getMemory(scope.scopeId, second.memoryId)?.head.state,
        ).toBe("active");
    });
});

function createRevision(
    scope: AccessScope,
    ids: SequenceIdGenerator,
    content: string,
): MemoryRevision {
    return createMemoryRevision({
        memoryId: ids.generate("Memory"),
        scopeId: scope.scopeId,
        revision: 1,
        kind: "fact",
        content,
        tags: ["M9"],
        provenance: {
            sourceType: "agent",
            actorId: "memory-lifecycle-test",
            observedAt: now,
        },
        importance: 0.5,
        createdAt: now,
    });
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
