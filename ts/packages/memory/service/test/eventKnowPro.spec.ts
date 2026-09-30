// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { createKnowProCorpusIndex, FileMemoryService } from "../src/index.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

test("event search uses structured knowledge with ledger filters before the limit", async () => {
    const fixture = await createFixture();
    const { service, root } = fixture;
    try {
        const { corpusId } = await service.createCorpus("Activity");
        for (const sourceId of ["page-inside", "page-outside"]) {
            const ingested = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text: `Page ${sourceId}`,
                },
                pipeline: { mode: "content" },
            });
            await waitForJob(service, ingested.jobId);
        }
        for (const [key, content, observedAt, runId] of [
            [
                "outside",
                "Restore Zephyr availability by inspecting recovery logs.",
                "2026-09-21T12:00:00Z",
                "run-outside",
            ],
            [
                "inside",
                "Restore Zephyr availability by inspecting recovery logs.",
                "2026-09-21T10:00:00Z",
                "run-inside",
            ],
            [
                "unrelated",
                "Prepare the team breakfast.",
                "2026-09-21T09:00:00Z",
                "run-inside",
            ],
        ] as const) {
            await service.appendEvent({
                corpusId,
                idempotencyKey: key,
                producer: {
                    producerId: key === "outside" ? "other" : "agent",
                    producerType: "test",
                },
                eventType: "turn.completed",
                sourceKind: "conversation",
                conversationId: "conversation-1",
                turnId: `turn-${key}`,
                runId,
                observedAt,
                eventTime:
                    key === "outside" ? "2026-09-21T10:20:00Z" : observedAt,
                ...(key === "unrelated"
                    ? {}
                    : {
                          linkedSourceIds: [
                              key === "inside" ? "page-inside" : "page-outside",
                          ],
                      }),
                metadata: {
                    authority:
                        key === "inside"
                            ? "verified-observation"
                            : key === "outside"
                              ? "evidence-only"
                              : "user-assertion",
                },
                content,
            });
        }
        const question = "How can I debug a failed Zephyr process?";
        const all = await service.searchEvents({
            corpusId,
            query: question,
        });
        expect(all.matches).toHaveLength(2);
        const scoped = await service.searchEvents({
            corpusId,
            query: question,
            limit: 1,
            sourceKinds: ["conversation"],
            authorities: ["verified-observation"],
            producerIds: ["agent"],
            eventTypes: ["turn.completed"],
            conversationIds: ["conversation-1"],
            turnIds: ["turn-inside"],
            runIds: ["run-inside"],
            linkedSourceIds: ["page-inside"],
            observedFrom: "2026-09-21T09:30:00Z",
            observedTo: "2026-09-21T11:00:00Z",
            eventFrom: "2026-09-21T09:30:00Z",
            eventTo: "2026-09-21T10:10:00Z",
        });
        expect(scoped.matches).toHaveLength(1);
        expect(scoped.matches[0].event.idempotencyKey).toBe("inside");
        expect(scoped.matches[0].event.producer.producerId).toBe("agent");
        expect(scoped.matches[0].event.conversationId).toBe("conversation-1");
        expect(scoped.matches[0].event.metadata).toEqual({
            authority: "verified-observation",
        });
        expect(
            (
                await service.searchEvents({
                    corpusId,
                    query: question,
                    authorities: ["evidence-only"],
                    limit: 1,
                })
            ).matches[0].event.idempotencyKey,
        ).toBe("outside");
        expect(
            (
                await service.searchEvents({
                    corpusId,
                    query: question,
                    authorities: ["explicit"],
                    limit: 1,
                })
            ).matches,
        ).toEqual([]);
        expect(
            (
                await service.searchEvents({
                    corpusId,
                    query: question,
                    eventTo: "2026-09-21T10:10:00Z",
                    limit: 1,
                })
            ).matches[0].event.idempotencyKey,
        ).toBe("inside");
        expect(
            (
                await service.searchEvents({
                    corpusId,
                    query: question,
                    producerIds: ["absent"],
                })
            ).matches,
        ).toEqual([]);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        fixture.restoreProvider();
    }
});

test("event index reconciles replay, failed extraction, forgetting, and restart", async () => {
    const fixture = await createFixture();
    const { root, failExtraction } = fixture;
    let service = fixture.service;
    try {
        const { corpusId } = await service.createCorpus("Event lifecycle");
        const request = {
            corpusId,
            idempotencyKey: "first",
            producer: { producerId: "agent", producerType: "test" },
            eventType: "turn.completed",
            sourceKind: "conversation" as const,
            content: "Restore Zephyr availability using recovery logs.",
        };
        const first = await service.appendEvent(request);
        expect((await service.appendEvent(request)).replayed).toBe(true);
        const question = "How do I debug the broken Zephyr process?";
        expect(
            (await service.searchEvents({ corpusId, query: question }))
                .matches[0].event.eventId,
        ).toBe(first.event.eventId);

        const indexRoot = path.join(root, corpusId, "event-search-index");
        expect(await readdir(indexRoot)).toHaveLength(2);
        const second = await service.appendEvent({
            ...request,
            idempotencyKey: "second",
            runId: "run-2",
        });
        failExtraction.value = true;
        await expect(
            service.searchEvents({ corpusId, query: question }),
        ).rejects.toThrow("Expected extraction failure");
        expect(await readdir(indexRoot)).toEqual([]);
        expect((await service.listEvents({ corpusId })).total).toBe(2);
        failExtraction.value = false;
        expect(
            (await service.searchEvents({ corpusId, query: question })).matches,
        ).toHaveLength(2);

        const generation = (await readdir(indexRoot)).find(
            (entry) => entry !== "state.json",
        );
        expect(generation).toBeDefined();
        await rm(path.join(indexRoot, generation!), {
            recursive: true,
            force: true,
        });
        expect(
            (await service.searchEvents({ corpusId, query: question })).matches,
        ).toHaveLength(2);

        await service.close();
        service = fixture.makeService();
        expect(
            (await service.searchEvents({ corpusId, query: question })).matches,
        ).toHaveLength(2);
        expect((await service.appendEvent(request)).replayed).toBe(true);

        await service.forgetEvents({
            corpusId,
            eventIds: [first.event.eventId],
        });
        await expect(service.appendEvent(request)).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        await expect(readdir(indexRoot)).rejects.toMatchObject({
            code: "ENOENT",
        });
        await service.close();
        service = fixture.makeService();
        expect(
            (
                await service.searchEvents({
                    corpusId,
                    query: question,
                })
            ).matches.map((match) => match.event.eventId),
        ).toEqual([second.event.eventId]);
        await expect(service.appendEvent(request)).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        expect(await readdir(indexRoot)).toHaveLength(2);
        await service.forgetEvents({
            corpusId,
            eventIds: [second.event.eventId],
        });
        expect(
            (await service.searchEvents({ corpusId, query: question })).matches,
        ).toEqual([]);
        await expect(readdir(indexRoot)).rejects.toMatchObject({
            code: "ENOENT",
        });
        await service.appendEvent({
            ...request,
            idempotencyKey: "third",
        });
        expect(
            (await service.searchEvents({ corpusId, query: question })).matches,
        ).toHaveLength(1);
        await service.clearCorpus(corpusId);
        await expect(readdir(indexRoot)).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect((await service.listEvents({ corpusId })).total).toBe(0);
        await expect(
            service.appendEvent({
                ...request,
                idempotencyKey: "third",
            }),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        fixture.restoreProvider();
    }
});

async function waitForJob(service: FileMemoryService, jobId: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const job = await service.getJob(jobId);
        if (job?.state === "complete") {
            return;
        }
        if (job?.state === "failed") {
            throw new Error(job.error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Indexing job '${jobId}' timed out`);
}

async function createFixture() {
    const root = await mkdtemp(
        path.join(os.tmpdir(), `typeagent-event-knowpro-${randomUUID()}-`),
    );
    const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    const failExtraction = { value: false };
    const knowledgeForText = (text: string) => ({
        entities: text.includes("Zephyr")
            ? [{ name: "Zephyr", type: ["service"] }]
            : [],
        actions: [],
        inverseActions: [],
        topics: text.includes("Zephyr") ? ["Zephyr recovery"] : [],
    });
    const languageModel = {
        completionSettings: {},
        complete: async () => ({
            success: true as const,
            data: JSON.stringify({
                searchExpressions: [
                    {
                        rewrittenQuery: "Zephyr recovery",
                        filters: [
                            {
                                entitySearchTerms: [
                                    { name: "Zephyr", isNamePronoun: false },
                                ],
                            },
                        ],
                    },
                ],
            }),
        }),
    };
    const makeService = () =>
        new FileMemoryService(root, {
            indexFactory: (_corpusId, directory) =>
                new FakeProcedureCorpusIndex(directory),
            eventIndexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, () => {
                    const settings = createDocMemorySettings(
                        64,
                        undefined,
                        languageModel,
                    );
                    settings.embeddingSize = 0;
                    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                        {
                            settings: { maxContextLength: 1000 },
                            extract: async (text: string) =>
                                knowledgeForText(text),
                            extractWithRetry: async (text: string) =>
                                failExtraction.value
                                    ? {
                                          success: false as const,
                                          message:
                                              "Expected extraction failure",
                                      }
                                    : {
                                          success: true as const,
                                          data: knowledgeForText(text),
                                      },
                        };
                    return settings;
                }),
        });
    return {
        root,
        makeService,
        service: makeService(),
        failExtraction,
        restoreProvider: () => {
            if (previousProvider === undefined) {
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            } else {
                process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
            }
        },
    };
}
