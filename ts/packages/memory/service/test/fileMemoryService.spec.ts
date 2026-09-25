// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createMemoryServiceRpcFacade } from "../src/rpcFacade.js";
import {
    procedureFromMarkdown,
    procedureToMarkdown,
} from "../src/personalHowToStore.js";
import type {
    CorpusIndex,
    CorpusIndexMatch,
    IndexedDocument,
    IngestionJobStatus,
    JobProgress,
    MemoryKnowledgeGraph,
} from "../src/types.js";

class FakeCorpusIndex implements CorpusIndex {
    public documents: IndexedDocument[] = [];
    public indexDirectory: string | undefined;
    public initializeCalls = 0;
    public failNextRebuild = false;
    public failNextAppend = false;
    public blockNextRebuild = false;
    public blockNextAppend = false;
    public ignoreNextAbort = false;
    public graph: MemoryKnowledgeGraph = {
        entities: [],
        topics: [],
        relationships: [],
    };

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

    beforeEach(async () => {
        rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-memory-service-"),
        );
        index = new FakeCorpusIndex();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: (_corpusId, indexDirectory) => {
                index.indexDirectory = indexDirectory;
                return index;
            },
        });
    });

    afterEach(async () => {
        await service.close();
        await rm(rootDirectory, { recursive: true, force: true });
    });

    test("locks the storage root until the service closes", async () => {
        await service.initialize();
        const competingService = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
        });

        await expect(competingService.initialize()).rejects.toThrow();
        await competingService.close();
        await service.close();

        const replacementService = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
        });
        await expect(replacementService.initialize()).resolves.toBeUndefined();
        await replacementService.close();
    });

    test("releases a lock acquired concurrently with close", async () => {
        const racingService = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
        });

        await Promise.all([racingService.initialize(), racingService.close()]);

        const replacementService = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
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
            indexFactory: () => new FakeCorpusIndex(),
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
            question: "indexing",
        });

        expect(result).toMatchObject({
            grounded: true,
            citations: [{ sourceId: "runbook" }],
        });
        expect(result.answer).toContain("[1]");
        expect(result.answer).toContain("Restart the failed indexing worker.");
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
            indexFactory: () => new FakeCorpusIndex(),
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
            }),
        ).resolves.toMatchObject({
            total: 1,
            items: [{ eventType: "turn.completed" }],
        });
        await expect(
            service.searchEvents({
                corpusId: corpus.corpusId,
                query: "architecture",
            }),
        ).resolves.toMatchObject({
            matches: [
                { event: { eventType: "turn.completed" } },
                { event: { eventType: "page.visited" } },
            ],
        });
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

    test("persists indexing mode and chunk size with the active revision", async () => {
        const corpus = await service.createCorpus("Basic");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "basic-doc",
                sourceType: "text",
                title: "Basic",
                text: "Model-free exact-search content",
            },
            pipeline: {
                mode: "basic",
                maxCharsPerChunk: 256,
            },
        });

        await waitForTerminalJob(service, accepted.jobId);

        expect(index.documents[0].pipeline).toEqual({
            mode: "basic",
            maxCharsPerChunk: 256,
        });
        await expect(
            service.getSource(corpus.corpusId, "basic-doc"),
        ).resolves.toMatchObject({
            revisions: [
                {
                    pipeline: {
                        mode: "basic",
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
            pipeline: { mode: "basic", maxCharsPerChunk: 4_000 },
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
        ).toEqual({ mode: "basic", maxCharsPerChunk: 4_000 });
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

    test("preserves personal how-to settings across source operations", async () => {
        const corpus = await service.createCorpus("How-to");
        const settings = await service.updatePersonalHowToSettings(
            corpus.corpusId,
            {
                expectedRevision: 0,
                enabled: false,
                detectCandidates: false,
                preferences: { language: "en-US" },
            },
        );
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "guide",
                sourceType: "markdown",
                title: "Guide",
                markdown: "Original instructions",
            },
        });
        await waitForTerminalJob(service, accepted.jobId);
        await service.reindexSource(corpus.corpusId, "guide");
        const replacement = await service.replaceSource({
            corpusId: corpus.corpusId,
            sourceId: "guide",
            expectedActiveRevisionId: accepted.revisionId,
            source: {
                sourceType: "markdown",
                title: "Guide",
                markdown: "Revised instructions",
            },
        });
        await waitForTerminalJob(service, replacement.jobId);
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "guide",
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: "guide",
            confirmationToken: preview.confirmationToken,
        });

        expect(await service.getPersonalHowToSettings(corpus.corpusId)).toEqual(
            settings,
        );
    });

    test("enforces optimistic settings revisions", async () => {
        const corpus = await service.createCorpus("How-to");
        const first = await service.updatePersonalHowToSettings(
            corpus.corpusId,
            { expectedRevision: 0, enabled: false },
        );

        await expect(
            service.updatePersonalHowToSettings(corpus.corpusId, {
                expectedRevision: 0,
                enabled: true,
            }),
        ).rejects.toThrow(
            "Personal how-to settings revision conflict: expected 0, actual 1",
        );
        expect(first.revision).toBe(1);
        expect(
            (await service.getPersonalHowToSettings(corpus.corpusId)).enabled,
        ).toBe(false);
    });

    test("exposes personal how-to operations through the RPC facade", async () => {
        const corpus = await service.createCorpus("How-to RPC");
        const facade = createMemoryServiceRpcFacade(service);
        await facade.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: 0,
            detectCandidates: false,
        });
        const candidate = await facade.createProcedureCandidate({
            corpusId: corpus.corpusId,
            candidateId: "rpc-candidate",
            title: "RPC procedure",
            steps: ["Call the facade"],
            citations: [],
        });
        await facade.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "rpc-procedure",
            candidateId: candidate.candidateId,
        });

        expect(
            await facade.getPersonalHowToSettings(corpus.corpusId),
        ).toMatchObject({ revision: 1, detectCandidates: false });
        expect(
            await facade.searchProcedures({
                corpusId: corpus.corpusId,
                query: "facade",
            }),
        ).toEqual([
            expect.objectContaining({
                procedure: expect.objectContaining({
                    procedureId: "rpc-procedure",
                }),
            }),
        ]);
    });

    test("detects deterministic candidates from procedural source sections", async () => {
        const corpus = await service.createCorpus("Detected how-tos");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "router-guide",
                sourceType: "markdown",
                title: "Router guide",
                markdown: [
                    "# Reset a router",
                    "",
                    "## Steps",
                    "1. Unplug the router",
                    "2. Wait thirty seconds",
                    "3. Plug it back in",
                    "",
                    "## Troubleshooting checklist",
                    "- [ ] Check the power light",
                    "- [x] Check the network cable",
                ].join("\n"),
            },
        });
        expect((await waitForTerminalJob(service, accepted.jobId)).state).toBe(
            "complete",
        );

        const candidates = await service.listProcedureCandidates(
            corpus.corpusId,
        );
        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toMatchObject({
            candidateId: expect.stringMatching(/^auto:[a-f0-9]{32}$/),
            state: "detected",
            title: "Reset a router",
            steps: [
                "Unplug the router",
                "Wait thirty seconds",
                "Plug it back in",
            ],
            citations: [
                {
                    sourceId: accepted.sourceId,
                    revisionId: accepted.revisionId,
                    locator: expect.stringMatching(/^lines /),
                },
            ],
        });
        expect(candidates[1]).toMatchObject({
            title: "Troubleshooting checklist",
            steps: ["Check the power light", "Check the network cable"],
        });
    });

    test.each([
        { enabled: false, detectCandidates: true },
        { enabled: true, detectCandidates: false },
    ])(
        "respects personal how-to detection settings %#",
        async ({ enabled, detectCandidates }) => {
            const corpus = await service.createCorpus(
                `Disabled detection ${enabled}`,
            );
            const settings = await service.updatePersonalHowToSettings(
                corpus.corpusId,
                {
                    expectedRevision: 0,
                    enabled,
                    detectCandidates,
                },
            );
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceType: "text",
                    title: "Text guide",
                    text: [
                        "How to prepare tea:",
                        "1) Heat water",
                        "2) Steep the tea",
                    ].join("\n"),
                },
            });
            await waitForTerminalJob(service, accepted.jobId);

            expect(
                await service.listProcedureCandidates(corpus.corpusId),
            ).toEqual([]);
            expect(
                await service.getPersonalHowToSettings(corpus.corpusId),
            ).toEqual(settings);
        },
    );

    test("does not duplicate detected candidates after re-import or restart", async () => {
        const corpus = await service.createCorpus("Idempotent detection");
        const request = {
            corpusId: corpus.corpusId,
            source: {
                sourceId: "tea-guide",
                sourceType: "text" as const,
                title: "Tea guide",
                text: [
                    "How to prepare tea",
                    "1. Heat water",
                    "2. Steep the tea",
                ].join("\n"),
            },
        };
        const first = await service.ingestDocument(request);
        await waitForTerminalJob(service, first.jobId);
        const firstCandidates = await service.listProcedureCandidates(
            corpus.corpusId,
        );
        await service.close();
        service = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
        });

        const replay = await service.ingestDocument(request);
        expect((await waitForTerminalJob(service, replay.jobId)).state).toBe(
            "complete",
        );
        expect(await service.listProcedureCandidates(corpus.corpusId)).toEqual(
            firstCandidates,
        );
    });

    test("reports extraction failure without rolling back the source", async () => {
        const corpus = await service.createCorpus("Extraction failure");
        const howToDirectory = path.join(
            rootDirectory,
            corpus.corpusId,
            "personal-how-to",
        );
        await mkdir(howToDirectory, { recursive: true });
        await writeFile(path.join(howToDirectory, "index.json"), "{broken");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "committed-guide",
                sourceType: "markdown",
                title: "Committed guide",
                markdown: [
                    "# Deploy safely",
                    "1. Run tests",
                    "2. Deploy the build",
                ].join("\n"),
            },
        });

        const job = await waitForTerminalJob(service, accepted.jobId);
        expect(job.state).toBe("complete");
        expect(job.warnings).toEqual(
            expect.arrayContaining([
                expect.stringContaining(
                    "Procedure candidate extraction failed:",
                ),
            ]),
        );
        await expect(
            service.getSource(corpus.corpusId, "committed-guide"),
        ).resolves.toMatchObject({
            activeRevisionId: accepted.revisionId,
        });
        expect(index.documents).toHaveLength(1);
    });

    test("automatic detection does not modify authored procedures", async () => {
        const corpus = await service.createCorpus("Authored procedures");
        const authored = await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "authored",
            document: {
                title: "Authored procedure",
                steps: ["Keep this", "Unchanged"],
                citations: [],
            },
        });
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceType: "markdown",
                title: "Imported guide",
                markdown: [
                    "# How to import",
                    "1. Select a file",
                    "2. Confirm the import",
                ].join("\n"),
            },
        });
        await waitForTerminalJob(service, accepted.jobId);

        expect(await service.getProcedure(corpus.corpusId, "authored")).toEqual(
            authored,
        );
        expect(
            await service.listProcedureCandidates(corpus.corpusId),
        ).toHaveLength(1);
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

    test("stores candidates and immutable searchable procedure versions", async () => {
        const corpus = await service.createCorpus("How-to");
        const candidate = await service.createProcedureCandidate({
            corpusId: corpus.corpusId,
            candidateId: "publish",
            title: "Publish a package",
            summary: "Release to the registry.",
            steps: ["Build the package", "Publish the package"],
            citations: [],
            additionalSections: [
                { heading: "Notes", content: "Use a clean checkout." },
            ],
        });
        const saved = await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "publish-procedure",
            candidateId: candidate.candidateId,
            expectedVersion: 0,
        });

        expect(saved.state).toBe("saved");
        expect(saved.canonicalJson.endsWith("\n")).toBe(true);
        expect(saved.markdown).toContain("## Notes");
        expect(
            await service.listProcedureCandidates(corpus.corpusId, ["saved"]),
        ).toHaveLength(1);
        const matches = await service.searchProcedures({
            corpusId: corpus.corpusId,
            query: "registry",
        });
        expect(matches.map((match) => match.procedure.procedureId)).toEqual([
            "publish-procedure",
        ]);

        const archived = await service.archiveProcedure(
            corpus.corpusId,
            "publish-procedure",
            1,
        );
        expect(archived).toMatchObject({
            version: 2,
            previousVersion: 1,
            state: "archived",
        });
        expect(
            await service.getProcedure(corpus.corpusId, "publish-procedure", 1),
        ).toMatchObject({ version: 1, state: "saved" });
    });

    test("rejects invalid saves and detects projection corruption", async () => {
        const corpus = await service.createCorpus("How-to");
        await expect(
            service.saveProcedure({
                corpusId: corpus.corpusId,
                procedureId: "broken",
                markdown: "# Missing sections\n",
            }),
        ).rejects.toThrow("requires Steps and Sources sections");
        expect(
            await service.listProcedures({ corpusId: corpus.corpusId }),
        ).toEqual([]);

        await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "valid",
            document: {
                title: "Valid",
                steps: ["Do the thing"],
                citations: [],
            },
        });
        await writeFile(
            path.join(
                rootDirectory,
                corpus.corpusId,
                "personal-how-to",
                "procedures",
                "valid",
                "versions",
                "00000001",
                "procedure.md",
            ),
            "# Corrupt\n",
        );
        await expect(
            service.getProcedure(corpus.corpusId, "valid"),
        ).rejects.toThrow("is corrupt");
    });

    test("persists settings, candidates, and procedures across restart", async () => {
        const corpus = await service.createCorpus("How-to");
        await service.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: 0,
            detectCandidates: false,
        });
        await service.createProcedureCandidate({
            corpusId: corpus.corpusId,
            candidateId: "restart-candidate",
            title: "Restart",
            steps: ["Stop", "Start"],
            citations: [],
        });
        await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "restart-procedure",
            expectedVersion: 0,
            document: {
                title: "Restart",
                steps: ["Stop", "Start"],
                citations: [],
            },
        });
        await service.close();
        const settingsPath = path.join(
            rootDirectory,
            corpus.corpusId,
            "personal-how-to",
            "settings.json",
        );
        await rename(settingsPath, `${settingsPath}.interrupted.bak`);
        service = new FileMemoryService(rootDirectory, {
            indexFactory: () => new FakeCorpusIndex(),
        });

        expect(
            (await service.getPersonalHowToSettings(corpus.corpusId))
                .detectCandidates,
        ).toBe(false);
        expect(
            await service.getProcedureCandidate(
                corpus.corpusId,
                "restart-candidate",
            ),
        ).toMatchObject({ state: "detected" });
        expect(
            await service.getProcedure(corpus.corpusId, "restart-procedure"),
        ).toMatchObject({ version: 1, state: "saved" });
    });

    test("marks dependent procedures stale without changing old versions", async () => {
        const corpus = await service.createCorpus("How-to");
        const accepted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "source",
                sourceType: "markdown",
                title: "Source",
                markdown: "First revision",
            },
        });
        expect((await waitForTerminalJob(service, accepted.jobId)).state).toBe(
            "complete",
        );
        await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "dependent",
            document: {
                title: "Dependent",
                steps: ["Follow the source"],
                citations: [
                    {
                        sourceId: accepted.sourceId,
                        revisionId: accepted.revisionId,
                    },
                ],
            },
        });

        const replacement = await service.replaceSource({
            corpusId: corpus.corpusId,
            sourceId: accepted.sourceId,
            expectedActiveRevisionId: accepted.revisionId,
            source: {
                sourceType: "markdown",
                title: "Source",
                markdown: "Second revision",
            },
        });
        expect(
            (await waitForTerminalJob(service, replacement.jobId)).state,
        ).toBe("complete");

        expect(
            await service.getProcedure(corpus.corpusId, "dependent"),
        ).toMatchObject({ version: 2, previousVersion: 1, state: "stale" });
        expect(
            await service.getProcedure(corpus.corpusId, "dependent", 1),
        ).toMatchObject({ version: 1, state: "saved" });

        await service.saveProcedure({
            corpusId: corpus.corpusId,
            procedureId: "dependent",
            expectedVersion: 2,
            document: {
                title: "Dependent",
                steps: ["Follow the revised source"],
                citations: [
                    {
                        sourceId: replacement.sourceId,
                        revisionId: replacement.revisionId,
                    },
                ],
            },
        });
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            replacement.sourceId,
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: replacement.sourceId,
            confirmationToken: preview.confirmationToken,
        });

        expect(
            await service.getProcedure(corpus.corpusId, "dependent"),
        ).toMatchObject({ version: 4, previousVersion: 3, state: "stale" });
        expect(
            await service.getProcedure(corpus.corpusId, "dependent", 3),
        ).toMatchObject({ version: 3, state: "saved" });
    });
});
