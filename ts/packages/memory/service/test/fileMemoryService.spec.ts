// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    procedureFromMarkdown,
    procedureToMarkdown,
} from "../src/procedureMarkdown.js";
import type {
    CorpusIndex,
    CorpusIndexMatch,
    IndexedDocument,
    IngestionJobStatus,
    JobProgress,
    MemoryKnowledgeGraph,
} from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { writeFakeSemanticIndex } from "./fakeSemanticIndex.js";

class FakeCorpusIndex implements CorpusIndex {
    public documents: IndexedDocument[] = [];
    public indexDirectory: string | undefined;
    public initializeCalls = 0;
    public failNextRebuild = false;
    public failNextAppend = false;
    public blockNextRebuild = false;
    public blockNextAppend = false;
    public ignoreNextAbort = false;
    public answer?: NonNullable<CorpusIndex["answer"]>;
    public graph: MemoryKnowledgeGraph = {
        entities: [],
        topics: [],
        relationships: [],
    };

    public constructor(directory?: string) {
        this.indexDirectory = directory;
    }

    public async initialize(): Promise<void> {
        this.initializeCalls++;
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        if (this.failNextRebuild) {
            this.failNextRebuild = false;
            throw new Error("Expected index failure");
        }
        if (this.blockNextRebuild) {
            this.blockNextRebuild = false;
            await new Promise<void>((resolve, reject) => {
                if (this.ignoreNextAbort) {
                    this.ignoreNextAbort = false;
                    return;
                }
                if (signal.aborted) {
                    reject(signal.reason);
                    return;
                }
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
            });
        }
        await onProgress({
            completed: documents.length,
            total: documents.length,
            message: "Fake index complete",
        });
        if (this.indexDirectory !== undefined) {
            await writeFile(path.join(this.indexDirectory, "index.marker"), "");
            await writeFakeSemanticIndex(this.indexDirectory, documents);
        }
        this.documents = structuredClone(documents);
    }

    public async append(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        if (this.failNextAppend) {
            this.failNextAppend = false;
            throw new Error("Expected append failure");
        }
        if (this.blockNextAppend) {
            this.blockNextAppend = false;
            await new Promise<void>((resolve, reject) => {
                if (signal.aborted) {
                    reject(signal.reason);
                    return;
                }
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
            });
        }
        await onProgress({
            completed: documents.length,
            total: documents.length,
            message: "Fake append complete",
            operation: "append",
        });
        if (this.indexDirectory !== undefined) {
            await writeFile(path.join(this.indexDirectory, "index.marker"), "");
        }
        this.documents.push(...structuredClone(documents));
        if (this.indexDirectory !== undefined) {
            await writeFakeSemanticIndex(this.indexDirectory, this.documents);
        }
    }

    public async search(
        query: string,
        limit: number,
    ): Promise<CorpusIndexMatch[]> {
        return this.documents
            .filter((document) =>
                document.content.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, limit)
            .map((document, index) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                snippet: document.content,
                score: 1 - index / 10,
                locator: "fixture:1",
            }));
    }

    public async getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph> {
        if (sourceIds === undefined) {
            return structuredClone(this.graph);
        }
        return {
            entities: this.graph.entities.filter((item) =>
                item.sourceIds.some((sourceId) => sourceIds.has(sourceId)),
            ),
            topics: this.graph.topics.filter((item) =>
                item.sourceIds.some((sourceId) => sourceIds.has(sourceId)),
            ),
            relationships: this.graph.relationships.filter((item) =>
                item.sourceIds.some((sourceId) => sourceIds.has(sourceId)),
            ),
        };
    }
}

async function waitForTerminalJob(
    service: FileMemoryService,
    jobId: string,
): Promise<IngestionJobStatus> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const job = await service.getJob(jobId);
        if (
            job !== undefined &&
            ["complete", "failed", "cancelled"].includes(job.state)
        ) {
            return job;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Job '${jobId}' did not finish`);
}

describe("FileMemoryService", () => {
    let rootDirectory: string;
    let index: FakeCorpusIndex;
    let service: FileMemoryService;
    const open = (informationalViews = true) =>
        new FileMemoryService(rootDirectory, {
            informationalViews,
            eventIndexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexFactory: (_corpusId, indexDirectory) => {
                index.indexDirectory = indexDirectory;
                return index;
            },
        });

    beforeEach(async () => {
        rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-memory-service-"),
        );
        index = new FakeCorpusIndex();
        service = open();
    });

    afterEach(async () => {
        await service.close();
        await rm(rootDirectory, { recursive: true, force: true });
    });

    test("locks the storage root until the service closes", async () => {
        await service.initialize();
        const competingService = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });

        await expect(competingService.initialize()).rejects.toThrow();
        await competingService.close();
        await service.close();

        const replacementService = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });
        await expect(replacementService.initialize()).resolves.toBeUndefined();
        await replacementService.close();
    });

    test("releases a lock acquired concurrently with close", async () => {
        const racingService = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });

        await Promise.all([racingService.initialize(), racingService.close()]);

        const replacementService = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });
        await expect(replacementService.initialize()).resolves.toBeUndefined();
        await replacementService.close();
    });

    test("creates a named corpus idempotently under concurrency", async () => {
        const [first, second] = await Promise.all([
            service.createCorpus("Browser"),
            service.createCorpus("Browser"),
        ]);

        expect(second.corpusId).toBe(first.corpusId);
        expect(await service.listCorpora()).toEqual([first]);
    });

    test("marks persisted nonterminal jobs failed after restart", async () => {
        await service.close();
        const jobsDirectory = path.join(rootDirectory, "jobs");
        await mkdir(jobsDirectory, { recursive: true });
        await writeFile(
            path.join(jobsDirectory, "interrupted.json"),
            JSON.stringify({
                jobId: "interrupted",
                corpusId: "corpus",
                sourceId: "source",
                revisionId: "revision",
                state: "building-indexes",
                progress: {
                    completed: 1,
                    total: 2,
                    message: "Building indexes",
                },
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                warnings: [],
            } satisfies IngestionJobStatus),
        );
        const restarted = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });

        await restarted.initialize();

        await expect(restarted.getJob("interrupted")).resolves.toMatchObject({
            state: "failed",
            error: "Ingestion interrupted by service restart",
            progress: {
                message: "Ingestion interrupted by service restart",
            },
        });
        await restarted.close();
    });

    test("initializes the index before reading its knowledge graph", async () => {
        const corpus = await service.createCorpus("Browser");

        await expect(
            service.getKnowledgeGraph(corpus.corpusId),
        ).resolves.toEqual(index.graph);
        expect(index.initializeCalls).toBe(1);
    });

    test("publishes an ingested document as source-linked evidence", async () => {
        const corpus = await service.createCorpus("Engineering");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "design-doc",
                sourceType: "markdown",
                title: "Design",
                canonicalUri: "https://example.test/design",
                markdown: "# Design\n\nUse a supervised memory sidecar.",
                tags: ["architecture"],
            },
        });

        const job = await waitForTerminalJob(service, accepted.jobId);
        expect(job.state).toBe("complete");

        const result = await service.search({
            corpusId: corpus.corpusId,
            query: "sidecar",
        });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]).toMatchObject({
            sourceId: "design-doc",
            title: "Design",
            canonicalUri: "https://example.test/design",
            sourceType: "markdown",
        });
        const source = await service.getSource(corpus.corpusId, "design-doc");
        expect(source?.revisions).toHaveLength(1);
        expect(source).not.toHaveProperty("revisions.0.content");
    });

    test("answers with bounded source-linked evidence", async () => {
        const corpus = await service.createCorpus("Grounded");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "runbook",
                sourceType: "markdown",
                title: "Recovery runbook",
                markdown: "Restart the failed indexing worker.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);

        const result = await service.answer({
            corpusId: corpus.corpusId,
            answerMode: "extractive",
            question: "indexing",
        });

        expect(result).toMatchObject({
            grounded: true,
            citations: [{ sourceId: "runbook" }],
        });
        expect(result.answer).toContain("[1]");
        expect(result.answer).toContain("Restart the failed indexing worker.");
    });

    test("synthesizes answers through the index when supported", async () => {
        await service.close();
        service = open(false);
        const corpus = await service.createCorpus("Synthesized");
        for (const [sourceId, text] of [
            ["book-a", "Guest one recommended Dune."],
            ["book-b", "Guest two recommended Emma."],
        ]) {
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId,
                    sourceType: "markdown",
                    title: sourceId,
                    markdown: text,
                },
            });
            await waitForTerminalJob(service, accepted.jobId);
        }
        const calls: Array<ReadonlySet<string> | undefined> = [];
        index.answer = async (_query, _limit, sourceIds) => {
            calls.push(sourceIds);
            return {
                answer: "Dune and Emma were recommended.",
                matches: await index.search("recommended", 10),
            };
        };

        const defaulted = await service.answer({
            corpusId: corpus.corpusId,
            question: "Which books were recommended?",
        });
        expect(defaulted.mode).toBe("synthesized");
        expect(defaulted.answer).toBe("Dune and Emma were recommended.");
        expect(defaulted.citations.map((item) => item.sourceId).sort()).toEqual(
            ["book-a", "book-b"],
        );

        const scoped = await service.answer({
            corpusId: corpus.corpusId,
            question: "Which books were recommended?",
            sourceIds: ["book-a"],
        });
        expect(scoped.citations.map((item) => item.sourceId)).toEqual([
            "book-a",
        ]);
        expect(calls[1]).toEqual(new Set(["book-a"]));

        const extractive = await service.answer({
            corpusId: corpus.corpusId,
            question: "recommended",
            answerMode: "extractive",
        });
        expect(extractive.mode).toBe("extractive");
        expect(extractive.answer).toContain("[1]");
        expect(calls).toHaveLength(2);
    });

    test("reports no answer and rejects unsupported synthesis", async () => {
        await service.close();
        service = open(false);
        const corpus = await service.createCorpus("NoAnswer");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "doc",
                sourceType: "markdown",
                title: "Doc",
                markdown: "Unrelated text.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        await expect(
            service.answer({
                corpusId: corpus.corpusId,
                question: "anything",
                answerMode: "synthesized",
            }),
        ).rejects.toThrow("does not support synthesized answers");

        index.answer = async () => ({
            matches: [],
            whyNoAnswer: "Nothing relevant.",
        });
        const result = await service.answer({
            corpusId: corpus.corpusId,
            question: "anything",
        });
        expect(result.mode).toBe("synthesized");
        expect(result.answer).toBe("No supporting memory evidence was found.");
        expect(result.citations).toEqual([]);

        index.answer = async () => {
            throw new Error("model unavailable");
        };
        await expect(
            service.answer({
                corpusId: corpus.corpusId,
                question: "anything",
            }),
        ).rejects.toThrow("model unavailable");
    });

    test("appends events idempotently across service restarts", async () => {
        const corpus = await service.createCorpus("Episodes");
        const request = {
            corpusId: corpus.corpusId,
            idempotencyKey: "conversation-1:turn-1",
            producer: {
                producerId: "conversation-agent",
                producerType: "typeagent",
            },
            eventType: "turn.completed",
            sourceKind: "conversation" as const,
            observedAt: "2026-09-21T10:00:01.000Z",
            eventTime: "2026-09-21T10:00:00.000Z",
            conversationId: "conversation-1",
            runId: "run-1",
            turnId: "turn-1",
            sender: "user" as const,
            content: "Remember the deployment window.",
        };

        const first = await service.appendEvent(request);
        const duplicate = await service.appendEvent(request);

        expect(first.replayed).toBe(false);
        expect(duplicate).toEqual({
            event: first.event,
            replayed: true,
        });
        expect(
            (await service.listEvents({ corpusId: corpus.corpusId })).total,
        ).toBe(1);

        await service.close();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });

        await expect(service.appendEvent(request)).resolves.toEqual({
            event: first.event,
            replayed: true,
        });
    });

    test("filters and searches typed event provenance", async () => {
        const corpus = await service.createCorpus("Activity");
        const shared = {
            corpusId: corpus.corpusId,
            producer: {
                producerId: "browser",
                producerType: "browser-extension",
            },
            sourceKind: "web-activity" as const,
        };
        await service.appendEvent({
            ...shared,
            idempotencyKey: "visit-1",
            eventType: "page.visited",
            observedAt: "2026-09-21T10:00:00.000Z",
            content: "TypeAgent memory architecture",
            metadata: { authority: "producer-reported" },
        });
        await service.appendEvent({
            ...shared,
            idempotencyKey: "bookmark-1",
            eventType: "page.bookmarked",
            observedAt: "2026-09-21T11:00:00.000Z",
            content: "Structured retrieval guide",
        });
        await service.appendEvent({
            corpusId: corpus.corpusId,
            idempotencyKey: "turn-1",
            producer: {
                producerId: "conversation-agent",
                producerType: "typeagent",
            },
            eventType: "turn.completed",
            sourceKind: "conversation",
            observedAt: "2026-09-21T12:00:00.000Z",
            conversationId: "conversation-1",
            runId: "run-1",
            content: "Discussed memory architecture",
            metadata: {
                authority: "verified-observation",
                outcome: "failed",
            },
        });

        await expect(
            service.listEvents({
                corpusId: corpus.corpusId,
                producerIds: ["browser"],
                eventTypes: ["page.bookmarked"],
                observedFrom: "2026-09-21T10:30:00.000Z",
                observedTo: "2026-09-21T11:30:00.000Z",
            }),
        ).resolves.toMatchObject({
            total: 1,
            items: [{ eventType: "page.bookmarked" }],
        });
        await expect(
            service.listEvents({
                corpusId: corpus.corpusId,
                conversationIds: ["conversation-1"],
                runIds: ["run-1"],
                authorities: ["verified-observation"],
            }),
        ).resolves.toMatchObject({
            total: 1,
            items: [{ eventType: "turn.completed" }],
        });
        const found = await service.searchEvents({
            corpusId: corpus.corpusId,
            query: "architecture",
        });
        expect(found.matches).toHaveLength(2);
        expect(found.matches.map((match) => match.event.eventType)).toEqual(
            expect.arrayContaining(["turn.completed", "page.visited"]),
        );
        await expect(
            service.searchEvents({
                corpusId: corpus.corpusId,
                query: "architecture",
                authorities: ["verified-observation"],
                limit: 1,
            }),
        ).resolves.toMatchObject({
            matches: [
                {
                    event: {
                        eventType: "turn.completed",
                        metadata: {
                            authority: "verified-observation",
                            outcome: "failed",
                        },
                    },
                },
            ],
        });
        const eventIndexRoot = path.join(
            rootDirectory,
            corpus.corpusId,
            "event-search-index",
        );
        const generation = (await readdir(eventIndexRoot)).find(
            (entry) => entry !== "state.json",
        );
        expect(generation).toBeDefined();
        const documents = JSON.parse(
            await readFile(
                path.join(eventIndexRoot, generation!, "documents.json"),
                "utf8",
            ),
        ) as IndexedDocument[];
        expect(
            documents.find(
                (document) => document.source.title === "turn.completed",
            )?.indexTags,
        ).toContain("event-authority:verified-observation");
        await expect(
            service.appendEvent({
                ...shared,
                idempotencyKey: "unknown-authority",
                eventType: "page.visited",
                metadata: { authority: "unsupported-authority" },
            }),
        ).rejects.toThrow("Invalid event authority");
        await expect(
            service.appendEvent({
                ...shared,
                idempotencyKey: "bad-authority",
                eventType: "page.visited",
                metadata: { authority: 5 },
            }),
        ).rejects.toThrow("Event authority must be a string");
    });

    test("persists forgotten event keys and conversation/turn scopes without replay", async () => {
        const { corpusId } = await service.createCorpus("Suppressed activity");
        const event = (
            idempotencyKey: string,
            conversationId?: string,
            turnId?: string,
            producerId = "agent",
        ) => ({
            corpusId,
            idempotencyKey,
            producer: { producerId, producerType: "test" },
            eventType: "turn.completed",
            sourceKind: "conversation" as const,
            content: `Private ${idempotencyKey} content`,
            ...(conversationId === undefined ? {} : { conversationId }),
            ...(turnId === undefined ? {} : { turnId }),
        });
        const removed = event("removed", "conversation-1", "turn-1");
        const retained = event("retained", "conversation-1", "turn-2");
        const other = event("other", "conversation-2", "turn-1");
        const removedId = (await service.appendEvent(removed)).event.eventId;
        await service.appendEvent(retained);
        await service.appendEvent(other);
        await service.forgetEvents({
            corpusId,
            eventIds: [removedId],
            conversationIds: ["conversation-1"],
        });
        await expect(service.appendEvent(removed)).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        await expect(
            service.appendEvent(
                event("changed-key", "conversation-1", "turn-1"),
            ),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await expect(service.appendEvent(other)).resolves.toMatchObject({
            replayed: true,
        });
        await expect(
            service.forgetEvents({
                corpusId,
                conversationIds: ["conversation-1"],
            }),
        ).resolves.toMatchObject({ deletedEventCount: 1 });
        await expect(
            service.forgetEvents({
                corpusId,
                conversationIds: ["empty-conversation"],
            }),
        ).resolves.toMatchObject({ deletedEventCount: 0 });
        await expect(
            service.forgetEvents({
                corpusId,
                conversationIds: ["conversation-2"],
                turnIds: ["future-turn"],
            }),
        ).resolves.toMatchObject({ deletedEventCount: 0 });
        await expect(
            service.appendEvent(event("new", "conversation-1", "turn-3")),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await expect(
            service.appendEvent(event("new", "empty-conversation", "turn-1")),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await expect(
            service.appendEvent(event("new", "conversation-2", "future-turn")),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await service.appendEvent(event("allowed", "conversation-2", "turn-2"));
        const keyOnly = event("key-only");
        const keyOnlyId = (await service.appendEvent(keyOnly)).event.eventId;
        await service.forgetEvents({ corpusId, eventIds: [keyOnlyId] });
        await expect(service.appendEvent(keyOnly)).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        await service.appendEvent(
            event("key-only", undefined, undefined, "independent"),
        );
        await service.forgetEvents({ corpusId, turnIds: ["global-turn"] });
        await expect(
            service.appendEvent(
                event("blocked-globally", "conversation-2", "global-turn"),
            ),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await service.forgetEvents({
            corpusId,
            sourceKinds: ["conversation"],
            conversationIds: ["conversation-2"],
            turnIds: ["authority-turn"],
            authorities: ["evidence-only"],
        });
        await expect(
            service.appendEvent({
                ...event("reasoning", "conversation-2", "authority-turn"),
                metadata: { authority: "evidence-only" },
            }),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await service.appendEvent({
            ...event("verified", "conversation-2", "authority-turn"),
            metadata: { authority: "verified-observation" },
        });
        const ledger = await readFile(
            path.join(rootDirectory, corpusId, "events.jsonl"),
            "utf8",
        );
        expect(ledger).toContain('"recordType":"event-suppression"');
        expect(ledger).not.toContain("Private removed content");
        expect(ledger).not.toContain("Private retained content");
        expect((await service.listEvents({ corpusId })).total).toBe(4);

        await service.close();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });
        await expect(service.appendEvent(removed)).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        await expect(
            service.appendEvent(event("newer", "conversation-1", "turn-5")),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await expect(
            service.appendEvent(
                event("newer", "conversation-2", "future-turn"),
            ),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        expect((await service.listEvents({ corpusId })).total).toBe(4);
    });

    test("suppresses an unindexed conversation turn using dispatcher forget selectors", async () => {
        const { corpusId } = await service.createCorpus("Future turn");
        await expect(
            service.forgetEvents({
                corpusId,
                sourceKinds: ["conversation"],
                conversationIds: ["conversation-1"],
                turnIds: ["turn-1"],
            }),
        ).resolves.toMatchObject({ deletedEventCount: 0 });
        const append = (
            sourceKind: "conversation" | "web-activity",
            turnId: string,
        ) =>
            service.appendEvent({
                corpusId,
                idempotencyKey: `${sourceKind}-${turnId}`,
                producer: { producerId: "agent", producerType: "test" },
                eventType: "turn.completed",
                sourceKind,
                conversationId: "conversation-1",
                turnId,
                content: "Turn content",
            });
        await expect(append("conversation", "turn-1")).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        await append("web-activity", "turn-1");
        await append("conversation", "turn-2");
        expect(
            (await service.listEvents({ corpusId, turnIds: ["turn-1"] })).total,
        ).toBe(1);
        await service.close();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });
        await expect(append("conversation", "turn-1")).rejects.toMatchObject({
            code: "EVENT_FORGOTTEN",
        });
        expect((await service.listEvents({ corpusId })).total).toBe(2);
    });

    test("suppresses an empty conversation using the server migration selector", async () => {
        const { corpusId } = await service.createCorpus("Deleted conversation");
        await expect(
            service.forgetEvents({
                corpusId,
                sourceKinds: ["conversation"],
                conversationIds: ["deleted-conversation"],
            }),
        ).resolves.toMatchObject({ deletedEventCount: 0 });
        await service.close();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) =>
                new FakeCorpusIndex(directory),
        });
        await expect(
            service.appendEvent({
                corpusId,
                idempotencyKey: JSON.stringify([
                    "deleted-conversation",
                    "server-turn",
                    "user-turn",
                ]),
                producer: {
                    producerId: "typeagent.agent-server.conversation-history",
                    producerType: "conversation-history",
                },
                eventType: "user-turn",
                sourceKind: "conversation",
                conversationId: "deleted-conversation",
                turnId: "server-turn",
                content: "Retained transcript must not return",
                metadata: { authority: "user-assertion" },
            }),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        await service.appendEvent({
            corpusId,
            idempotencyKey: "independent-activity",
            producer: { producerId: "browser", producerType: "extension" },
            eventType: "page.visited",
            sourceKind: "web-activity",
            conversationId: "deleted-conversation",
            content: "Unrelated web activity",
        });
        expect((await service.listEvents({ corpusId })).total).toBe(1);
    });

    test("forgets events independently from linked documents", async () => {
        const corpus = await service.createCorpus("Linked activity");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "page-1",
                sourceType: "markdown",
                title: "Page",
                markdown: "Durable page content",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        const appended = await service.appendEvent({
            corpusId: corpus.corpusId,
            idempotencyKey: "visit-1",
            producer: {
                producerId: "browser",
                producerType: "browser-extension",
            },
            eventType: "page.visited",
            sourceKind: "web-activity",
            observedAt: "2026-09-21T10:00:00.000Z",
            linkedSourceIds: ["page-1"],
        });

        await expect(
            service.forgetEvents({
                corpusId: corpus.corpusId,
                eventIds: [appended.event.eventId],
            }),
        ).resolves.toMatchObject({
            deletedEventCount: 1,
            deletedSourceCount: 0,
            retainedLinkedSourceIds: ["page-1"],
        });
        await expect(
            service.getSource(corpus.corpusId, "page-1"),
        ).resolves.toBeDefined();
    });

    test("forgets event ranges and unshared linked documents explicitly", async () => {
        const corpus = await service.createCorpus("Lifecycle");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "page-1",
                sourceType: "text",
                title: "Page",
                text: "Disposable page",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        for (const [idempotencyKey, observedAt, runId] of [
            ["event-1", "2026-09-21T10:00:00.000Z", "run-1"],
            ["event-2", "2026-09-21T11:00:00.000Z", "run-2"],
        ] as const) {
            await service.appendEvent({
                corpusId: corpus.corpusId,
                idempotencyKey,
                producer: {
                    producerId: "browser",
                    producerType: "browser-extension",
                },
                eventType: "page.visited",
                sourceKind: "web-activity",
                observedAt,
                runId,
                linkedSourceIds: ["page-1"],
            });
        }

        await expect(
            service.forgetEvents({
                corpusId: corpus.corpusId,
                runIds: ["run-1"],
                forgetLinkedSources: true,
            }),
        ).resolves.toMatchObject({
            deletedEventCount: 1,
            deletedSourceCount: 0,
            retainedLinkedSourceIds: ["page-1"],
        });
        await expect(
            service.forgetEvents({
                corpusId: corpus.corpusId,
                observedFrom: "2026-09-21T10:30:00.000Z",
                observedTo: "2026-09-21T11:30:00.000Z",
                forgetLinkedSources: true,
            }),
        ).resolves.toMatchObject({
            deletedEventCount: 1,
            deletedSourceCount: 1,
            retainedLinkedSourceIds: [],
        });
        await expect(
            service.getSource(corpus.corpusId, "page-1"),
        ).resolves.toBeUndefined();
    });

    test("persists content indexing and chunk size with the active revision", async () => {
        const corpus = await service.createCorpus("Content");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "basic-doc",
                sourceType: "text",
                title: "Basic",
                text: "Model-free exact-search content",
            },
            pipeline: {
                mode: "content",
                maxCharsPerChunk: 256,
            },
        });

        await waitForTerminalJob(service, accepted.jobId);

        expect(index.documents[0].pipeline).toEqual({
            mode: "content",
            maxCharsPerChunk: 256,
        });
        await expect(
            service.getSource(corpus.corpusId, "basic-doc"),
        ).resolves.toMatchObject({
            revisions: [
                {
                    pipeline: {
                        mode: "content",
                        maxCharsPerChunk: 256,
                    },
                },
            ],
        });
    });

    test("reports counts and pages sources while bounding revision content", async () => {
        const corpus = await service.createCorpus("Managed");
        for (const sourceId of ["source-b", "source-a"]) {
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text: "0123456789",
                },
            });
            await waitForTerminalJob(service, accepted.jobId);
        }

        const firstPage = await service.listSourcesPage({
            corpusId: corpus.corpusId,
            pageSize: 1,
        });
        expect(firstPage).toMatchObject({
            total: 2,
            nextContinuationToken: "1",
            items: [{ sourceId: "source-a" }],
        });
        await expect(
            service.listSourcesPage({
                corpusId: corpus.corpusId,
                pageSize: 1,
                ...(firstPage.nextContinuationToken === undefined
                    ? {}
                    : {
                          continuationToken: firstPage.nextContinuationToken,
                      }),
            }),
        ).resolves.toMatchObject({
            total: 2,
            items: [{ sourceId: "source-b" }],
        });
        await expect(
            service.listSourcesPage({
                corpusId: corpus.corpusId,
                query: "SOURCE-B",
            }),
        ).resolves.toMatchObject({
            total: 1,
            items: [{ sourceId: "source-b" }],
        });
        await expect(
            service.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: "source-a",
                offset: 2,
                maxChars: 4,
            }),
        ).resolves.toMatchObject({
            content: "2345",
            totalChars: 10,
            truncated: true,
            nextOffset: 6,
        });
        await expect(service.getCorpus(corpus.corpusId)).resolves.toMatchObject(
            {
                sourceCount: 2,
                revisionCount: 2,
                readyRevisionCount: 2,
                failedRevisionCount: 0,
                activeJobCount: 0,
            },
        );
        await expect(
            service.reindexSource(corpus.corpusId, "source-a"),
        ).resolves.toMatchObject({
            sourceId: "source-a",
            sourceCount: 2,
        });
        await expect(
            service.reindexCorpus(corpus.corpusId),
        ).resolves.toMatchObject({ sourceCount: 2 });
        expect(index.documents).toHaveLength(2);
    });

    test("replaces an expected revision and preserves revision history", async () => {
        const corpus = await service.createCorpus("Managed");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "runbook",
                sourceType: "markdown",
                title: "Runbook",
                markdown: "Version one.",
            },
            pipeline: { mode: "content", maxCharsPerChunk: 4_000 },
        });
        await waitForTerminalJob(service, accepted.jobId);

        const replacement = await service.replaceSource({
            corpusId: corpus.corpusId,
            sourceId: "runbook",
            expectedActiveRevisionId: accepted.revisionId,
            source: {
                sourceType: "markdown",
                title: "Runbook",
                markdown: "Version two.",
            },
        });
        expect(
            (await waitForTerminalJob(service, replacement.jobId)).state,
        ).toBe("complete");
        expect(
            (await service.getSource(corpus.corpusId, "runbook"))?.revisions,
        ).toHaveLength(2);
        expect(
            (await service.getSource(corpus.corpusId, "runbook"))?.revisions.at(
                -1,
            )?.pipeline,
        ).toEqual({ mode: "content", maxCharsPerChunk: 4_000 });
        await expect(
            service.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: "runbook",
            }),
        ).resolves.toMatchObject({ content: "Version two." });

        const stale = await service.replaceSource({
            corpusId: corpus.corpusId,
            sourceId: "runbook",
            expectedActiveRevisionId: accepted.revisionId,
            source: {
                sourceType: "markdown",
                title: "Runbook",
                markdown: "Stale update.",
            },
        });
        expect((await waitForTerminalJob(service, stale.jobId)).state).toBe(
            "failed",
        );
    });

    test("persists deletion confirmation and removes source-derived indexes after restart", async () => {
        const corpus = await service.createCorpus("Managed");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "obsolete",
                sourceType: "markdown",
                title: "Obsolete",
                markdown: "Delete this derived knowledge.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        index.graph.entities.push({
            name: "Obsolete",
            types: ["document"],
            mentionCount: 1,
            sourceIds: ["obsolete"],
        });
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "obsolete",
        );
        expect(preview).toMatchObject({
            revisionCount: 1,
            derivedEntityCount: 1,
        });
        await expect(
            service.forgetSource({
                corpusId: corpus.corpusId,
                sourceId: "obsolete",
                confirmationToken: "wrong-token",
            }),
        ).rejects.toThrow("Invalid or stale source forget confirmation");
        await expect(
            service.getSource(corpus.corpusId, "obsolete"),
        ).resolves.toBeDefined();

        await service.close();
        index = new FakeCorpusIndex();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, indexDirectory) => {
                index.indexDirectory = indexDirectory;
                return index;
            },
        });
        await expect(
            service.forgetSource({
                corpusId: corpus.corpusId,
                sourceId: "obsolete",
                confirmationToken: preview.confirmationToken,
            }),
        ).resolves.toMatchObject({ deletedRevisionCount: 1 });

        await expect(
            service.getSource(corpus.corpusId, "obsolete"),
        ).resolves.toBeUndefined();
        expect(index.documents).toEqual([]);
        expect(
            (
                await readdir(
                    path.join(rootDirectory, corpus.corpusId, "index"),
                    { withFileTypes: true },
                )
            ).filter((entry) => entry.isDirectory()),
        ).toHaveLength(1);
        await expect(service.getCorpus(corpus.corpusId)).resolves.toMatchObject(
            { sourceCount: 0, revisionCount: 0 },
        );
        await expect(
            service.listJobs({
                corpusId: corpus.corpusId,
                sourceId: "obsolete",
                states: ["complete"],
            }),
        ).resolves.toMatchObject({ total: 1 });
    });

    test("clears durable sources and their index entries", async () => {
        const corpus = await service.createCorpus("Browser");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "bookmark",
                sourceType: "web",
                title: "Bookmark",
                canonicalUri: "https://example.test/bookmark",
                markdown: "Durable bookmark content.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);

        await expect(service.clearCorpus(corpus.corpusId)).resolves.toBe(1);

        await expect(service.listSources(corpus.corpusId)).resolves.toEqual([]);
        await expect(
            service.search({
                corpusId: corpus.corpusId,
                query: "bookmark",
            }),
        ).resolves.toMatchObject({ matches: [] });
        await expect(service.listCorpora()).resolves.toEqual([
            expect.objectContaining({
                corpusId: corpus.corpusId,
                documentCount: 0,
                status: "ready",
            }),
        ]);
    });

    test("treats an unchanged source as an idempotent import", async () => {
        const corpus = await service.createCorpus("Engineering");
        const request = {
            corpusId: corpus.corpusId,
            source: {
                sourceId: "runbook",
                sourceType: "markdown" as const,
                title: "Runbook",
                markdown: "Restart the service after configuration changes.",
            },
        };
        const first = await service.ingestDocument(request);
        expect((await waitForTerminalJob(service, first.jobId)).state).toBe(
            "complete",
        );
        const second = await service.ingestDocument(request);
        const secondJob = await waitForTerminalJob(service, second.jobId);

        expect(secondJob.state).toBe("complete");
        expect(secondJob.progress.message).toBe("Source is unchanged");
        expect(index.documents).toHaveLength(1);
    });

    test("applies source and tag filters", async () => {
        const corpus = await service.createCorpus("Engineering");
        for (const source of [
            {
                sourceId: "public-doc",
                title: "Public",
                tags: ["public"],
            },
            {
                sourceId: "private-doc",
                title: "Private",
                tags: ["private"],
            },
        ]) {
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    ...source,
                    sourceType: "markdown",
                    markdown: "Shared authentication guidance.",
                },
            });
            await waitForTerminalJob(service, accepted.jobId);
        }

        const result = await service.search({
            corpusId: corpus.corpusId,
            query: "authentication",
            tags: ["private"],
        });
        expect(result.matches.map((match) => match.sourceId)).toEqual([
            "private-doc",
        ]);
    });

    test("returns the knowledge graph from the durable corpus index", async () => {
        const corpus = await service.createCorpus("Engineering");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "design-doc",
                sourceType: "markdown",
                title: "Design",
                markdown: "TypeAgent is software.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        index.graph.entities.push({
            name: "TypeAgent",
            types: ["software"],
            mentionCount: 2,
            sourceIds: ["design-doc"],
        });
        index.graph.entities.push({
            name: "Unrelated",
            types: ["other"],
            mentionCount: 1,
            sourceIds: ["other-doc"],
        });

        await expect(
            service.getKnowledgeGraph(corpus.corpusId),
        ).resolves.toEqual(index.graph);
        await expect(
            service.getSourceKnowledge(corpus.corpusId, "design-doc"),
        ).resolves.toEqual({
            entities: [index.graph.entities[0]],
            topics: [],
            relationships: [],
        });
        await expect(
            service.getSourceKnowledge(corpus.corpusId, "missing"),
        ).rejects.toThrow("Unknown source 'missing'");
    });

    test("suppresses and restores source knowledge across reindex and restart", async () => {
        const corpus = await service.createCorpus("Curated knowledge");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "design-doc",
                sourceType: "markdown",
                title: "Design",
                markdown: "TypeAgent uses a memory service.",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        index.graph = {
            entities: [
                {
                    name: "TypeAgent",
                    types: ["software"],
                    mentionCount: 2,
                    sourceIds: ["design-doc", "other-doc"],
                },
                {
                    name: "Memory Service",
                    types: ["component"],
                    mentionCount: 1,
                    sourceIds: ["design-doc"],
                },
            ],
            topics: [
                {
                    name: "Architecture",
                    mentionCount: 1,
                    sourceIds: ["design-doc"],
                },
            ],
            relationships: [
                {
                    fromEntity: "TypeAgent",
                    toEntity: "Memory Service",
                    relationshipType: "uses",
                    count: 1,
                    sourceIds: ["design-doc"],
                },
            ],
        };

        await service.suppressSourceKnowledge({
            corpusId: corpus.corpusId,
            sourceId: "design-doc",
            kind: "entity",
            name: "typeagent",
        });
        await service.suppressSourceKnowledge({
            corpusId: corpus.corpusId,
            sourceId: "design-doc",
            kind: "topic",
            name: "Architecture",
        });

        await expect(
            service.getSourceKnowledge(corpus.corpusId, "design-doc"),
        ).resolves.toEqual({
            entities: [index.graph.entities[1]],
            topics: [],
            relationships: [],
        });
        await expect(
            service.getKnowledgeGraph(corpus.corpusId),
        ).resolves.toMatchObject({
            entities: [
                { name: "TypeAgent", sourceIds: ["other-doc"] },
                { name: "Memory Service", sourceIds: ["design-doc"] },
            ],
        });
        await service.reindexCorpus(corpus.corpusId);
        await service.close();

        const restartedIndex = new FakeCorpusIndex();
        restartedIndex.graph = structuredClone(index.graph);
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, directory) => {
                restartedIndex.indexDirectory = directory;
                return restartedIndex;
            },
        });
        await expect(
            service.listSourceKnowledgeSuppressions(
                corpus.corpusId,
                "design-doc",
            ),
        ).resolves.toEqual([
            { sourceId: "design-doc", kind: "entity", name: "typeagent" },
            {
                sourceId: "design-doc",
                kind: "topic",
                name: "Architecture",
            },
        ]);
        await expect(
            service.getSourceKnowledge(corpus.corpusId, "design-doc"),
        ).resolves.toMatchObject({ entities: [{ name: "Memory Service" }] });

        await service.restoreSourceKnowledge({
            corpusId: corpus.corpusId,
            sourceId: "design-doc",
            kind: "entity",
            name: "TypeAgent",
        });
        await expect(
            service.getSourceKnowledge(corpus.corpusId, "design-doc"),
        ).resolves.toMatchObject({
            entities: [{ name: "TypeAgent" }, { name: "Memory Service" }],
            relationships: [{ relationshipType: "uses" }],
        });
    });

    test("keeps the prior committed revision when rebuilding fails", async () => {
        const corpus = await service.createCorpus("Engineering");
        const first = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "design-doc",
                sourceType: "markdown",
                title: "Design",
                markdown: "The stable design uses queues.",
            },
        });
        await waitForTerminalJob(service, first.jobId);

        index.failNextRebuild = true;
        const failed = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "design-doc",
                sourceType: "markdown",
                title: "Design",
                markdown: "This unpublished revision uses streams.",
            },
        });
        expect((await waitForTerminalJob(service, failed.jobId)).state).toBe(
            "failed",
        );

        const stable = await service.search({
            corpusId: corpus.corpusId,
            query: "queues",
        });
        const unpublished = await service.search({
            corpusId: corpus.corpusId,
            query: "streams",
        });
        expect(stable.matches).toHaveLength(1);
        expect(unpublished.matches).toHaveLength(0);
    });

    test("keeps the prior generation and removes the candidate when append fails", async () => {
        const corpus = await service.createCorpus("Engineering");
        const first = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "stable-doc",
                sourceType: "markdown",
                title: "Stable",
                markdown: "The stable source uses queues.",
            },
        });
        await waitForTerminalJob(service, first.jobId);
        const before = await readdir(
            path.join(rootDirectory, corpus.corpusId, "index"),
        );

        index.failNextAppend = true;
        const failed = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "candidate-doc",
                sourceType: "markdown",
                title: "Candidate",
                markdown: "The candidate source uses streams.",
            },
        });
        expect((await waitForTerminalJob(service, failed.jobId)).state).toBe(
            "failed",
        );

        await expect(
            service.search({ corpusId: corpus.corpusId, query: "queues" }),
        ).resolves.toMatchObject({
            matches: [expect.objectContaining({ sourceId: "stable-doc" })],
        });
        await expect(
            service.search({ corpusId: corpus.corpusId, query: "streams" }),
        ).resolves.toMatchObject({ matches: [] });
        expect(
            await readdir(path.join(rootDirectory, corpus.corpusId, "index")),
        ).toEqual(before);
    });

    test("serializes concurrent appends without losing either source", async () => {
        const corpus = await service.createCorpus("Engineering");
        const seed = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "seed-doc",
                sourceType: "markdown",
                title: "Seed",
                markdown: "The seed source uses anchors.",
            },
        });
        await waitForTerminalJob(service, seed.jobId);

        const [first, second] = await Promise.all([
            service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "first-append",
                    sourceType: "markdown",
                    title: "First append",
                    markdown: "The first append uses cobalt.",
                },
            }),
            service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "second-append",
                    sourceType: "markdown",
                    title: "Second append",
                    markdown: "The second append uses quartz.",
                },
            }),
        ]);
        await Promise.all([
            waitForTerminalJob(service, first.jobId),
            waitForTerminalJob(service, second.jobId),
        ]);

        await expect(service.listSources(corpus.corpusId)).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sourceId: "seed-doc" }),
                expect.objectContaining({ sourceId: "first-append" }),
                expect.objectContaining({ sourceId: "second-append" }),
            ]),
        );
        await expect(
            service.search({ corpusId: corpus.corpusId, query: "cobalt" }),
        ).resolves.toMatchObject({
            matches: [expect.objectContaining({ sourceId: "first-append" })],
        });
        await expect(
            service.search({ corpusId: corpus.corpusId, query: "quartz" }),
        ).resolves.toMatchObject({
            matches: [expect.objectContaining({ sourceId: "second-append" })],
        });
    });

    test("cancels an active incremental append without publishing it", async () => {
        const corpus = await service.createCorpus("Engineering");
        const seed = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "seed-doc",
                sourceType: "markdown",
                title: "Seed",
                markdown: "The seed source uses anchors.",
            },
        });
        await waitForTerminalJob(service, seed.jobId);

        index.blockNextAppend = true;
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "cancelled-append",
                sourceType: "markdown",
                title: "Cancelled append",
                markdown: "This candidate uses peridot.",
            },
        });
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            if (
                (await service.getJob(accepted.jobId))?.state ===
                "building-indexes"
            ) {
                break;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        await service.cancelJob(accepted.jobId);

        expect((await waitForTerminalJob(service, accepted.jobId)).state).toBe(
            "cancelled",
        );
        await expect(
            service.search({ corpusId: corpus.corpusId, query: "peridot" }),
        ).resolves.toMatchObject({ matches: [] });
        await expect(
            service.getSource(corpus.corpusId, "cancelled-append"),
        ).resolves.toBeUndefined();
    });

    test("cancels an active index rebuild", async () => {
        const corpus = await service.createCorpus("Engineering");
        index.blockNextRebuild = true;
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "large-doc",
                sourceType: "markdown",
                title: "Large document",
                markdown: "A long-running import.",
            },
        });

        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            const job = await service.getJob(accepted.jobId);
            if (job?.state === "building-indexes") {
                break;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        await service.cancelJob(accepted.jobId);

        const job = await waitForTerminalJob(service, accepted.jobId);
        expect(job.state).toBe("cancelled");
        expect(index.documents).toHaveLength(0);
    });

    test("cancels when an index rebuild does not observe the signal", async () => {
        const corpus = await service.createCorpus("Engineering");
        index.blockNextRebuild = true;
        index.ignoreNextAbort = true;
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "stuck-doc",
                sourceType: "markdown",
                title: "Stuck document",
                markdown: "A model request that does not stop promptly.",
            },
        });

        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            if (
                (await service.getJob(accepted.jobId))?.state ===
                "building-indexes"
            ) {
                break;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        await service.cancelJob(accepted.jobId);

        expect((await waitForTerminalJob(service, accepted.jobId)).state).toBe(
            "cancelled",
        );
    });

    test("round trips deterministic procedure Markdown with free-form sections", () => {
        const document = {
            title: "Publish a package",
            summary: "Release the tested package.",
            steps: ["Build it", "Publish it"],
            citations: [
                {
                    sourceId: "release-guide",
                    revisionId: "rev-1",
                    locator: "lines 10-20",
                    excerpt: "Run the publish command.",
                },
            ],
            additionalSections: [
                {
                    heading: "Troubleshooting",
                    content: "Retry after refreshing credentials.",
                },
            ],
        };

        const markdown = procedureToMarkdown(document);
        expect(procedureFromMarkdown(markdown)).toEqual(document);
        expect(procedureToMarkdown(procedureFromMarkdown(markdown))).toBe(
            markdown,
        );
    });
});
