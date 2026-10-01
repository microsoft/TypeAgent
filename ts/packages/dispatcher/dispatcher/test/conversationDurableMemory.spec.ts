// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type {
    MemoryEvent,
    MemoryEventAppendRequest,
    MemoryEventForgetRequest,
    MemoryEventSearchRequest,
    MemoryService,
} from "@typeagent/memory-service";
import {
    ConversationDurableMemory,
    conversationCorpusName,
    formatConversationEvidence,
    searchDurableConversationMemory,
} from "../src/context/conversationDurableMemory.js";
import {
    rememberConversation,
    searchReasoningConversationMemory,
} from "../src/context/personalMemorySearch.js";
import { getConversationEntityMemory } from "../src/context/conversationEntityMemory.js";
import type { SearchSelectExpr } from "@typeagent/knowpro";

function createService() {
    const events: MemoryEvent[] = [];
    const service = {
        listCorpora: async () => [],
        createCorpus: async (name: string, description?: string) => ({
            corpusId: "profile-corpus",
            name,
            ...(description === undefined ? {} : { description }),
            createdAt: "2026-09-21T00:00:00.000Z",
            updatedAt: "2026-09-21T00:00:00.000Z",
            status: "ready" as const,
            documentCount: 0,
        }),
        appendEvent: async (request: MemoryEventAppendRequest) => {
            const event: MemoryEvent = {
                ...request,
                eventId: `event-${events.length}`,
                observedAt: request.observedAt ?? "2026-09-21T00:00:00.000Z",
                eventTime:
                    request.eventTime ??
                    request.observedAt ??
                    "2026-09-21T00:00:00.000Z",
                createdAt: "2026-09-21T00:00:00.000Z",
            };
            events.push(event);
            return { event, replayed: false };
        },
        listEvents: async ({
            conversationIds,
        }: {
            conversationIds?: string[];
        }) => {
            const items =
                conversationIds === undefined
                    ? events
                    : events.filter(
                          (event) =>
                              event.conversationId !== undefined &&
                              conversationIds.includes(event.conversationId),
                      );
            return { items, total: items.length };
        },
        searchEvents: jest.fn(
            async ({
                query,
                conversationIds,
            }: {
                query: string;
                conversationIds?: string[];
            }) => ({
                query,
                matches: events
                    .filter(
                        (event) =>
                            event.content
                                ?.toLocaleLowerCase()
                                .includes(query.toLocaleLowerCase()) &&
                            (conversationIds === undefined ||
                                (event.conversationId !== undefined &&
                                    conversationIds.includes(
                                        event.conversationId,
                                    ))),
                    )
                    .map((event) => ({
                        event,
                        snippet: event.content ?? "",
                        score: 1,
                    })),
            }),
        ),
        forgetEvents: async (request: MemoryEventForgetRequest) => {
            const retained = events.filter(
                (event) =>
                    !(
                        (request.eventIds === undefined ||
                            request.eventIds.includes(event.eventId)) &&
                        (request.conversationIds === undefined ||
                            request.conversationIds.includes(
                                event.conversationId ?? "",
                            )) &&
                        (request.turnIds === undefined ||
                            request.turnIds.includes(event.turnId ?? ""))
                    ),
            );
            const deletedEventCount = events.length - retained.length;
            events.splice(0, events.length, ...retained);
            return {
                corpusId: request.corpusId,
                deletedEventCount,
                deletedSourceCount: 0,
                retainedLinkedSourceIds: [],
                indexVersion: "2",
            };
        },
    } as unknown as MemoryService;
    return { service, events };
}

describe("ConversationDurableMemory", () => {
    it("uses one profile corpus and preserves turn provenance and authority", async () => {
        const { service, events } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
            now: () => new Date("2026-09-21T20:00:00.000Z"),
        });

        memory.recordUserTurn("We chose blue.", "turn-1");
        memory.recordAssistantEvidence("Blue is probably best.", "turn-1");
        memory.recordActionResult(
            "Preference saved.",
            "turn-1",
            "settings.save",
            true,
        );
        memory.recordDecision("Decision: use blue.", "turn-1");
        memory.recordTaskOutcome("Configuration completed.", "turn-1");
        await memory.flush();
        expect(events).toHaveLength(5);
        expect(
            events.every((event) => event.corpusId === "profile-corpus"),
        ).toBe(true);
        expect(events[0]).toMatchObject({
            conversationId: "conversation-1",
            runId: "run-1",
            turnId: "turn-1",
            sender: "user",
            eventTime: "2026-09-21T20:00:00.000Z",
        });
        expect(events[1].metadata).toEqual({ authority: "evidence-only" });
        expect(events[4].metadata).toEqual({ authority: "evidence-only" });
        expect(conversationCorpusName).toBe("typeagent-profile-conversations");
    });

    describe("Conversation entity projection", () => {
        let previousEmbeddingProvider: string | undefined;
        beforeAll(() => {
            previousEmbeddingProvider =
                process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        });
        afterAll(() => {
            if (previousEmbeddingProvider === undefined) {
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            } else {
                process.env.TYPEAGENT_EMBEDDING_PROVIDER =
                    previousEmbeddingProvider;
            }
        });

        it("preserves KnowPro action entity facets and rebuilds from retained ledger events after forgetting", async () => {
            const { service } = createService();
            const durable = new ConversationDurableMemory({
                service,
                conversationId: "conversation-1",
                runId: "run-1",
            });
            durable.recordAssistantEvidence(
                "Found the failing service.",
                "turn-1",
                "services.find",
                {
                    appAgentName: "services",
                    entities: [
                        {
                            name: "Service X",
                            type: ["service"],
                            uniqueId: "service-x-42",
                        },
                    ],
                },
            );
            const context = { conversationDurableMemory: durable };
            const memory = await getConversationEntityMemory(context);
            expect(memory).toBeDefined();
            const entities = Array.from(
                { length: memory!.semanticRefs.length },
                (_, index) => memory!.semanticRefs.get(index),
            ).filter((reference) => reference.knowledgeType === "entity");
            expect(entities).toContainEqual(
                expect.objectContaining({
                    knowledge: {
                        name: "Service X",
                        type: ["service"],
                        facets: [
                            {
                                name: "typeagent.appAgentName",
                                value: "services",
                            },
                            {
                                name: "typeagent.uniqueId",
                                value: "service-x-42",
                            },
                        ],
                    },
                }),
            );
            expect(memory!.settings.fileSaveSettings).toBeUndefined();
            const entityQuery: SearchSelectExpr = {
                searchTermGroup: {
                    booleanOp: "and",
                    terms: [{ term: { text: "Service X" } }],
                },
                when: {
                    knowledgeType: "entity",
                    scopeDefiningTerms: {
                        booleanOp: "and",
                        terms: [
                            {
                                propertyName: {
                                    term: { text: "typeagent.appAgentName" },
                                    relatedTerms: [],
                                },
                                propertyValue: {
                                    term: { text: "services" },
                                    relatedTerms: [],
                                },
                            },
                            {
                                propertyName: "type",
                                propertyValue: {
                                    term: { text: "service" },
                                    relatedTerms: [],
                                },
                            },
                        ],
                    },
                },
            };
            expect(
                (
                    await memory!.searchKnowledge(entityQuery, {
                        exactMatch: true,
                    })
                )?.get("entity")?.semanticRefMatches,
            ).toHaveLength(1);
            expect(await getConversationEntityMemory(context)).toBe(memory);

            const restarted = new ConversationDurableMemory({
                service,
                conversationId: "conversation-1",
                runId: "run-2",
            });
            const replayed = await getConversationEntityMemory({
                conversationDurableMemory: restarted,
            });
            expect(replayed!.semanticRefs.length).toBe(
                memory!.semanticRefs.length,
            );

            await durable.forgetTurn("turn-1");
            const forgotten = await getConversationEntityMemory(context);
            expect(forgotten).not.toBe(memory);
            expect(forgotten!.semanticRefs.length).toBe(0);
            expect(
                (
                    await forgotten!.searchKnowledge(entityQuery, {
                        exactMatch: true,
                    })
                )?.get("entity")?.semanticRefMatches ?? [],
            ).toHaveLength(0);
            expect(
                (await getConversationEntityMemory({
                    conversationDurableMemory: restarted,
                }))!.semanticRefs.length,
            ).toBe(0);
        });

        it("rejects malformed durable entity metadata rather than silently dropping action references", async () => {
            const { service, events } = createService();
            const durable = new ConversationDurableMemory({
                service,
                conversationId: "conversation-1",
                runId: "run-1",
            });
            durable.recordAssistantEvidence("Found a service.", "turn-1");
            await durable.flush();
            events[0].metadata = {
                actionEntities: [{ name: "Service X", type: "service" }],
                actionAppAgentName: "services",
            };
            await expect(
                getConversationEntityMemory({
                    conversationDurableMemory: durable,
                }),
            ).rejects.toThrow("Invalid action entity metadata");
        });
    });

    it("retrieves current and cross-conversation source-linked evidence", async () => {
        const { service, events } = createService();
        events.push({
            eventId: "other",
            corpusId: "profile-corpus",
            idempotencyKey: "other",
            producer: {
                producerId: "typeagent.dispatcher.conversation",
                producerType: "conversation-producer",
            },
            eventType: "assistant-evidence",
            sourceKind: "conversation",
            observedAt: "2026-09-20T00:00:00.000Z",
            eventTime: "2026-09-20T00:00:00.000Z",
            createdAt: "2026-09-20T00:00:00.000Z",
            content: "The launch code was blue.",
            conversationId: "conversation-2",
            runId: "run-2",
            turnId: "turn-9",
            sender: "assistant",
        });
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });

        expect(await memory.search("launch code", "current")).toEqual([]);
        const cross = await memory.search("launch code", "all");
        expect(cross).toHaveLength(1);
        expect(cross[0].authoritative).toBe(false);
        expect(formatConversationEvidence(cross)).toContain(
            "event=other, conversation=conversation-2, run=run-2, turn=turn-9",
        );
        expect(formatConversationEvidence(cross)).toContain(
            "not authoritative fact",
        );
    });

    it("passes one full question to KnowPro and preserves its result order", async () => {
        const { service, events } = createService();
        const request = jest.fn(async (input: MemoryEventSearchRequest) => ({
            query: input.query,
            matches: events.map((event, index) => ({
                event,
                snippet: event.content ?? "",
                score: index + 1,
            })),
        }));
        service.searchEvents = request;
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        memory.recordUserTurn(
            "Service X was recovered with a rollback.",
            "turn-1",
        );
        memory.recordUserTurn("Restarting the process failed.", "turn-2");
        const matches = await memory.search(
            "How did we recover from the Service X outage?",
            "current",
            3,
        );
        expect(request).toHaveBeenCalledTimes(1);
        expect(matches.map((match) => match.event.eventId)).toEqual([
            "event-0",
            "event-1",
        ]);
        expect(request).toHaveBeenCalledWith({
            corpusId: "profile-corpus",
            query: "How did we recover from the Service X outage?",
            limit: 3,
            sourceKinds: ["conversation"],
            conversationIds: ["conversation-1"],
        });
    });

    it("does not label a user assertion or failed action as verified success", async () => {
        const { service, events } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        memory.recordUserTurn("Service X is healthy.", "turn-1");
        memory.recordActionResult(
            "Service X health check failed.",
            "turn-1",
            "service.check",
            false,
        );
        memory.recordTaskOutcome("Service X is probably recovered.", "turn-1");
        await memory.flush();
        events[2].metadata = { authority: "verified-observation" };
        const matches = await memory.search("Service X");
        expect(matches[0].authoritative).toBe(false);
        expect(matches[1].authoritative).toBe(true);
        expect(matches[2].authoritative).toBe(false);
        const text = formatConversationEvidence(matches);
        expect(text).toContain("user assertion (not independently verified)");
        expect(text).toContain("outcome=failed");
        expect(text).toContain("action=service.check");
        expect(text).toContain(
            "A failed action is evidence of failure, not success",
        );
    });

    it("surfaces an indexing failure rather than returning a no-match or legacy answer", async () => {
        const { service } = createService();
        service.searchEvents = async () => {
            throw new Error("KnowPro projection failed");
        };
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        await expect(
            searchDurableConversationMemory(
                { conversationDurableMemory: memory },
                "Service X",
            ),
        ).rejects.toThrow("KnowPro projection failed");
    });

    it("inspects and forgets by turn without retiring other legacy data", async () => {
        const { service } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        memory.recordUserTurn("first", "turn-1");
        memory.recordUserTurn("second", "turn-2");

        expect(await memory.inspectTurn("turn-1")).toHaveLength(1);
        expect((await memory.forgetTurn("turn-1")).deletedEventCount).toBe(1);
        expect(await memory.inspectConversation()).toHaveLength(1);
        expect((await memory.forgetConversation()).deletedEventCount).toBe(1);
    });

    it("does not resurrect legacy-only evidence after durable forgetting", async () => {
        const { service } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        const getAnswerFromLanguage = jest.fn(async () => ({
            success: true as const,
            data: [],
        }));
        expect(
            await searchReasoningConversationMemory(
                {
                    conversationDurableMemory: memory,
                    conversationMemory: { getAnswerFromLanguage },
                },
                "legacy-only answer",
            ),
        ).toBeUndefined();
        expect(getAnswerFromLanguage).not.toHaveBeenCalled();
    });

    it("persists explicit forget scopes even before a turn or conversation was indexed", async () => {
        const { service } = createService();
        const forget = jest.fn(service.forgetEvents);
        service.forgetEvents = forget;
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        await memory.forgetTurn("unindexed-turn");
        expect(forget).toHaveBeenCalledWith({
            corpusId: "profile-corpus",
            sourceKinds: ["conversation"],
            conversationIds: ["conversation-1"],
            turnIds: ["unindexed-turn"],
        });
        await memory.forgetConversation("unindexed-conversation");
        expect(forget).toHaveBeenLastCalledWith({
            corpusId: "profile-corpus",
            conversationIds: ["unindexed-conversation"],
        });
    });

    it("acknowledges remember only after the canonical event is persisted", async () => {
        const { service, events } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        await rememberConversation(
            {
                conversationDurableMemory: memory,
                currentRequestId: { requestId: "turn-1" },
            },
            "Use rollback to recover Service X.",
            "decision",
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            eventType: "explicit-decision",
            content: "Use rollback to recover Service X.",
            turnId: "turn-1",
        });
    });

    it("does not acknowledge remember when persistence fails or turn identity is missing", async () => {
        const { service } = createService();
        service.appendEvent = async () => {
            throw new Error("Event ledger is unavailable");
        };
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        await expect(
            rememberConversation(
                {
                    conversationDurableMemory: memory,
                    currentRequestId: undefined,
                },
                "Service X context",
            ),
        ).rejects.toThrow("active conversation turn");
        await expect(
            rememberConversation(
                {
                    conversationDurableMemory: memory,
                    currentRequestId: { requestId: "turn-1" },
                },
                "Service X context",
            ),
        ).rejects.toThrow("Event ledger is unavailable");
    });
});
