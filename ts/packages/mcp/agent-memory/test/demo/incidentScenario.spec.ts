// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FixedClock,
    HmacPacketContinuationCodec,
    MemoryLifecycleService,
    MemoryQueryService,
    SequenceIdGenerator,
    WorkingMemoryPacketAssembler,
    createAccessScope,
    createBatchedInvestigationPrompt,
    createFreshHandoffPrompt,
    incidentScenario,
} from "../../src/index.js";
import { SqliteMemoryRepository } from "../../src/repository/index.js";

describe("security incident memory demo", () => {
    test("live prompts batch evidence and isolate the fresh handoff", () => {
        const scope = {
            userId: "incident-analyst",
            workspaceId: "IR-7421",
        };
        const investigation = createBatchedInvestigationPrompt(scope);
        const handoff = createFreshHandoffPrompt(scope);

        for (const turn of incidentScenario) {
            if (turn.type === "evidence") {
                expect(investigation).toContain(turn.evidence);
                expect(investigation).toContain(turn.topicPath);
                expect(handoff).not.toContain(turn.evidence);
                expect(handoff).not.toContain(turn.memoryContent);
            }
        }
        expect(handoff).toContain('/memories where "IR-7421"');
        expect(handoff).toContain(JSON.stringify(scope));
    });

    test("fresh analyst checkpoints recover the accumulated incident", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "agent-memory-incident-replay-"),
        );
        const repository = SqliteMemoryRepository.open(
            path.join(directory, "memory.db"),
        );
        try {
            const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 5));
            const clock = new FixedClock(new Date("2026-08-05T08:00:00.000Z"));
            const scope = createAccessScope(ids.generate("Scope"), {
                userId: "incident-analyst",
                workspaceId: "IR-7421",
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
                        "incident-replay-cursor-secret".repeat(2),
                    ),
                }),
                { clock, idGenerator: ids },
            );

            for (const turn of incidentScenario) {
                clock.set(new Date(turn.at));
                if (turn.type === "evidence") {
                    lifecycle.store({
                        content: turn.memoryContent,
                        kind: "observation",
                        scope,
                        provenance: {
                            sourceType: "agent",
                            actorId: "incident-replay",
                            observedAt: turn.at,
                        },
                        tags: turn.tags,
                        importance: 0.8,
                        idempotencyKey: turn.id,
                    });
                    continue;
                }

                const packet = query
                    .query({
                        scopeId: scope.scopeId,
                        query: '/memories where "IR-7421" tokens 8192 limit 100',
                        timeZone: "UTC",
                        now: turn.at,
                    })
                    .packet.text.toLocaleLowerCase("en-US");
                for (const expected of turn.expectedRecall) {
                    expect(packet).toContain(
                        expected.toLocaleLowerCase("en-US"),
                    );
                }
            }
        } finally {
            repository.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
