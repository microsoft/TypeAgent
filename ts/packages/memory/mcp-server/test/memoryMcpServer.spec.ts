// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
    McpMemoryServiceClient,
    memoryToolNames,
} from "@typeagent/memory-client";
import type {
    DocumentIngestRequest,
    DocumentIngestResult,
    IngestionJobStatus,
    MemoryCorpus,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    SourceReplaceRequest,
} from "@typeagent/memory-service";
import { MemoryMcpServer } from "../src/memoryMcpServer.js";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

class PairedTransport implements Transport {
    public peer?: PairedTransport;
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    public async start(): Promise<void> {}

    public async send(message: JSONRPCMessage): Promise<void> {
        queueMicrotask(() => this.peer?.onmessage?.(message));
    }

    public async close(): Promise<void> {
        this.onclose?.();
    }
}

function createTransportPair(): [PairedTransport, PairedTransport] {
    const client = new PairedTransport();
    const server = new PairedTransport();
    client.peer = server;
    server.peer = client;
    return [client, server];
}

class FakeMemoryService implements MemoryService {
    public readonly corpus: MemoryCorpus = {
        corpusId: "corpus-1",
        name: "Test corpus",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "ready",
        documentCount: 1,
    };
    public readonly job: IngestionJobStatus = {
        jobId: "job-1",
        corpusId: this.corpus.corpusId,
        sourceId: "source-1",
        revisionId: "revision-1",
        state: "complete",
        progress: { completed: 1, total: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
    };
    public readonly source: MemorySource = {
        sourceId: "source-1",
        corpusId: this.corpus.corpusId,
        sourceType: "markdown",
        title: "Test source",
        activeRevisionId: "revision-1",
        revisions: [
            {
                revisionId: "revision-1",
                sourceId: "source-1",
                contentHash: "hash",
                mimeType: "text/markdown",
                indexedAt: "2026-01-01T00:00:00.000Z",
                pipelineVersion: "1",
                state: "ready",
            },
        ],
    };

    public async createCorpus(
        name: string,
        description?: string,
    ): Promise<MemoryCorpus> {
        return {
            ...this.corpus,
            name,
            ...(description === undefined ? {} : { description }),
        };
    }

    public async listCorpora(): Promise<MemoryCorpus[]> {
        return [this.corpus];
    }

    public async getCorpus() {
        return {
            ...this.corpus,
            sourceCount: 1,
            revisionCount: 1,
            readyRevisionCount: 1,
            failedRevisionCount: 0,
            activeJobCount: 0,
            indexVersion: "fixture",
        };
    }

    public async clearCorpus(): Promise<number> {
        return 1;
    }

    public async listSources(): Promise<MemorySource[]> {
        return [this.source];
    }

    public async listSourcesPage() {
        return { items: [this.source], total: 1 };
    }

    public async getSource(): Promise<MemorySource> {
        return this.source;
    }

    public async getSourceContent() {
        return {
            corpusId: this.corpus.corpusId,
            sourceId: this.source.sourceId,
            revisionId: this.source.activeRevisionId,
            mimeType: "text/markdown",
            offset: 0,
            content: "fixture",
            totalChars: 7,
            truncated: false,
        };
    }

    public async getSourceKnowledge() {
        return this.getKnowledgeGraph();
    }

    public async ingestDocument(
        _request: DocumentIngestRequest,
        _signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        return {
            jobId: this.job.jobId,
            sourceId: this.job.sourceId,
            revisionId: this.job.revisionId,
            state: "accepted",
            statusUri: `typeagent-memory://jobs/${this.job.jobId}`,
        };
    }

    public async replaceSource(
        _request: SourceReplaceRequest,
        _signal?: AbortSignal,
    ) {
        return {
            jobId: this.job.jobId,
            sourceId: this.job.sourceId,
            revisionId: this.job.revisionId,
            state: "accepted" as const,
            statusUri: `typeagent-memory://jobs/${this.job.jobId}`,
        };
    }

    public async previewForgetSource() {
        return {
            corpusId: this.corpus.corpusId,
            sourceId: this.source.sourceId,
            activeRevisionId: this.source.activeRevisionId,
            revisionCount: 1,
            derivedEntityCount: 1,
            derivedTopicCount: 0,
            derivedRelationshipCount: 0,
            confirmationToken: "confirmation-1",
            expiresAt: "2026-01-01T00:10:00.000Z",
        };
    }

    public async forgetSource() {
        return {
            corpusId: this.corpus.corpusId,
            sourceId: this.source.sourceId,
            deletedRevisionCount: 1,
            indexVersion: "fixture",
        };
    }

    public async reindexCorpus() {
        return {
            corpusId: this.corpus.corpusId,
            sourceCount: 1,
            indexVersion: "fixture",
        };
    }

    public async reindexSource() {
        return {
            corpusId: this.corpus.corpusId,
            sourceId: this.source.sourceId,
            sourceCount: 1,
            indexVersion: "fixture",
        };
    }

    public async getJob(jobId: string) {
        return jobId === this.job.jobId ? this.job : undefined;
    }

    public async listJobs() {
        return { items: [this.job], total: 1 };
    }

    public async cancelJob(jobId: string) {
        return this.getJob(jobId);
    }

    public async search(
        request: MemorySearchRequest,
    ): Promise<MemorySearchResult> {
        return {
            query: request.query,
            matches: [],
            warnings: [],
            capabilitiesUsed: ["structured-search"],
            indexVersion: "fixture",
        };
    }

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        return {
            entities: [
                {
                    name: "TypeAgent",
                    types: ["software"],
                    mentionCount: 1,
                    sourceIds: [this.source.sourceId],
                },
            ],
            topics: [],
            relationships: [],
        };
    }

    public async getCapabilities(): Promise<MemoryServiceCapabilities> {
        return {
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
        };
    }
}

class WaitingMemoryService extends FakeMemoryService {
    private markStarted: (() => void) | undefined;
    public readonly waitStarted = new Promise<void>((resolve) => {
        this.markStarted = resolve;
    });

    public override async getJob(
        jobId: string,
    ): Promise<IngestionJobStatus | undefined> {
        this.markStarted?.();
        return jobId === this.job.jobId
            ? { ...this.job, state: "building-indexes" }
            : undefined;
    }
}

describe("MemoryMcpServer", () => {
    let server: MemoryMcpServer;
    let client: Client;

    beforeEach(async () => {
        const [clientTransport, serverTransport] = createTransportPair();
        server = new MemoryMcpServer(new FakeMemoryService());
        client = new Client(
            { name: "memory-protocol-test", version: "0.0.1" },
            { capabilities: {} },
        );
        await Promise.all([
            server.start(serverTransport),
            client.connect(clientTransport),
        ]);
    });

    afterEach(async () => {
        await Promise.all([client.close(), server.close()]);
    });

    test("advertises the complete memory tool surface", async () => {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
            Object.values(memoryToolNames).sort(),
        );
    });

    test("returns validated structured tool results", async () => {
        const response = await client.callTool({
            name: memoryToolNames.corpusCreate,
            arguments: { name: "Protocol corpus" },
        });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toEqual({
            result: expect.objectContaining({
                corpusId: "corpus-1",
                name: "Protocol corpus",
            }),
        });
    });

    test("rejects invalid tool arguments before service dispatch", async () => {
        const response = await client.callTool({
            name: memoryToolNames.search,
            arguments: { corpusId: "invalid id", query: "test" },
        });
        expect(response.isError).toBe(true);
    });

    test("reads durable job and source resources", async () => {
        const job = await client.readResource({
            uri: "typeagent-memory://jobs/job-1",
        });
        const source = await client.readResource({
            uri: "typeagent-memory://corpora/corpus-1/sources/source-1",
        });
        const jobContent = job.contents[0];
        const sourceContent = source.contents[0];
        if (!("text" in jobContent) || !("text" in sourceContent)) {
            throw new Error("Expected JSON text resources");
        }
        expect(JSON.parse(jobContent.text)).toMatchObject({
            jobId: "job-1",
            state: "complete",
        });
        expect(JSON.parse(sourceContent.text)).toMatchObject({
            sourceId: "source-1",
            activeRevisionId: "revision-1",
        });
    });
});

describe("MemoryServiceHost", () => {
    test("accepts initialize and initialized HTTP messages", async () => {
        const host = await MemoryServiceHost.start(new FakeMemoryService());
        try {
            const headers = {
                accept: "application/json, text/event-stream",
                authorization: `Bearer ${host.bearerToken}`,
                "content-type": "application/json",
            };
            const initialize = await fetch(host.endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-03-26",
                        capabilities: {},
                        clientInfo: { name: "raw-test", version: "0.0.1" },
                    },
                }),
            });
            expect(initialize.status).toBe(200);
            await initialize.text();
            const initialized = await fetch(host.endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "notifications/initialized",
                }),
            });
            expect({
                status: initialized.status,
                body: await initialized.text(),
            }).toEqual({ status: 202, body: "" });
            const tools = await fetch(host.endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/list",
                    params: {},
                }),
            });
            const toolsBody = await tools.text();
            expect({ status: tools.status, body: toolsBody }).toEqual({
                status: 200,
                body: expect.stringContaining(memoryToolNames.search),
            });
        } finally {
            await host.close();
        }
    });

    test("serves the typed client over authenticated Streamable HTTP", async () => {
        const errors: Error[] = [];
        const host = await MemoryServiceHost.start(new FakeMemoryService(), {
            onError: (error) => errors.push(error),
        });
        let client: McpMemoryServiceClient;
        try {
            client = await McpMemoryServiceClient.create({
                kind: "http",
                url: host.endpoint,
                headers: { authorization: `Bearer ${host.bearerToken}` },
            });
        } catch (error) {
            await host.close();
            const httpError = error as {
                status?: number;
                statusText?: string;
                text?: string;
            };
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}; status=${httpError.status} ${httpError.statusText}; body=${httpError.text}; host errors: ${errors.map((item) => item.stack ?? item.message).join("\n")}`,
            );
        }
        try {
            const progress: number[] = [];
            expect(await client.listCorpora()).toEqual([
                expect.objectContaining({ corpusId: "corpus-1" }),
            ]);
            expect(await client.getCorpus("corpus-1")).toMatchObject({
                sourceCount: 1,
                revisionCount: 1,
            });
            expect(
                await client.listSourcesPage({
                    corpusId: "corpus-1",
                    pageSize: 1,
                }),
            ).toMatchObject({
                total: 1,
                items: [{ sourceId: "source-1" }],
            });
            expect(
                await client.getSourceContent({
                    corpusId: "corpus-1",
                    sourceId: "source-1",
                    maxChars: 10,
                }),
            ).toMatchObject({ content: "fixture", truncated: false });
            expect(
                await client.listJobs({
                    corpusId: "corpus-1",
                    states: ["complete"],
                }),
            ).toMatchObject({
                total: 1,
                items: [{ jobId: "job-1" }],
            });
            expect(
                await client.waitForJob("job-1", {
                    onProgress: (update) => progress.push(update.completed),
                }),
            ).toMatchObject({ jobId: "job-1", state: "complete" });
            expect(progress).toEqual([1]);
            expect(await client.getKnowledgeGraph("corpus-1")).toEqual({
                entities: [
                    {
                        name: "TypeAgent",
                        types: ["software"],
                        mentionCount: 1,
                        sourceIds: ["source-1"],
                    },
                ],
                topics: [],
                relationships: [],
            });
            expect(await client.getCapabilities()).toMatchObject({
                features: {
                    management: true,
                    groundedAnswer: false,
                },
            });
            expect(await (await fetch(host.healthEndpoint)).json()).toEqual({
                status: "ready",
            });
            expect(errors).toEqual([]);
        } finally {
            await client.close();
            await host.close();
            await host.close();
        }
    });

    test("rejects unauthenticated MCP requests", async () => {
        const host = await MemoryServiceHost.start(new FakeMemoryService());
        try {
            const response = await fetch(host.endpoint, { method: "POST" });
            expect(response.status).toBe(401);
        } finally {
            await host.close();
        }
    });

    test("closes while an HTTP job wait is active", async () => {
        const service = new WaitingMemoryService();
        const host = await MemoryServiceHost.start(service);
        const client = await McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { authorization: `Bearer ${host.bearerToken}` },
        });
        const wait = client.waitForJob("job-1").catch(() => undefined);
        await service.waitStarted;

        await expect(host.close()).resolves.toBeUndefined();
        await wait;
        await client.close().catch(() => undefined);
    });
});
