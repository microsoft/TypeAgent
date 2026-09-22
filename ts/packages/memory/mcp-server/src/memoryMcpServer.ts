// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    McpServer,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    capabilitiesSchema,
    answerRequestSchema,
    answerResultSchema,
    clearedCountSchema,
    corpusSchema,
    eventAppendRequestSchema,
    eventAppendResultSchema,
    eventForgetRequestSchema,
    eventForgetResultSchema,
    eventListRequestSchema,
    eventPageSchema,
    eventSearchRequestSchema,
    eventSearchResultSchema,
    optionalCorpusStatusSchema,
    identifierSchema,
    ingestRequestSchema,
    ingestResultSchema,
    jobListRequestSchema,
    jobPageSchema,
    jobStatusSchema,
    knowledgeGraphSchema,
    memoryToolNames,
    optionalJobStatusSchema,
    optionalEventSchema,
    optionalSourceSchema,
    optionalProcedureCandidateSchema,
    optionalProcedureVersionSchema,
    personalHowToSettingsSchema,
    personalHowToSettingsUpdateSchema,
    procedureArchiveRequestSchema,
    procedureCandidateCreateRequestSchema,
    procedureCandidateInputSchema,
    procedureCandidateListRequestSchema,
    procedureCandidateSchema,
    procedureGetRequestSchema,
    procedureListRequestSchema,
    procedureSaveRequestSchema,
    procedureSearchMatchSchema,
    procedureSearchRequestSchema,
    procedureSummarySchema,
    procedureVersionSchema,
    searchRequestSchema,
    searchResultSchema,
    sourceContentRequestSchema,
    sourceContentSchema,
    sourceForgetPreviewSchema,
    sourceForgetRequestSchema,
    sourceForgetResultSchema,
    sourceListRequestSchema,
    sourcePageSchema,
    sourceReplaceRequestSchema,
    reindexResultSchema,
    sourceSchema,
} from "@typeagent/memory-client";
import type {
    DocumentIngestRequest,
    JobListRequest,
    MemoryAnswerRequest,
    MemoryEventAppendRequest,
    MemoryEventForgetRequest,
    MemoryEventListRequest,
    MemoryEventSearchRequest,
    MemorySearchRequest,
    MemoryService,
    PersonalHowToService,
    PersonalHowToSettingsUpdate,
    ProcedureCandidateCreateRequest,
    ProcedureListRequest,
    ProcedureSaveRequest,
    ProcedureSearchRequest,
    SourceContentRequest,
    SourceForgetRequest,
    SourceListRequest,
    SourceReplaceRequest,
} from "@typeagent/memory-service";
import { z } from "zod";

const corpusCreateInputSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
});
const corpusIdInputSchema = z.object({ corpusId: identifierSchema });
const sourceGetInputSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
});
const jobInputSchema = z.object({ jobId: identifierSchema });
const eventInputSchema = z.object({
    corpusId: identifierSchema,
    eventId: identifierSchema,
});
const jobWaitInputSchema = jobInputSchema.extend({
    pollIntervalMs: z.number().int().min(25).max(5_000).optional(),
});

function outputSchema(schema: z.ZodType) {
    return z.object({ result: schema });
}

function toolResult(value: unknown): CallToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(value, undefined, 2) }],
        structuredContent: { result: value },
    };
}

function toolError(error: unknown): CallToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
        isError: true,
        content: [{ type: "text", text: message }],
    };
}

export class MemoryMcpServer {
    public readonly server: McpServer;

    public constructor(
        private readonly service: MemoryService & PersonalHowToService,
    ) {
        this.server = new McpServer({
            name: "typeagent-memory",
            version: "0.0.1",
        });
        this.registerTools();
        this.registerResources();
    }

    public async start(transport: Transport = new StdioServerTransport()) {
        await this.service.initialize?.();
        await this.server.connect(transport);
    }

    public async close(): Promise<void> {
        await this.server.close();
    }

    private registerTools(): void {
        this.server.registerTool(
            memoryToolNames.corpusCreate,
            {
                description: "Create a durable memory corpus.",
                inputSchema: corpusCreateInputSchema,
                outputSchema: outputSchema(corpusSchema),
                annotations: { destructiveHint: false },
            },
            async ({ name, description }) =>
                this.run(() => this.service.createCorpus(name, description)),
        );
        this.server.registerTool(
            memoryToolNames.corpusList,
            {
                description: "List available memory corpora.",
                outputSchema: outputSchema(corpusSchema.array()),
                annotations: { readOnlyHint: true },
            },
            async () => this.run(() => this.service.listCorpora()),
        );
        this.server.registerTool(
            memoryToolNames.corpusGet,
            {
                description:
                    "Get corpus status, durable counts, and index version.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(optionalCorpusStatusSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId }) =>
                this.run(
                    async () =>
                        (await this.service.getCorpus(corpusId)) ?? null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.corpusClear,
            {
                description:
                    "Clear all sources and indexes from a memory corpus.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(clearedCountSchema),
                annotations: { destructiveHint: true },
            },
            async ({ corpusId }) =>
                this.run(() => this.service.clearCorpus(corpusId)),
        );
        this.server.registerTool(
            memoryToolNames.corpusReindex,
            {
                description:
                    "Atomically rebuild all derived indexes for a corpus.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(reindexResultSchema),
                annotations: { destructiveHint: false },
            },
            async ({ corpusId }, extra) =>
                this.run(() =>
                    this.service.reindexCorpus(corpusId, extra.signal),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceList,
            {
                description: "List source metadata in a memory corpus.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(sourceSchema.array()),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId }) =>
                this.run(() => this.service.listSources(corpusId)),
        );
        this.server.registerTool(
            memoryToolNames.sourceListPage,
            {
                description:
                    "List source metadata with bounded deterministic pagination.",
                inputSchema: sourceListRequestSchema,
                outputSchema: outputSchema(sourcePageSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.listSourcesPage(request as SourceListRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceGet,
            {
                description: "Get source and revision metadata.",
                inputSchema: sourceGetInputSchema,
                outputSchema: outputSchema(optionalSourceSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, sourceId }) =>
                this.run(
                    async () =>
                        (await this.service.getSource(corpusId, sourceId)) ??
                        null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceContentGet,
            {
                description:
                    "Read a bounded range from an active or named source revision.",
                inputSchema: sourceContentRequestSchema,
                outputSchema: outputSchema(sourceContentSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.getSourceContent(
                        request as SourceContentRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceKnowledgeGet,
            {
                description:
                    "Get entities, topics, and relationships derived from one source.",
                inputSchema: sourceGetInputSchema,
                outputSchema: outputSchema(knowledgeGraphSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, sourceId }) =>
                this.run(() =>
                    this.service.getSourceKnowledge(corpusId, sourceId),
                ),
        );
        this.server.registerTool(
            memoryToolNames.documentIngest,
            {
                description:
                    "Submit Markdown, text, HTML, or VTT content for durable indexing.",
                inputSchema: ingestRequestSchema,
                outputSchema: outputSchema(ingestResultSchema),
                annotations: { destructiveHint: false },
            },
            async (request, extra) =>
                this.run(() =>
                    this.service.ingestDocument(
                        request as DocumentIngestRequest,
                        extra.signal,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceReplace,
            {
                description:
                    "Replace a source only if its active revision still matches.",
                inputSchema: sourceReplaceRequestSchema,
                outputSchema: outputSchema(ingestResultSchema),
                annotations: { destructiveHint: false },
            },
            async (request, extra) =>
                this.run(() =>
                    this.service.replaceSource(
                        request as SourceReplaceRequest,
                        extra.signal,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceForgetPreview,
            {
                description:
                    "Preview source deletion and issue a short-lived confirmation token.",
                inputSchema: sourceGetInputSchema,
                outputSchema: outputSchema(sourceForgetPreviewSchema),
                annotations: { readOnlyHint: false, destructiveHint: false },
            },
            async ({ corpusId, sourceId }) =>
                this.run(() =>
                    this.service.previewForgetSource(corpusId, sourceId),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceForget,
            {
                description:
                    "Confirm source deletion and rebuild indexes without its derived data.",
                inputSchema: sourceForgetRequestSchema,
                outputSchema: outputSchema(sourceForgetResultSchema),
                annotations: { destructiveHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.forgetSource(request as SourceForgetRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.sourceReindex,
            {
                description:
                    "Atomically rebuild corpus indexes for a source management request.",
                inputSchema: sourceGetInputSchema,
                outputSchema: outputSchema(reindexResultSchema),
                annotations: { destructiveHint: false },
            },
            async ({ corpusId, sourceId }, extra) =>
                this.run(() =>
                    this.service.reindexSource(
                        corpusId,
                        sourceId,
                        extra.signal,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.jobGet,
            {
                description: "Get durable ingestion job status and progress.",
                inputSchema: jobInputSchema,
                outputSchema: outputSchema(optionalJobStatusSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ jobId }) =>
                this.run(
                    async () => (await this.service.getJob(jobId)) ?? null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.jobList,
            {
                description:
                    "List durable jobs with corpus, source, and state filters.",
                inputSchema: jobListRequestSchema,
                outputSchema: outputSchema(jobPageSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.listJobs(request as JobListRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.jobCancel,
            {
                description: "Request cancellation of an ingestion job.",
                inputSchema: jobInputSchema,
                outputSchema: outputSchema(optionalJobStatusSchema),
                annotations: { destructiveHint: true },
            },
            async ({ jobId }) =>
                this.run(
                    async () => (await this.service.cancelJob(jobId)) ?? null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.jobWait,
            {
                description:
                    "Wait for an ingestion job while reporting MCP progress.",
                inputSchema: jobWaitInputSchema,
                outputSchema: outputSchema(jobStatusSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ jobId, pollIntervalMs }, extra) =>
                this.run(async () => {
                    const interval = pollIntervalMs ?? 250;
                    while (true) {
                        if (extra.signal.aborted) {
                            await this.service.cancelJob(jobId);
                            throw (
                                extra.signal.reason ??
                                new Error("Job wait cancelled")
                            );
                        }
                        const job = await this.service.getJob(jobId);
                        if (job === undefined) {
                            throw new Error(`Unknown memory job '${jobId}'`);
                        }
                        const progressToken = extra._meta?.progressToken;
                        if (progressToken !== undefined) {
                            await extra.sendNotification({
                                method: "notifications/progress",
                                params: {
                                    progressToken,
                                    progress: job.progress.completed,
                                    ...(job.progress.total === undefined
                                        ? {}
                                        : { total: job.progress.total }),
                                    ...(job.progress.message === undefined
                                        ? {}
                                        : { message: job.progress.message }),
                                },
                            });
                        }
                        if (
                            [
                                "complete",
                                "partial",
                                "failed",
                                "cancelled",
                            ].includes(job.state)
                        ) {
                            return job;
                        }
                        await new Promise<void>((resolve) =>
                            setTimeout(resolve, interval),
                        );
                    }
                }),
        );
        this.server.registerTool(
            memoryToolNames.eventAppend,
            {
                description: "Append a durable event to a memory corpus.",
                inputSchema: eventAppendRequestSchema,
                outputSchema: outputSchema(eventAppendResultSchema),
                annotations: { destructiveHint: false },
            },
            async (request) =>
                this.run(() =>
                    this.service.appendEvent(
                        request as MemoryEventAppendRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.eventGet,
            {
                description: "Get a durable event by identifier.",
                inputSchema: eventInputSchema,
                outputSchema: outputSchema(optionalEventSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, eventId }) =>
                this.run(
                    async () =>
                        (await this.service.getEvent(corpusId, eventId)) ??
                        null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.eventList,
            {
                description:
                    "List durable events with filters and deterministic pagination.",
                inputSchema: eventListRequestSchema,
                outputSchema: outputSchema(eventPageSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.listEvents(request as MemoryEventListRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.eventSearch,
            {
                description: "Search durable events with optional filters.",
                inputSchema: eventSearchRequestSchema,
                outputSchema: outputSchema(eventSearchResultSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.searchEvents(
                        request as MemoryEventSearchRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.eventForget,
            {
                description:
                    "Delete durable events and optionally their linked sources.",
                inputSchema: eventForgetRequestSchema,
                outputSchema: outputSchema(eventForgetResultSchema),
                annotations: { destructiveHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.forgetEvents(
                        request as MemoryEventForgetRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.howToSettingsGet,
            {
                description: "Get corpus-owned personal how-to settings.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(personalHowToSettingsSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId }) =>
                this.run(() => this.service.getPersonalHowToSettings(corpusId)),
        );
        this.server.registerTool(
            memoryToolNames.howToSettingsUpdate,
            {
                description:
                    "Update personal how-to settings using an expected revision.",
                inputSchema: personalHowToSettingsUpdateSchema,
                outputSchema: outputSchema(personalHowToSettingsSchema),
                annotations: { destructiveHint: false },
            },
            async ({ corpusId, ...update }) =>
                this.run(() =>
                    this.service.updatePersonalHowToSettings(
                        corpusId,
                        update as PersonalHowToSettingsUpdate,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureCandidateCreate,
            {
                description: "Create a detected or draft procedure candidate.",
                inputSchema: procedureCandidateCreateRequestSchema,
                outputSchema: outputSchema(procedureCandidateSchema),
                annotations: { destructiveHint: false },
            },
            async (request) =>
                this.run(() =>
                    this.service.createProcedureCandidate(
                        request as ProcedureCandidateCreateRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureCandidateGet,
            {
                description: "Get a procedure candidate by identifier.",
                inputSchema: procedureCandidateInputSchema,
                outputSchema: outputSchema(optionalProcedureCandidateSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, candidateId }) =>
                this.run(
                    async () =>
                        (await this.service.getProcedureCandidate(
                            corpusId,
                            candidateId,
                        )) ?? null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureCandidateList,
            {
                description: "List procedure candidates with state filtering.",
                inputSchema: procedureCandidateListRequestSchema,
                outputSchema: outputSchema(procedureCandidateSchema.array()),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, states }) =>
                this.run(() =>
                    this.service.listProcedureCandidates(corpusId, states),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureCandidateReject,
            {
                description: "Reject a procedure candidate.",
                inputSchema: procedureCandidateInputSchema,
                outputSchema: outputSchema(procedureCandidateSchema),
                annotations: { destructiveHint: true },
            },
            async ({ corpusId, candidateId }) =>
                this.run(() =>
                    this.service.rejectProcedureCandidate(
                        corpusId,
                        candidateId,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureSave,
            {
                description:
                    "Save canonical procedure JSON or validated Markdown.",
                inputSchema: procedureSaveRequestSchema,
                outputSchema: outputSchema(procedureVersionSchema),
                annotations: { destructiveHint: false },
            },
            async (request) =>
                this.run(() =>
                    this.service.saveProcedure(request as ProcedureSaveRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureGet,
            {
                description: "Get the latest or a named procedure version.",
                inputSchema: procedureGetRequestSchema,
                outputSchema: outputSchema(optionalProcedureVersionSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId, procedureId, version }) =>
                this.run(
                    async () =>
                        (await this.service.getProcedure(
                            corpusId,
                            procedureId,
                            version,
                        )) ?? null,
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureList,
            {
                description: "List saved procedures with state filtering.",
                inputSchema: procedureListRequestSchema,
                outputSchema: outputSchema(procedureSummarySchema.array()),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.listProcedures(
                        request as ProcedureListRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureSearch,
            {
                description: "Search saved procedure content.",
                inputSchema: procedureSearchRequestSchema,
                outputSchema: outputSchema(procedureSearchMatchSchema.array()),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.searchProcedures(
                        request as ProcedureSearchRequest,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.procedureArchive,
            {
                description: "Create an immutable archived procedure version.",
                inputSchema: procedureArchiveRequestSchema,
                outputSchema: outputSchema(procedureVersionSchema),
                annotations: { destructiveHint: true },
            },
            async ({ corpusId, procedureId, expectedVersion }) =>
                this.run(() =>
                    this.service.archiveProcedure(
                        corpusId,
                        procedureId,
                        expectedVersion,
                    ),
                ),
        );
        this.server.registerTool(
            memoryToolNames.search,
            {
                description:
                    "Search a corpus and return bounded, source-linked evidence.",
                inputSchema: searchRequestSchema,
                outputSchema: outputSchema(searchResultSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.search(request as MemorySearchRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.answer,
            {
                description:
                    "Answer from bounded source-linked memory evidence with explicit citations.",
                inputSchema: answerRequestSchema,
                outputSchema: outputSchema(answerResultSchema),
                annotations: { readOnlyHint: true },
            },
            async (request) =>
                this.run(() =>
                    this.service.answer(request as MemoryAnswerRequest),
                ),
        );
        this.server.registerTool(
            memoryToolNames.knowledgeGraphGet,
            {
                description:
                    "Get entities, topics, and relationships extracted from a durable corpus.",
                inputSchema: corpusIdInputSchema,
                outputSchema: outputSchema(knowledgeGraphSchema),
                annotations: { readOnlyHint: true },
            },
            async ({ corpusId }) =>
                this.run(() => this.service.getKnowledgeGraph(corpusId)),
        );
        this.server.registerTool(
            memoryToolNames.capabilities,
            {
                description: "Report memory service capabilities and warnings.",
                outputSchema: outputSchema(capabilitiesSchema),
                annotations: { readOnlyHint: true },
            },
            async () => this.run(() => this.service.getCapabilities()),
        );
    }

    private registerResources(): void {
        this.server.registerResource(
            "memory-job",
            new ResourceTemplate("typeagent-memory://jobs/{jobId}", {
                list: undefined,
            }),
            { mimeType: "application/json" },
            async (uri, variables) => {
                const job = await this.service.getJob(String(variables.jobId));
                if (job === undefined) {
                    throw new Error(`Unknown memory job '${variables.jobId}'`);
                }
                return this.jsonResource(uri, job);
            },
        );
        this.server.registerResource(
            "memory-source",
            new ResourceTemplate(
                "typeagent-memory://corpora/{corpusId}/sources/{sourceId}",
                { list: undefined },
            ),
            { mimeType: "application/json" },
            async (uri, variables) => {
                const source = await this.service.getSource(
                    String(variables.corpusId),
                    String(variables.sourceId),
                );
                if (source === undefined) {
                    throw new Error(
                        `Unknown memory source '${variables.sourceId}'`,
                    );
                }
                return this.jsonResource(uri, source);
            },
        );
    }

    private async run(
        operation: () => Promise<unknown>,
    ): Promise<CallToolResult> {
        try {
            return toolResult(await operation());
        } catch (error) {
            return toolError(error);
        }
    }

    private jsonResource(uri: URL, value: unknown) {
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(value, undefined, 2),
                },
            ],
        };
    }
}
