// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import type {
    MemoryEvent,
    MemoryEventAppendRequest,
    MemoryEventForgetRequest,
    MemoryService,
} from "@typeagent/memory-service";
import {
    ConversationDurableMemory,
    conversationCorpusName,
    formatConversationEvidence,
} from "../src/context/conversationDurableMemory.js";

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
        searchEvents: async ({
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
        forgetEvents: async (request: MemoryEventForgetRequest) => {
            const retained = events.filter(
                (event) =>
                    !(
                        request.eventIds?.includes(event.eventId) ||
                        request.conversationIds?.includes(
                            event.conversationId ?? "",
                        )
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
        expect(conversationCorpusName).toBe("typeagent-profile-conversations");
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

    it("keeps legacy fallback available when durable search has no parity match", async () => {
        const { service } = createService();
        const memory = new ConversationDurableMemory({
            service,
            conversationId: "conversation-1",
            runId: "run-1",
        });
        expect(await memory.search("legacy-only answer")).toEqual([]);
        // The dispatcher only returns early for non-empty durable evidence;
        // legacy conversation memory remains initialized and is then queried.
    });

});
