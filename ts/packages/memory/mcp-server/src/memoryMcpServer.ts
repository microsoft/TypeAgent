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
    corpusSchema,
    identifierSchema,
    ingestRequestSchema,
    ingestResultSchema,
    jobStatusSchema,
    knowledgeGraphSchema,
    memoryToolNames,
    optionalJobStatusSchema,
    optionalSourceSchema,
    searchRequestSchema,
    searchResultSchema,
    sourceSchema,
} from "@typeagent/memory-client";
import type {
    DocumentIngestRequest,
    MemorySearchRequest,
    MemoryService,
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

    public constructor(private readonly service: MemoryService) {
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
