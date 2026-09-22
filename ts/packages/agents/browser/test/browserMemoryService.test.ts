// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryServiceClient } from "@typeagent/memory-client";
import type { MemorySource } from "@typeagent/memory-service";
import {
    BrowserMemoryService,
    getBrowserMemoryService,
} from "../src/agent/browserMemoryService.mjs";

function createClient(): jest.Mocked<MemoryServiceClient> {
    return {
        createCorpus: jest.fn(async (name, description) => ({
            corpusId: "browser-corpus",
            name,
            description,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            status: "ready",
            documentCount: 0,
        })),
        listCorpora: jest.fn(async () => []),
        getCorpus: jest.fn(),
        clearCorpus: jest.fn(async () => 0),
        listSources: jest.fn(async () => []),
        listSourcesPage: jest.fn(async () => ({ items: [], total: 0 })),
        getSource: jest.fn(async (corpusId, sourceId) => ({
            sourceId,
            corpusId,
            sourceType: "web",
            title: "Captured page",
            canonicalUri: "https://example.test/page",
            activeRevisionId: "revision-1",
            revisions: [
                {
                    revisionId: "revision-1",
                    sourceId,
                    contentHash: "hash",
                    mimeType: "text/markdown",
                    pipelineVersion: "1",
                    state: "ready",
                },
            ],
        })),
        getSourceContent: jest.fn(),
        getSourceKnowledge: jest.fn(async () => ({
            entities: [],
            topics: [],
            relationships: [],
        })),
        ingestDocument: jest.fn(async () => ({
            jobId: "job-1",
            sourceId: "source-1",
            revisionId: "revision-1",
            state: "accepted",
            statusUri: "typeagent-memory://jobs/job-1",
        })),
        replaceSource: jest.fn(),
        previewForgetSource: jest.fn(),
        forgetSource: jest.fn(),
        reindexCorpus: jest.fn(),
        reindexSource: jest.fn(),
        getJob: jest.fn(async () => ({
            jobId: "job-1",
            corpusId: "browser-corpus",
            sourceId: "source-1",
            revisionId: "revision-1",
            state: "complete",
            progress: { completed: 1, total: 1 },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            warnings: [],
        })),
        cancelJob: jest.fn(),
        listJobs: jest.fn(async () => ({ items: [], total: 0 })),
        appendEvent: jest.fn(async (request) => ({
            event: {
                eventId: "event-1",
                corpusId: request.corpusId,
                idempotencyKey: request.idempotencyKey,
                producer: request.producer,
                eventType: request.eventType,
                sourceKind: request.sourceKind,
                observedAt: request.observedAt ?? "2026-01-01T00:00:00.000Z",
                eventTime: request.eventTime ?? "2026-01-01T00:00:00.000Z",
                createdAt: "2026-01-01T00:00:00.000Z",
                content: request.content,
                linkedSourceIds: request.linkedSourceIds,
                metadata: request.metadata,
            },
            replayed: false,
        })),
        getEvent: jest.fn(),
        listEvents: jest.fn(async () => ({ items: [], total: 0 })),
        searchEvents: jest.fn(async (request) => ({
            query: request.query,
            matches: [],
        })),
        forgetEvents: jest.fn(async (request) => ({
            corpusId: request.corpusId,
            deletedEventCount: request.eventIds?.length ?? 0,
            deletedSourceCount: 0,
            retainedLinkedSourceIds: [],
            indexVersion: "test",
        })),
        search: jest.fn(async (request) => ({
            query: request.query,
            matches: [],
            warnings: [],
            capabilitiesUsed: ["structured-search"],
            indexVersion: "test",
        })),
        answer: jest.fn(async (request) => ({
            question: request.question,
            answer: "No supporting memory evidence was found.",
            citations: [],
            grounded: true,
            indexVersion: "test",
            warnings: [],
        })),
        getKnowledgeGraph: jest.fn(async () => ({
            entities: [],
            topics: [],
            relationships: [],
        })),
        getCapabilities: jest.fn(async () => ({
            features: {
                knowledgeExtraction: true,
                queryTranslation: true,
                vectorSimilarity: true,
                structuredSearch: true,
                exactSearch: true,
                management: true,
                groundedAnswer: false,
            },
            warnings: [],
        })),
        waitForJob: jest.fn(async () => ({
            jobId: "job-1",
            corpusId: "browser-corpus",
            sourceId: "source-1",
            revisionId: "revision-1",
            state: "complete",
            progress: { completed: 1, total: 1 },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            warnings: [],
        })),
        close: jest.fn(),
    };
}

describe("BrowserMemoryService", () => {
    test("shares an adapter for browser sessions using the same client", () => {
        const client = createClient();

        expect(getBrowserMemoryService(client)).toBe(
            getBrowserMemoryService(client),
        );
    });

    test("reuses its corpus and assigns stable URL source IDs", async () => {
        const client = createClient();
        const service = new BrowserMemoryService(client);
        const document = {
            url: "https://example.test/private/page",
            title: "Captured page",
            markdown: "# Captured page",
        };

        await service.ingest(document, "content");
        await service.ingest(document, "content");

        expect(client.listCorpora).toHaveBeenCalledTimes(1);
        expect(client.createCorpus).toHaveBeenCalledTimes(1);
        const firstSourceId = client.ingestDocument.mock.calls[0][0].source
            .sourceId as string;
        const secondSourceId = client.ingestDocument.mock.calls[1][0].source
            .sourceId as string;
        expect(firstSourceId).toMatch(/^web:[a-f0-9]{64}$/);
        expect(secondSourceId).toBe(firstSourceId);
        expect(client.getJob).toHaveBeenCalledTimes(2);
    });

    test("forwards ingestion progress to browser callers", async () => {
        const client = createClient();
        const onProgress = jest.fn();
        client.getJob.mockResolvedValue({
            jobId: "job-1",
            corpusId: "browser-corpus",
            sourceId: "source-1",
            revisionId: "revision-1",
            state: "complete",
            progress: {
                completed: 2,
                total: 3,
                message: "Creating embeddings",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            warnings: [],
        });

        await new BrowserMemoryService(client).ingest(
            {
                url: "https://example.test/page",
                title: "Page",
                markdown: "Page content",
            },
            "content",
            { onProgress },
        );

        expect(onProgress).toHaveBeenCalledWith({
            completed: 2,
            total: 3,
            message: "Creating embeddings",
        });
        expect(onProgress).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["history", "visited"],
        ["bookmark", "bookmarked"],
        ["current-page", "captured"],
        ["file_import", "imported"],
    ] as const)(
        "records %s ingestion as a linked %s event",
        async (source, eventType) => {
            const client = createClient();

            await new BrowserMemoryService(client).ingest(
                {
                    url: `https://example.test/${source}`,
                    title: source,
                    markdown: "Same durable page content",
                    source,
                    domain: "example.test",
                    pageType: "documentation",
                    capturedAt: "2026-04-05T06:07:08.000Z",
                },
                "basic",
            );

            expect(client.appendEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType,
                    sourceKind: "web-activity",
                    eventTime: "2026-04-05T06:07:08.000Z",
                    linkedSourceIds: ["source-1"],
                    metadata: expect.objectContaining({
                        domain: "example.test",
                        pageType: "documentation",
                        source,
                    }),
                }),
            );
        },
    );

    test("keeps repeated visits as events without changing source identity", async () => {
        const client = createClient();
        const service = new BrowserMemoryService(client);
        const document = {
            url: "https://example.test/revisited",
            title: "Revisited",
            markdown: "Unchanged content",
            source: "history",
        };

        await service.ingest(
            { ...document, capturedAt: "2026-04-01T00:00:00.000Z" },
            "basic",
        );
        await service.ingest(
            {
                ...document,
                url: `${document.url}#second-section`,
                capturedAt: "2026-04-02T00:00:00.000Z",
            },
            "basic",
        );

        expect(client.ingestDocument).toHaveBeenCalledTimes(2);
        expect(
            client.ingestDocument.mock.calls.map(
                ([request]) => request.source.sourceId,
            ),
        ).toEqual([
            expect.stringMatching(/^web:/),
            expect.stringMatching(/^web:/),
        ]);
        expect(client.ingestDocument.mock.calls[0][0].source.sourceId).toBe(
            client.ingestDocument.mock.calls[1][0].source.sourceId,
        );
        expect(client.appendEvent).toHaveBeenCalledTimes(2);
        expect(
            client.appendEvent.mock.calls.map(
                ([request]) => request.idempotencyKey,
            ),
        ).toEqual([
            expect.stringContaining("2026-04-01"),
            expect.stringContaining("2026-04-02"),
        ]);
    });

    test("reports terminal progress before returning ingestion knowledge", async () => {
        const client = createClient();
        const onProgress = jest.fn();

        await new BrowserMemoryService(client).ingest(
            {
                url: "https://example.test/terminal",
                title: "Terminal progress",
                markdown: "Original content",
            },
            "content",
            { onProgress },
        );

        expect(onProgress).toHaveBeenLastCalledWith({
            completed: 1,
            total: 1,
        });
        expect(client.getSourceKnowledge).toHaveBeenCalledTimes(1);
    });

    test("cancels an accepted ingestion job when already aborted", async () => {
        const client = createClient();
        const controller = new AbortController();
        const reason = new Error("Import cancelled");
        controller.abort(reason);

        await expect(
            new BrowserMemoryService(client).ingest(
                {
                    url: "https://example.test/cancelled",
                    title: "Cancelled import",
                    markdown: "Original content",
                },
                "content",
                { signal: controller.signal },
            ),
        ).rejects.toBe(reason);

        expect(client.cancelJob).toHaveBeenCalledWith("job-1");
        expect(client.getSourceKnowledge).not.toHaveBeenCalled();
    });

    test("forwards model-free mode and chunk policy to durable ingestion", async () => {
        const client = createClient();

        await new BrowserMemoryService(client).ingest(
            {
                url: "https://example.test/basic",
                title: "Basic page",
                markdown: "Exact-search content",
            },
            "basic",
            { maxCharsPerChunk: 512 },
        );

        expect(client.ingestDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                pipeline: {
                    mode: "basic",
                    updatePolicy: "skipIfUnchanged",
                    maxCharsPerChunk: 512,
                },
            }),
        );
    });

    test("reads source metadata and graph data from the browser corpus", async () => {
        const client = createClient();
        const service = new BrowserMemoryService(client);

        await service.getSource("https://example.test/page");
        await service.getKnowledgeGraph();

        expect(client.getSource).toHaveBeenCalledWith(
            "browser-corpus",
            expect.stringMatching(/^web:[a-f0-9]{64}$/),
        );
        expect(client.getKnowledgeGraph).toHaveBeenCalledWith("browser-corpus");
    });

    test("returns durable source-scoped knowledge after ingestion", async () => {
        const client = createClient();
        const sourceId = expect.stringMatching(/^web:[a-f0-9]{64}$/);
        client.getSourceKnowledge.mockImplementation(
            async (corpusId, requestedSourceId) => {
                const ingestedSourceId = client.ingestDocument.mock.calls[0][0]
                    .source.sourceId as string;
                expect(corpusId).toBe("browser-corpus");
                expect(requestedSourceId).toBe(ingestedSourceId);
                return {
                    entities: [
                        {
                            name: "TypeAgent",
                            types: ["project"],
                            mentionCount: 1,
                            sourceIds: [ingestedSourceId],
                        },
                    ],
                    topics: [],
                    relationships: [],
                };
            },
        );

        const result = await new BrowserMemoryService(client).ingest(
            {
                url: "https://example.test/page",
                title: "Page",
                markdown: "TypeAgent memory",
            },
            "content",
        );

        expect(client.ingestDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                source: expect.objectContaining({ sourceId }),
            }),
        );
        expect(result.entities.map((entity) => entity.name)).toEqual([
            "TypeAgent",
        ]);
    });

    test("clears the durable browser corpus", async () => {
        const client = createClient();
        client.clearCorpus.mockResolvedValue(3);

        await expect(new BrowserMemoryService(client).clear()).resolves.toBe(3);

        expect(client.clearCorpus).toHaveBeenCalledWith("browser-corpus");
    });

    test("translates URL, metadata, and date filters to source IDs", async () => {
        const client = createClient();
        const matchingSource: MemorySource = {
            sourceId: "matching",
            corpusId: "browser-corpus",
            sourceType: "web",
            canonicalUri: "https://example.test/page",
            title: "Matching page",
            metadata: {
                domain: "example.test",
                pageType: "documentation",
                source: "bookmark",
            },
            activeRevisionId: "revision-1",
            revisions: [
                {
                    revisionId: "revision-1",
                    sourceId: "matching",
                    contentHash: "hash",
                    mimeType: "text/markdown",
                    capturedAt: "2026-02-01T00:00:00.000Z",
                    pipelineVersion: "1",
                    state: "ready",
                },
            ],
        };
        client.listCorpora.mockResolvedValue([
            {
                corpusId: "browser-corpus",
                name: "TypeAgent Browser Memory",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                status: "ready",
                documentCount: 1,
            },
        ]);
        client.listSources.mockResolvedValue([
            matchingSource,
            {
                ...matchingSource,
                sourceId: "wrong-url",
                canonicalUri: "https://example.test/other",
            },
        ]);
        client.listEvents.mockResolvedValue({
            items: [
                {
                    eventId: "matching-event",
                    corpusId: "browser-corpus",
                    idempotencyKey: "matching",
                    producer: {
                        producerId: "typeagent-browser",
                        producerType: "browser",
                    },
                    eventType: "bookmarked",
                    sourceKind: "web-activity",
                    observedAt: "2026-02-01T00:00:00.000Z",
                    eventTime: "2026-02-01T00:00:00.000Z",
                    createdAt: "2026-02-01T00:00:00.000Z",
                    linkedSourceIds: ["matching"],
                    metadata: {
                        domain: "example.test",
                        pageType: "documentation",
                        source: "bookmark",
                    },
                },
            ],
            total: 1,
        });

        await new BrowserMemoryService(client).search({
            query: "design",
            url: "https://example.test/page",
            domain: "example.test",
            pageType: "documentation",
            source: "bookmark",
            eventType: "bookmarked",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-03-01T00:00:00.000Z",
        });

        expect(client.search).toHaveBeenCalledWith(
            expect.objectContaining({ sourceIds: ["matching"] }),
        );
        expect(client.listEvents).toHaveBeenCalledWith(
            expect.objectContaining({ eventTypes: ["bookmarked"] }),
        );
    });

    test("returns latest encounter provenance with page content matches", async () => {
        const client = createClient();
        const source = await client.getSource("browser-corpus", "source-1");
        client.listSources.mockResolvedValue([source!]);
        client.search.mockResolvedValue({
            query: "captured",
            matches: [
                {
                    sourceId: "source-1",
                    revisionId: "revision-1",
                    score: 1,
                    snippet: "Captured page",
                },
            ],
            warnings: [],
            capabilitiesUsed: ["exact-search"],
            indexVersion: "test",
        });
        client.listEvents.mockResolvedValue({
            items: [
                {
                    eventId: "event-encounter",
                    corpusId: "browser-corpus",
                    idempotencyKey: "encounter",
                    producer: {
                        producerId: "typeagent-browser",
                        producerType: "browser",
                    },
                    eventType: "bookmarked",
                    sourceKind: "web-activity",
                    observedAt: "2026-04-04T00:00:00.000Z",
                    eventTime: "2026-04-03T00:00:00.000Z",
                    createdAt: "2026-04-04T00:00:00.000Z",
                    linkedSourceIds: ["source-1"],
                    metadata: { source: "bookmark" },
                },
            ],
            total: 1,
        });

        const matches = await new BrowserMemoryService(client).search({
            query: "captured",
        });

        expect(matches[0].evidence.snippet).toBe("Captured page");
        expect(matches[0].latestActivity).toEqual(
            expect.objectContaining({
                eventType: "bookmarked",
                eventTime: "2026-04-03T00:00:00.000Z",
            }),
        );
    });

    test("filters the activity timeline and forgets events without sources", async () => {
        const client = createClient();
        client.listEvents.mockResolvedValue({
            items: [
                {
                    eventId: "matching-event",
                    corpusId: "browser-corpus",
                    idempotencyKey: "one",
                    producer: {
                        producerId: "typeagent-browser",
                        producerType: "browser",
                    },
                    eventType: "visited",
                    sourceKind: "web-activity",
                    observedAt: "2026-04-02T00:00:00.000Z",
                    eventTime: "2026-04-01T00:00:00.000Z",
                    createdAt: "2026-04-02T00:00:00.000Z",
                    linkedSourceIds: ["source-1"],
                    metadata: {
                        domain: "example.test",
                        source: "history",
                        pageType: "documentation",
                    },
                },
                {
                    eventId: "other-event",
                    corpusId: "browser-corpus",
                    idempotencyKey: "two",
                    producer: {
                        producerId: "typeagent-browser",
                        producerType: "browser",
                    },
                    eventType: "captured",
                    sourceKind: "web-activity",
                    observedAt: "2026-04-03T00:00:00.000Z",
                    eventTime: "2026-04-03T00:00:00.000Z",
                    createdAt: "2026-04-03T00:00:00.000Z",
                    metadata: { domain: "other.test" },
                },
            ],
            total: 2,
        });
        const service = new BrowserMemoryService(client);

        await expect(
            service.listActivity({
                domains: ["example.test"],
                sources: ["history"],
                pageTypes: ["documentation"],
            }),
        ).resolves.toEqual({
            items: [expect.objectContaining({ eventId: "matching-event" })],
            total: 1,
        });
        await service.forgetActivity({
            domains: ["example.test"],
            dateFrom: "2026-04-01T00:00:00.000Z",
            dateTo: "2026-04-02T23:59:59.999Z",
        });

        expect(client.forgetEvents).toHaveBeenCalledWith({
            corpusId: "browser-corpus",
            eventIds: ["matching-event"],
            forgetLinkedSources: false,
        });
    });
});
