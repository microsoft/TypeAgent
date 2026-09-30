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
    MemoryEvent,
    MemoryEventAppendRequest,
    MemoryAnswerRequest,
    MemoryAnswerResult,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    PersonalHowToService,
    PersonalHowToSettings,
    PersonalHowToSettingsUpdate,
    ProcedureCandidate,
    ProcedureCandidateCreateRequest,
    ProcedureListRequest,
    ProcedureSaveRequest,
    ProcedureSearchRequest,
    ProcedureVersion,
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

class FakeMemoryService implements MemoryService, PersonalHowToService {
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
    public readonly event: MemoryEvent = {
        eventId: "event-1",
        corpusId: this.corpus.corpusId,
        idempotencyKey: "event-key-1",
        producer: {
            producerId: "test-producer",
            producerType: "test",
        },
        eventType: "conversation-turn",
        sourceKind: "conversation",
        observedAt: "2026-01-01T00:00:00.000Z",
        eventTime: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        content: "Remember this fixture",
        conversationId: "conversation-1",
    };
    public settings: PersonalHowToSettings = {
        revision: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
        enabled: true,
        detectCandidates: true,
    };
    public readonly candidate: ProcedureCandidate = {
        candidateId: "candidate-1",
        corpusId: this.corpus.corpusId,
        state: "detected",
        title: "Publish a package",
        steps: ["Build", "Publish"],
        citations: [
            {
                sourceId: this.source.sourceId,
                revisionId: this.source.activeRevisionId,
            },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
    public readonly procedure: ProcedureVersion = {
        corpusId: this.corpus.corpusId,
        procedureId: "procedure-1",
        version: 1,
        state: "saved",
        document: {
            title: "Publish a package",
            steps: ["Build", "Publish"],
            citations: [
                {
                    sourceId: this.source.sourceId,
                    revisionId: this.source.activeRevisionId,
                },
            ],
        },
        canonicalJson: '{"title":"Publish a package"}\n',
        markdown: "# Publish a package\n",
        createdAt: "2026-01-01T00:00:00.000Z",
        jsonHash: "json-hash",
        markdownHash: "markdown-hash",
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

    public async appendEvent(request: MemoryEventAppendRequest) {
        return {
            event: {
                ...this.event,
                idempotencyKey: request.idempotencyKey,
                producer: request.producer,
                eventType: request.eventType,
                sourceKind: request.sourceKind,
                ...(request.content === undefined
                    ? {}
                    : { content: request.content }),
            },
            replayed: false,
        };
    }

    public async getEvent(_corpusId: string, eventId: string) {
        return eventId === this.event.eventId ? this.event : undefined;
    }

    public async listEvents() {
        return { items: [this.event], total: 1 };
    }

    public async searchEvents(request: { query: string }) {
        return {
            query: request.query,
            matches: [{ event: this.event, snippet: "fixture", score: 1 }],
        };
    }

    public async forgetEvents() {
        return {
            corpusId: this.corpus.corpusId,
            deletedEventCount: 1,
            deletedSourceCount: 0,
            retainedLinkedSourceIds: [],
            indexVersion: "fixture",
        };
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

    public async answer(
        request: MemoryAnswerRequest,
    ): Promise<MemoryAnswerResult> {
        return {
            question: request.question,
            answer: "No supporting memory evidence was found.",
            citations: [],
            grounded: true,
            warnings: [],
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
                groundedAnswer: true,
            },
            warnings: [],
        };
    }

    public async getPersonalHowToSettings() {
        return this.settings;
    }

    public async updatePersonalHowToSettings(
        _corpusId: string,
        update: PersonalHowToSettingsUpdate,
    ) {
        this.settings = {
            ...this.settings,
            revision: this.settings.revision + 1,
            updatedAt: "2026-01-02T00:00:00.000Z",
            ...(update.enabled === undefined
                ? {}
                : { enabled: update.enabled }),
            ...(update.detectCandidates === undefined
                ? {}
                : { detectCandidates: update.detectCandidates }),
            ...(update.preferences === undefined
                ? {}
                : { preferences: update.preferences }),
        };
        return this.settings;
    }

    public async createProcedureCandidate(
        request: ProcedureCandidateCreateRequest,
    ) {
        return {
            ...this.candidate,
            candidateId: request.candidateId ?? this.candidate.candidateId,
            state: request.state ?? this.candidate.state,
            title: request.title,
            steps: request.steps,
            citations: request.citations,
        };
    }

    public async getProcedureCandidate(_corpusId: string, candidateId: string) {
        return candidateId === this.candidate.candidateId
            ? this.candidate
            : undefined;
    }

    public async listProcedureCandidates(
        _corpusId: string,
        states?: ProcedureCandidate["state"][],
    ) {
        return states === undefined || states.includes(this.candidate.state)
            ? [this.candidate]
            : [];
    }

    public async rejectProcedureCandidate() {
        return { ...this.candidate, state: "rejected" as const };
    }

    public async saveProcedure(_request: ProcedureSaveRequest) {
        return this.procedure;
    }

    public async listProcedures(_request: ProcedureListRequest) {
        return [
            {
                corpusId: this.procedure.corpusId,
                procedureId: this.procedure.procedureId,
                title: this.procedure.document.title,
                state: this.procedure.state,
                latestVersion: this.procedure.version,
                updatedAt: this.procedure.createdAt,
            },
        ];
    }

    public async getProcedure(
        _corpusId: string,
        procedureId: string,
        _version?: number,
    ) {
        return procedureId === this.procedure.procedureId
            ? this.procedure
            : undefined;
    }

    public async searchProcedures(request: ProcedureSearchRequest) {
        return request.query.toLowerCase().includes("publish")
            ? [
                  {
                      procedure: (await this.listProcedures(request))[0],
                      version: this.procedure,
                      score: 1,
                  },
              ]
            : [];
    }

    public async archiveProcedure(
        _corpusId: string,
        _procedureId: string,
        _expectedVersion?: number,
    ) {
        return {
            ...this.procedure,
            version: 2,
            state: "archived" as const,
            previousVersion: 1,
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
            const appended = await client.appendEvent({
                corpusId: "corpus-1",
                idempotencyKey: "client-event-1",
                producer: {
                    producerId: "test-producer",
                    producerType: "test",
                },
                eventType: "conversation-turn",
                sourceKind: "conversation",
                content: "Remember this",
            });
            expect(appended).toMatchObject({
                replayed: false,
                event: {
                    eventId: "event-1",
                    idempotencyKey: "client-event-1",
                    content: "Remember this",
                },
            });
            await expect(
                client.getEvent("corpus-1", "event-1"),
            ).resolves.toMatchObject({ eventId: "event-1" });
            await expect(
                client.listEvents({
                    corpusId: "corpus-1",
                    sourceKinds: ["conversation"],
                }),
            ).resolves.toMatchObject({
                total: 1,
                items: [{ eventId: "event-1" }],
            });
            await expect(
                client.searchEvents({
                    corpusId: "corpus-1",
                    query: "fixture",
                }),
            ).resolves.toMatchObject({
                query: "fixture",
                matches: [{ event: { eventId: "event-1" } }],
            });
            await expect(
                client.forgetEvents({
                    corpusId: "corpus-1",
                    eventIds: ["event-1"],
                }),
            ).resolves.toMatchObject({
                corpusId: "corpus-1",
                deletedEventCount: 1,
            });
            expect(
                await client.answer({
                    corpusId: "corpus-1",
                    question: "What is stored?",
                }),
            ).toEqual({
                question: "What is stored?",
                answer: "No supporting memory evidence was found.",
                citations: [],
                grounded: true,
                warnings: [],
                indexVersion: "fixture",
            });
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
                    groundedAnswer: true,
                },
            });
            expect(
                await client.getPersonalHowToSettings("corpus-1"),
            ).toMatchObject({ revision: 0, detectCandidates: true });
            expect(
                await client.updatePersonalHowToSettings("corpus-1", {
                    expectedRevision: 0,
                    enabled: false,
                }),
            ).toMatchObject({ revision: 1, enabled: false });
            expect(
                await client.createProcedureCandidate({
                    corpusId: "corpus-1",
                    candidateId: "candidate-1",
                    state: "draft",
                    title: "Publish a package",
                    steps: ["Build", "Publish"],
                    citations: [
                        {
                            sourceId: "source-1",
                            revisionId: "revision-1",
                        },
                    ],
                }),
            ).toMatchObject({ candidateId: "candidate-1", state: "draft" });
            await expect(
                client.getProcedureCandidate("corpus-1", "candidate-1"),
            ).resolves.toMatchObject({ state: "detected" });
            await expect(
                client.getProcedureCandidate("corpus-1", "missing"),
            ).resolves.toBeUndefined();
            await expect(
                client.listProcedureCandidates("corpus-1", ["detected"]),
            ).resolves.toHaveLength(1);
            await expect(
                client.rejectProcedureCandidate("corpus-1", "candidate-1"),
            ).resolves.toMatchObject({ state: "rejected" });
            await expect(
                client.saveProcedure({
                    corpusId: "corpus-1",
                    candidateId: "candidate-1",
                    expectedVersion: 0,
                }),
            ).resolves.toMatchObject({
                procedureId: "procedure-1",
                version: 1,
                state: "saved",
            });
            await expect(
                client.listProcedures({
                    corpusId: "corpus-1",
                    states: ["saved"],
                }),
            ).resolves.toEqual([
                expect.objectContaining({ procedureId: "procedure-1" }),
            ]);
            await expect(
                client.getProcedure("corpus-1", "procedure-1", 1),
            ).resolves.toMatchObject({ version: 1 });
            await expect(
                client.getProcedure("corpus-1", "missing"),
            ).resolves.toBeUndefined();
            await expect(
                client.searchProcedures({
                    corpusId: "corpus-1",
                    query: "publish",
                    limit: 1,
                }),
            ).resolves.toEqual([
                expect.objectContaining({
                    procedure: expect.objectContaining({
                        procedureId: "procedure-1",
                    }),
                    score: 1,
                }),
            ]);
            await expect(
                client.archiveProcedure("corpus-1", "procedure-1", 1),
            ).resolves.toMatchObject({
                version: 2,
                previousVersion: 1,
                state: "archived",
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
