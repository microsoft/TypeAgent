// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FixedClock,
    HmacPacketContinuationCodec,
    MemoryQueryService,
    RecordTurnService,
    SequenceIdGenerator,
    WorkingMemoryPacketAssembler,
    createAccessScope,
    parseQueryLanguage,
    type AccessScope,
    type MemoryProvenance,
} from "../../src/index.js";
import { SqliteMemoryRepository } from "../../src/repository/index.js";

const now = "2026-08-10T12:00:00.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "query-service-test",
    observedAt: now,
};

describe("MemoryQueryService", () => {
    let directory: string;
    let repository: SqliteMemoryRepository;
    let ids: SequenceIdGenerator;
    let scope: AccessScope;
    let service: MemoryQueryService;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "agent-memory-m8-"));
        repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        ids = new SequenceIdGenerator(Date.UTC(2026, 7, 10));
        scope = createAccessScope(ids.generate("Scope"), {
            userId: "query-service-user",
        });
        repository.saveScope(scope);
        const clock = new FixedClock(new Date(now));
        const recorder = new RecordTurnService(repository, clock, ids);
        recorder.record({
            turnId: ids.generate("Turn"),
            idempotencyKey: "m8-query-turn",
            scope,
            conversationId: "m8-conversation",
            sequence: 1,
            primaryTopicPath: "/project/memory",
            requestSummary: "Expose memory query",
            outcomeSummary: "Query service assembled a packet",
            occurredAt: now,
            provenance,
            terms: [{ text: "memory" }],
        });
        service = new MemoryQueryService(
            repository,
            new WorkingMemoryPacketAssembler({
                continuationCodec: new HmacPacketContinuationCodec(
                    "m8-query-service-secret".repeat(2),
                ),
            }),
            { clock },
        );
    });

    afterEach(async () => {
        repository.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("produces the same packet for path language and structured IR", () => {
        const pathQuery = "/topics/project/memory/turns tokens 1024";
        const ir = parseQueryLanguage(pathQuery, {
            scopeId: scope.scopeId,
            timeZone: "UTC",
            now: new Date(now),
        });

        const fromPath = service.query({
            scopeId: scope.scopeId,
            query: pathQuery,
            timeZone: "UTC",
            now,
        });
        const fromIr = service.query({ scopeId: scope.scopeId, ir });

        expect(fromPath).toEqual(fromIr);
        expect(fromPath.packet.references).toHaveLength(1);
        expect(fromPath.packet.text).toContain("Query service assembled");
    });
});
