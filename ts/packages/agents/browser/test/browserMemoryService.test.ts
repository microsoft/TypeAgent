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
        client.getSourceKnowledge.mockImplementation(async () => {
            const ingestedSourceId = client.ingestDocument.mock.calls[0][0]
                .source.sourceId as string;
            return {
                entities: [
                    {
                        name: "TypeAgent",
                        types: ["project"],
                        mentionCount: 1,
                        sourceIds: [ingestedSourceId],
                    },
                    {
                        name: "Unrelated",
                        types: ["project"],
                        mentionCount: 1,
                        sourceIds: ["another-source"],
                    },
                ],
                topics: [],
                relationships: [],
            };
        });

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

        await new BrowserMemoryService(client).search({
            query: "design",
            url: "https://example.test/page",
            domain: "example.test",
            pageType: "documentation",
            source: "bookmark",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-03-01T00:00:00.000Z",
        });

        expect(client.search).toHaveBeenCalledWith(
            expect.objectContaining({ sourceIds: ["matching"] }),
        );
    });
});
