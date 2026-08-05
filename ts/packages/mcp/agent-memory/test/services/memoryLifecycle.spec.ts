// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FixedClock,
    HmacPacketContinuationCodec,
    MemoryGetService,
    MemoryLifecycleService,
    MemoryQueryService,
    SequenceIdGenerator,
    WorkingMemoryPacketAssembler,
    createAccessScope,
    parseQueryLanguage,
} from "../../src/index.js";
import { SqliteMemoryRepository } from "../../src/repository/index.js";

const now = "2026-08-05T12:00:00.000Z";

describe("MemoryLifecycleService", () => {
    test("stores, revises, forgets, restores, and records feedback", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "agent-memory-lifecycle-"),
        );
        const repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        try {
            const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 5));
            const clock = new FixedClock(new Date(now));
            const scope = createAccessScope(ids.generate("Scope"), {
                userId: "lifecycle-user",
            });
            repository.saveScope(scope);
            const lifecycle = new MemoryLifecycleService(repository, {
                clock,
                idGenerator: ids,
            });
            const query = new MemoryQueryService(
                repository,
                new WorkingMemoryPacketAssembler({
                    continuationCodec: new HmacPacketContinuationCodec(
                        "m9-lifecycle-query-secret".repeat(2),
                    ),
                }),
                { clock, idGenerator: ids },
            );

            const stored = lifecycle.store({
                content: "MCP retrieval uses deterministic memory packets",
                kind: "fact",
                scope,
                provenance: {
                    sourceType: "agent",
                    actorId: "lifecycle-test",
                    observedAt: now,
                },
                tags: ["MCP", "retrieval"],
                confidence: 0.8,
                importance: 0.7,
                idempotencyKey: "store-m9-memory",
            });
            const memoryId = stored.memory.revision.memoryId;
            expect(
                lifecycle.store({
                    content: "MCP retrieval uses deterministic memory packets",
                    kind: "fact",
                    scope,
                    provenance: {
                        sourceType: "agent",
                        actorId: "lifecycle-test",
                        observedAt: now,
                    },
                    tags: ["MCP", "retrieval"],
                    confidence: 0.8,
                    importance: 0.7,
                    idempotencyKey: "store-m9-memory",
                }).memory.revision.memoryId,
            ).toBe(memoryId);

            const firstQuery = query.query({
                scopeId: scope.scopeId,
                query: '/memories where "deterministic memory" tokens 2048',
                timeZone: "UTC",
                now,
            });
            expect(firstQuery.packet.references).toEqual([
                expect.objectContaining({ entityId: memoryId }),
            ]);

            lifecycle.feedback({
                retrievalId: firstQuery.retrievalId,
                outcomes: [{ memoryId, outcome: "useful" }],
            });
            const afterFeedback = repository.getMemory(
                scope.scopeId,
                memoryId,
            )!;
            expect(afterFeedback.usage).toEqual(
                expect.objectContaining({ retrievalCount: 1, usefulCount: 1 }),
            );
            expect(afterFeedback.revision.confidence).toBe(0.8);

            lifecycle.revise({
                memoryId,
                scope,
                expectedRevision: 1,
                content:
                    "MCP retrieval uses deterministic, budgeted memory packets",
                provenance: {
                    sourceType: "agent",
                    actorId: "lifecycle-test",
                    observedAt: now,
                },
                reason: "Record the packet budget invariant",
            });
            expect(
                repository.listMemoryHistory(scope.scopeId, memoryId),
            ).toEqual([
                expect.objectContaining({ revision: 1 }),
                expect.objectContaining({
                    revision: 2,
                    reason: "Record the packet budget invariant",
                }),
            ]);
            const temporalIr = parseQueryLanguage(
                '/memories where "budgeted memory" tokens 2048',
                {
                    scopeId: scope.scopeId,
                    timeZone: "UTC",
                    now: new Date(now),
                },
            );
            expect(
                query.query({
                    scopeId: scope.scopeId,
                    ir: {
                        ...temporalIr,
                        temporal: {
                            type: "changedDuring",
                            start: "2026-08-05T00:00:00.000Z",
                            end: "2026-08-06T00:00:00.000Z",
                            projection: "matchingEvents",
                        },
                    },
                }).packet.references,
            ).toEqual([expect.objectContaining({ entityId: memoryId })]);

            lifecycle.changeVisibility({
                memoryIds: [memoryId],
                scope,
                action: "forget",
                reason: "Temporarily hide this assertion",
                actorId: "lifecycle-test",
                expectedRevisions: { [memoryId]: 2 },
            });
            expect(
                query.query({
                    scopeId: scope.scopeId,
                    query: '/memories where "budgeted memory" tokens 2048',
                    timeZone: "UTC",
                    now,
                }).packet.references,
            ).toEqual([]);
            const exact = new MemoryGetService(repository).get({
                scopeId: scope.scopeId,
                memoryIds: [memoryId],
                revision: 1,
                tokenBudget: 4096,
            });
            expect(exact.text).toContain("deterministic memory packets");

            lifecycle.changeVisibility({
                memoryIds: [memoryId],
                scope,
                action: "restore",
                reason: "Restore the assertion",
                actorId: "lifecycle-test",
            });
            expect(
                query.query({
                    scopeId: scope.scopeId,
                    query: '/memories where "budgeted memory" tokens 2048',
                    timeZone: "UTC",
                    now,
                }).packet.references,
            ).toEqual([expect.objectContaining({ entityId: memoryId })]);
        } finally {
            repository.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
