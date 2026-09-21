// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
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
    public blockNextRebuild = false;
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

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        return structuredClone(this.graph);
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
        index.graph.entities.push({
            name: "TypeAgent",
            types: ["software"],
            mentionCount: 2,
            sourceIds: ["design-doc"],
        });

        await expect(
            service.getKnowledgeGraph(corpus.corpusId),
        ).resolves.toEqual(index.graph);
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
});
