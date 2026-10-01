// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rankConversationMatches } from "../src/conversationSearchIndex.js";
import { jest } from "@jest/globals";
import {
    createConversationSearchIndex,
    selectStaleConversations,
    selectUnindexedTurns,
} from "../src/conversationSearchIndex.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileMemoryService } from "@typeagent/memory-service";
import type {
    MemoryEventAppendRequest,
    MemoryEventForgetRequest,
    MemoryEventSearchRequest,
    MemoryEventSearchResult,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import { createConversationManager } from "../src/conversationManager.js";

// Fake message store keyed by ordinal, mirroring what the real index derives
// from a matched message (its text + the conversation id read off its tag).
const MESSAGES: Record<
    number,
    { text: string; conversationId: string | undefined }
> = {
    0: { text: "workout playlist", conversationId: "A" },
    1: { text: "more workout notes", conversationId: "A" },
    2: { text: "grocery list", conversationId: "B" },
    3: { text: "untagged message", conversationId: undefined },
};

const getMessage = (ordinal: number) => MESSAGES[ordinal];
const noTombstones = () => false;

const MATCHES = [
    { messageOrdinal: 0, score: 0.9 },
    { messageOrdinal: 1, score: 0.5 },
    { messageOrdinal: 2, score: 0.8 },
    { messageOrdinal: 3, score: 0.3 },
];

describe("rankConversationMatches", () => {
    it("groups hits by conversation and keeps the best score", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            3,
        );
        expect(result.map((m) => m.conversationId)).toEqual(["A", "B"]);
        expect(result[0].score).toBeCloseTo(0.9);
        // Snippets are ordered best-first within a conversation.
        expect(result[0].snippets).toEqual([
            "workout playlist",
            "more workout notes",
        ]);
        expect(result[1].score).toBeCloseTo(0.8);
    });

    it("skips messages with no conversation tag", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            3,
        );
        // The untagged ordinal (3) must not create a phantom conversation.
        expect(result.some((m) => m.conversationId === undefined)).toBe(false);
        expect(result).toHaveLength(2);
    });

    it("excludes tombstoned conversations", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            (id) => id === "A",
            10,
            3,
        );
        expect(result.map((m) => m.conversationId)).toEqual(["B"]);
    });

    it("caps snippets per conversation, best first", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            1,
        );
        const a = result.find((m) => m.conversationId === "A")!;
        expect(a.snippets).toEqual(["workout playlist"]);
    });

    it("caps the number of conversations returned", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            1,
            3,
        );
        expect(result).toHaveLength(1);
        expect(result[0].conversationId).toBe("A");
    });

    it("returns nothing for no matches", () => {
        expect(
            rankConversationMatches([], getMessage, noTombstones, 10, 3),
        ).toHaveLength(0);
    });
});

describe("selectUnindexedTurns", () => {
    const notIndexed = () => false;

    it("keeps only user-request entries, in log order, with text + key", () => {
        const entries = [
            {
                type: "user-request",
                command: "first",
                requestId: { requestId: "r1" },
                seq: 0,
            },
            { type: "set-display", seq: 1 },
            {
                type: "user-request",
                command: "second",
                requestId: { requestId: "r2" },
                seq: 2,
            },
            { type: "command-result", seq: 3 },
        ];
        const turns = selectUnindexedTurns(entries, notIndexed);
        expect(turns).toEqual([
            { text: "first", turnKey: "r1" },
            { text: "second", turnKey: "r2" },
        ]);
    });

    it("falls back to the entry sequence when the request id is absent", () => {
        const entries = [
            { type: "user-request", command: "no id", seq: 7 },
            {
                type: "user-request",
                command: "empty id",
                requestId: {},
                seq: 8,
            },
        ];
        const turns = selectUnindexedTurns(entries, notIndexed);
        expect(turns).toEqual([
            { text: "no id", turnKey: "7" },
            { text: "empty id", turnKey: "8" },
        ]);
    });

    it("skips turns whose key is already indexed", () => {
        const entries = [
            {
                type: "user-request",
                command: "old",
                requestId: { requestId: "r1" },
                seq: 0,
            },
            {
                type: "user-request",
                command: "new",
                requestId: { requestId: "r2" },
                seq: 1,
            },
        ];
        const turns = selectUnindexedTurns(entries, (key) => key === "r1");
        expect(turns).toEqual([{ text: "new", turnKey: "r2" }]);
    });

    it("returns [] when there are no user turns", () => {
        expect(
            selectUnindexedTurns([{ type: "set-display", seq: 0 }], notIndexed),
        ).toEqual([]);
    });
});

describe("selectStaleConversations", () => {
    it("returns only conversations that are no longer live", () => {
        const indexed = ["A", "B", "C"];
        const live = new Set(["A", "C"]);
        expect(selectStaleConversations(indexed, (id) => live.has(id))).toEqual(
            ["B"],
        );
    });

    it("returns [] when every indexed conversation is still live", () => {
        const live = new Set(["A", "B"]);
        expect(
            selectStaleConversations(["A", "B"], (id) => live.has(id)),
        ).toEqual([]);
    });

    it("returns [] when nothing is indexed", () => {
        expect(selectStaleConversations([], () => true)).toEqual([]);
    });
});

describe("createConversationSearchIndex", () => {
    let root: string;
    let service: ScoredEventService;
    beforeEach(() => {
        root = fs.mkdtempSync(path.resolve(".conversation-events-test-"));
        service = new ScoredEventService(path.join(root, "memory"));
    });
    afterEach(async () => {
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const open = () =>
        createConversationSearchIndex(path.join(root, "_unified"), {
            service: createMemoryServiceRpcFacade(service),
        });

    it("deduplicates dispatcher and historical turns after restart without another index", async () => {
        const corpus = await service.createCorpus(
            "typeagent-profile-conversations",
        );
        await service.appendEvent({
            corpusId: corpus.corpusId,
            idempotencyKey: "live-r1",
            producer: {
                producerId: "typeagent.dispatcher.conversation",
                producerType: "conversation-producer",
            },
            eventType: "user-turn",
            sourceKind: "conversation",
            conversationId: "A",
            runId: "run-1",
            turnId: "r1",
            content: "live record",
            sender: "user",
        });
        const index = await open();
        await index.initializeConversation("A", ["r1", "r2"], false);
        index.addMessage("A", "live transcript copy", "user", "r1");
        index.addMessage("A", "historical record", "user", "r2");
        index.addMessage("A", "historical record", "user", "r2");
        await index.close();
        await service.close();
        service = new ScoredEventService(path.join(root, "memory"));
        const restarted = await open();
        restarted.addMessage("A", "historical record", "user", "r2");
        await restarted.waitForPendingTasks();
        const page = await service.listEvents({ corpusId: corpus.corpusId });
        expect(page.total).toBe(2);
        expect(new Set(page.items.map((event) => event.turnId))).toEqual(
            new Set(["r1", "r2"]),
        );
        expect(page.items.find((event) => event.turnId === "r1")?.runId).toBe(
            "run-1",
        );
        expect(await restarted.getIndexedTurns("A")).toEqual(
            new Set(["r1", "r2"]),
        );
        expect(fs.readdirSync(path.join(root, "_unified"))).toEqual([
            "conversationEventReplay.json",
        ]);
    });

    it("passes the full question once and groups service scores and snippets", async () => {
        const index = await open();
        index.addMessage("A", "low", "user", "1");
        index.addMessage("A", "high", "user", "2");
        index.addMessage("B", "middle", "user", "1");
        service.scores = { low: 0.2, high: 0.9, middle: 0.5 };
        expect(
            await index.search({
                question: "Where did we discuss release risk?",
                terms: ["ignored"],
            }),
        ).toEqual([
            { conversationId: "A", score: 0.9, snippets: ["high", "low"] },
            { conversationId: "B", score: 0.5, snippets: ["middle"] },
        ]);
        expect(service.queries).toEqual(["Where did we discuss release risk?"]);
    });

    it("does not resurrect forgotten historical or newly live turns from transcripts", async () => {
        const index = await open();
        await index.initializeConversation("A", ["old"], false);
        index.addMessage("A", "forget me", "user", "old");
        await index.waitForPendingTasks();
        const corpus = (await service.listCorpora())[0];
        await service.forgetEvents({
            corpusId: corpus.corpusId,
            conversationIds: ["A"],
        });
        const restarted = await open();
        restarted.addMessage("A", "forget me", "user", "old");
        restarted.addMessage(
            "A",
            "new live transcript must not be replayed",
            "user",
            "new-live",
        );
        await restarted.waitForPendingTasks();
        expect(await restarted.getIndexedTurns("A")).toEqual(new Set());
        expect(await restarted.search({ question: "anything" })).toEqual([]);
    });

    it("purges deleted conversation events, including orphaned records at restart", async () => {
        const index = await open();
        index.addMessage("A", "removed", "user", "1");
        index.addMessage("B", "retained", "user", "1");
        await index.waitForPendingTasks();
        await index.tombstone("A");
        const restarted = await open();
        expect(await restarted.reconcileTombstones(new Set())).toBe(1);
        const corpus = (await service.listCorpora())[0];
        expect(
            (await service.listEvents({ corpusId: corpus.corpusId })).total,
        ).toBe(0);
        restarted.addMessage("A", "removed", "user", "1");
        await expect(restarted.waitForPendingTasks()).rejects.toThrow(
            "Conversation deleted: A",
        );
    });

    it("records service-wide conversation suppression when a deleted ledger is empty", async () => {
        const index = await open();
        await index.tombstone("empty-conversation");
        const corpus = (await service.listCorpora())[0];
        await expect(
            service.appendEvent({
                corpusId: corpus.corpusId,
                idempotencyKey: "late-dispatcher-write",
                producer: {
                    producerId: "typeagent.dispatcher.conversation",
                    producerType: "conversation-producer",
                },
                eventType: "user-turn",
                sourceKind: "conversation",
                conversationId: "empty-conversation",
                turnId: "late-turn",
                content: "must not resurrect deleted conversation",
            }),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
    });

    it("does not broadly purge untracked ledger conversations during migration", async () => {
        const corpus = await service.createCorpus(
            "typeagent-profile-conversations",
        );
        await service.appendEvent({
            corpusId: corpus.corpusId,
            idempotencyKey: "standalone",
            producer: {
                producerId: "typeagent.dispatcher.conversation",
                producerType: "conversation-producer",
            },
            eventType: "user-turn",
            sourceKind: "conversation",
            conversationId: "standalone",
            turnId: "1",
            content: "outside the server registry",
        });
        const index = await open();
        expect(await index.reconcileTombstones(new Set())).toBe(0);
        expect(
            (await service.listEvents({ corpusId: corpus.corpusId })).total,
        ).toBe(1);
    });

    it("retires only exact legacy unifiedMemory files and keeps unrelated files", async () => {
        const dir = path.join(root, "_unified");
        fs.mkdirSync(dir, { recursive: true });
        const retired = [
            "unifiedMemory_data.json",
            "unifiedMemory_embeddings.bin",
            "unifiedMemory_data.json.bak",
            "unifiedMemory_embeddings.bin.bak",
        ];
        for (const file of [
            ...retired,
            "anotherMemory_data.json",
            "unifiedMemory_notes.json",
        ]) {
            fs.writeFileSync(path.join(dir, file), "legacy fixture");
        }
        const index = await open();
        await index.initializeConversation("A", [], false);
        expect(fs.readdirSync(dir).sort()).toEqual([
            "anotherMemory_data.json",
            "conversationEventReplay.json",
            "unifiedMemory_notes.json",
        ]);
    });

    it("honors service forgetting before the first migration checkpoint across producers", async () => {
        const corpus = await service.createCorpus(
            "typeagent-profile-conversations",
        );
        const written = await service.appendEvent({
            corpusId: corpus.corpusId,
            idempotencyKey: "dispatcher-live",
            producer: {
                producerId: "typeagent.dispatcher.conversation",
                producerType: "conversation-producer",
            },
            eventType: "user-turn",
            sourceKind: "conversation",
            conversationId: "A",
            turnId: "forgotten",
            content: "must not reappear",
        });
        await service.forgetEvents({
            corpusId: corpus.corpusId,
            eventIds: [written.event.eventId],
        });
        await service.close();
        service = new ScoredEventService(path.join(root, "memory"));
        const index = await open();
        await index.initializeConversation("A", ["forgotten"], false);
        const indexed = jest.fn();
        index.addMessage(
            "A",
            "must not reappear",
            "user",
            "forgotten",
            indexed,
        );
        await expect(index.waitForPendingTasks()).resolves.toBeUndefined();
        expect(indexed).toHaveBeenCalledWith(false);
        const restarted = await open();
        expect(await restarted.getBackfillExcludedTurns("A")).toEqual(
            new Set(["forgotten"]),
        );
        expect(await restarted.getIndexedTurns("A")).toEqual(new Set());
    });

    it("reports zero newly indexed turns when the service suppresses a historical turn", async () => {
        const manager = await createConversationManager(
            "offline",
            { conversationMemorySettings: { durableMemoryService: service } },
            path.join(root, "suppressed-profile"),
            0,
            true,
        );
        try {
            const imported = await manager.importCopilotMirror({
                sessionId: "suppressed-source",
                name: "Suppressed transcript",
                createdAt: "2026-09-01T00:00:00.000Z",
                lastSyncedTurnIndex: 1,
                displayLogEntries: [
                    {
                        type: "user-request",
                        command: "forgotten",
                        requestId: { requestId: "turn" },
                        timestamp: 0,
                        seq: 1,
                    },
                ],
            });
            const corpus = (await service.listCorpora())[0];
            await service.forgetEvents({
                corpusId: corpus.corpusId,
                conversationIds: [imported.conversationId],
            });
            const progress = jest.fn();
            const result = await manager.indexConversations(
                { scope: "all" },
                imported.conversationId,
                progress,
            );
            expect(result.indexed[0].newlyIndexed).toBe(0);
            expect(progress).toHaveBeenLastCalledWith({
                done: 1,
                total: 1,
                name: "Suppressed transcript",
            });
            expect(
                (await manager.listConversations())[0].indexedMessageCount,
            ).toBe(0);
            expect(
                (
                    await manager.indexConversations(
                        { scope: "all" },
                        imported.conversationId,
                    )
                ).indexed[0].newlyIndexed,
            ).toBe(0);
        } finally {
            await manager.close();
        }
    });

    it("reports persistence, search and purge failures instead of successful progress", async () => {
        const index = await open();
        const progress = jest.fn();
        service.failAppend = true;
        index.addMessage("A", "failed", "user", "1", progress);
        await expect(index.waitForPendingTasks()).rejects.toThrow(
            "append failed",
        );
        expect(progress).not.toHaveBeenCalled();
        expect(await index.getIndexedTurns("A")).toEqual(new Set());
        service.failAppend = false;
        index.addMessage("A", "retry", "user", "1", progress);
        await index.waitForPendingTasks();
        expect(progress).toHaveBeenCalledTimes(1);
        service.failSearch = true;
        await expect(index.search({ question: "query" })).rejects.toThrow(
            "projection failed",
        );
        service.failForget = true;
        await expect(index.tombstone("A")).rejects.toThrow("purge failed");
    });

    it("fails explicitly when no service is configured", async () => {
        const index = await createConversationSearchIndex(
            path.join(root, "_unified"),
        );
        index.addMessage("A", "offline", "user", "1");
        await expect(index.waitForPendingTasks()).rejects.toThrow(
            "Conversation content indexing requires a durable memory service",
        );
        await expect(index.search({ question: "query" })).rejects.toThrow(
            "Conversation content indexing requires a durable memory service",
        );
    });

    it("backs manager imports, indexed counts, restart and deletion with the shared façade", async () => {
        const options = {
            agentInitOptions: {
                memory: {
                    memoryServiceClient: createMemoryServiceRpcFacade(service),
                },
            },
        };
        let manager = await createConversationManager(
            "offline",
            options,
            path.join(root, "profile"),
            0,
            true,
        );
        try {
            const imported = await manager.importCopilotMirror({
                sessionId: "copilot-source",
                name: "Release notes",
                createdAt: "2026-09-01T00:00:00.000Z",
                lastSyncedTurnIndex: 1,
                displayLogEntries: [
                    {
                        type: "user-request",
                        command: "release risk",
                        requestId: { requestId: "copilot-turn-1" },
                        seq: 1,
                        timestamp: 0,
                    },
                ],
            });
            const indexed = await manager.indexConversations(
                { scope: "all" },
                imported.conversationId,
            );
            expect(indexed.indexed[0].newlyIndexed).toBe(1);
            const corpus = (await service.listCorpora())[0];
            const importedEvents = await service.listEvents({
                corpusId: corpus.corpusId,
                conversationIds: [imported.conversationId],
            });
            expect(importedEvents.items[0].turnId).toBe("copilot-turn-1");
            expect(importedEvents.items[0].eventTime).toBe(
                "1970-01-01T00:00:00.000Z",
            );
            manager.indexConversationMessage(
                imported.conversationId,
                "duplicate tee",
                "user",
                "copilot-turn-1",
            );
            expect(
                (await manager.listConversations())[0].indexedMessageCount,
            ).toBe(1);
            await manager.close();
            manager = await createConversationManager(
                "offline",
                options,
                path.join(root, "profile"),
                0,
                true,
            );
            expect(
                (
                    await manager.indexConversations(
                        { scope: "all" },
                        imported.conversationId,
                    )
                ).indexed[0].newlyIndexed,
            ).toBe(0);
            expect(
                (
                    await manager.searchConversationContent({
                        question: "release risk",
                    })
                )[0].snippets,
            ).toEqual(["release risk"]);
            await manager.deleteConversation(imported.conversationId);
            expect(
                await manager.searchConversationContent({
                    question: "release risk",
                }),
            ).toEqual([]);
            await manager.close();
            manager = await createConversationManager(
                "offline",
                options,
                path.join(root, "profile"),
                0,
                true,
            );
            await expect(
                manager.importCopilotMirror({
                    sessionId: "copilot-source",
                    name: "Release notes reimport",
                    createdAt: "2026-09-01T00:00:00.000Z",
                    lastSyncedTurnIndex: 1,
                    displayLogEntries: [],
                }),
            ).rejects.toThrow(
                "Copilot source was previously deleted: copilot-source",
            );
        } finally {
            await manager.close();
        }
    });

    it("migrates only pre-existing native turns and never backfills later live transcripts", async () => {
        const profile = path.join(root, "profile");
        const nativeDir = path.join(profile, "conversations", "native");
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(
            path.join(profile, "conversations", "conversations.json"),
            JSON.stringify({
                sessions: [
                    {
                        conversationId: "native",
                        name: "Native history",
                        createdAt: "2026-09-01T00:00:00.000Z",
                    },
                ],
            }),
        );
        const oldTurn = {
            type: "user-request",
            command: "old history",
            requestId: { requestId: "old" },
            seq: 1,
            timestamp: 0,
        };
        fs.writeFileSync(
            path.join(nativeDir, "displayLog.json"),
            JSON.stringify([oldTurn]),
        );
        const options = {
            conversationMemorySettings: {
                durableMemoryService: createMemoryServiceRpcFacade(service),
            },
        };
        let manager = await createConversationManager(
            "offline",
            options,
            profile,
            0,
            true,
        );
        try {
            fs.writeFileSync(
                path.join(nativeDir, "displayLog.json"),
                JSON.stringify([
                    oldTurn,
                    {
                        ...oldTurn,
                        command: "forgotten live history",
                        requestId: { requestId: "live" },
                        seq: 2,
                    },
                ]),
            );
            const indexed = await manager.indexConversations(
                { scope: "all" },
                "native",
            );
            expect(indexed.indexed[0].newlyIndexed).toBe(1);
            const corpus = (await service.listCorpora())[0];
            await service.forgetEvents({
                corpusId: corpus.corpusId,
                conversationIds: ["native"],
            });
            await manager.close();
            manager = await createConversationManager(
                "offline",
                options,
                profile,
                0,
                true,
            );
            expect(
                (await manager.indexConversations({ scope: "all" }, "native"))
                    .indexed[0].newlyIndexed,
            ).toBe(0);
            expect(
                (await manager.listConversations())[0].indexedMessageCount,
            ).toBe(0);
        } finally {
            await manager.close();
        }
    });
});

/** Real file ledger with a pre-scored KnowPro result contract, no model calls. */
class ScoredEventService extends FileMemoryService {
    public queries: string[] = [];
    public scores: Record<string, number> = {};
    public failAppend = false;
    public failSearch = false;
    public failForget = false;

    public override async appendEvent(request: MemoryEventAppendRequest) {
        if (this.failAppend) {
            throw new Error("append failed");
        }
        return super.appendEvent(request);
    }

    public override async forgetEvents(request: MemoryEventForgetRequest) {
        if (this.failForget) {
            throw new Error("purge failed");
        }
        return super.forgetEvents(request);
    }

    public override async searchEvents(
        request: MemoryEventSearchRequest,
    ): Promise<MemoryEventSearchResult> {
        this.queries.push(request.query);
        if (this.failSearch) {
            throw new Error("projection failed");
        }
        const events = (await this.listEvents(request)).items;
        return {
            query: request.query,
            matches: events
                .map((event) => ({
                    event,
                    snippet: event.content ?? "",
                    score: this.scores[event.content ?? ""] ?? 0.8,
                }))
                .sort((a, b) => b.score - a.score),
        };
    }
}
