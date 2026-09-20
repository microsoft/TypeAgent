// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Client,
    StreamableHTTPClientTransport,
    type CallToolResult,
} from "@modelcontextprotocol/client";
import {
    StdioClientTransport,
    getDefaultEnvironment,
    type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import type {
    DocumentIngestRequest,
    DocumentIngestResult,
    IngestionJobStatus,
    JobProgress,
    MemoryCorpus,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
} from "@typeagent/memory-service";
import type { z } from "zod";
import {
    capabilitiesSchema,
    corpusSchema,
    ingestResultSchema,
    jobStatusSchema,
    knowledgeGraphSchema,
    memoryToolNames,
    optionalJobStatusSchema,
    optionalSourceSchema,
    searchResultSchema,
    sourceSchema,
    terminalJobStates,
} from "./protocol.js";

export interface MemoryClientCallOptions {
    signal?: AbortSignal;
    onProgress?: (progress: JobProgress) => void;
}

export interface MemoryServiceClient extends MemoryService {
    ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    waitForJob(
        jobId: string,
        options?: MemoryClientCallOptions & { pollIntervalMs?: number },
    ): Promise<IngestionJobStatus>;
    close(): Promise<void>;
}

export class InProcessMemoryServiceClient implements MemoryServiceClient {
    public constructor(private readonly service: MemoryService) {}

    public createCorpus(name: string, description?: string) {
        return this.service.createCorpus(name, description);
    }

    public listCorpora() {
        return this.service.listCorpora();
    }

    public listSources(corpusId: string) {
        return this.service.listSources(corpusId);
    }

    public getSource(corpusId: string, sourceId: string) {
        return this.service.getSource(corpusId, sourceId);
    }

    public ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ) {
        return this.service.ingestDocument(request, signal);
    }

    public getJob(jobId: string) {
        return this.service.getJob(jobId);
    }

    public cancelJob(jobId: string) {
        return this.service.cancelJob(jobId);
    }

    public search(request: MemorySearchRequest) {
        return this.service.search(request);
    }

    public getKnowledgeGraph(corpusId: string) {
        return this.service.getKnowledgeGraph(corpusId);
    }

    public getCapabilities() {
        return this.service.getCapabilities();
    }

    public waitForJob(
        jobId: string,
        options: MemoryClientCallOptions & { pollIntervalMs?: number } = {},
    ) {
        return waitForJob(this, jobId, options);
    }

    public async close(): Promise<void> {}
}

export type MemoryMcpTransportConfig =
    | {
          kind: "stdio";
          command: string;
          args: string[];
          env?: Record<string, string>;
          cwd?: string;
      }
    | {
          kind: "http";
          url: string;
          headers?: Record<string, string>;
          timeoutMs?: number;
      };

type MemoryMcpTransport = StdioClientTransport | StreamableHTTPClientTransport;

export class McpMemoryServiceClient implements MemoryServiceClient {
    private constructor(
        private readonly client: Client,
        private readonly timeoutMs: number | undefined,
    ) {}

    public static async create(
        config: MemoryMcpTransportConfig,
    ): Promise<McpMemoryServiceClient> {
        const transport = createTransport(config);
        const client = new Client(
            { name: "typeagent-memory-client", version: "0.0.1" },
            { versionNegotiation: { mode: "legacy" }, capabilities: {} },
        );
        try {
            await client.connect(
                transport,
                config.kind === "http" && config.timeoutMs !== undefined
                    ? { timeout: config.timeoutMs }
                    : undefined,
            );
        } catch (error) {
            await transport.close().catch(() => undefined);
            throw error;
        }
        return new McpMemoryServiceClient(
            client,
            config.kind === "http" ? config.timeoutMs : undefined,
        );
    }

    public createCorpus(
        name: string,
        description?: string,
    ): Promise<MemoryCorpus> {
        return this.invoke(
            memoryToolNames.corpusCreate,
            { name, description },
            corpusSchema,
        );
    }

    public listCorpora(): Promise<MemoryCorpus[]> {
        return this.invoke(
            memoryToolNames.corpusList,
            {},
            corpusSchema.array(),
        );
    }

    public listSources(corpusId: string): Promise<MemorySource[]> {
        return this.invoke<MemorySource[]>(
            memoryToolNames.sourceList,
            { corpusId },
            sourceSchema.array(),
        );
    }

    public getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined> {
        return this.invoke<MemorySource | null>(
            memoryToolNames.sourceGet,
            { corpusId, sourceId },
            optionalSourceSchema,
        ).then((source) => source ?? undefined);
    }

    public ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        return this.invoke(
            memoryToolNames.documentIngest,
            request,
            ingestResultSchema,
            signal === undefined ? {} : { signal },
        );
    }

    public getJob(jobId: string): Promise<IngestionJobStatus | undefined> {
        return this.invoke<IngestionJobStatus | null>(
            memoryToolNames.jobGet,
            { jobId },
            optionalJobStatusSchema,
        ).then((job) => job ?? undefined);
    }

    public cancelJob(jobId: string): Promise<IngestionJobStatus | undefined> {
        return this.invoke<IngestionJobStatus | null>(
            memoryToolNames.jobCancel,
            { jobId },
            optionalJobStatusSchema,
        ).then((job) => job ?? undefined);
    }

    public search(request: MemorySearchRequest): Promise<MemorySearchResult> {
        return this.invoke(memoryToolNames.search, request, searchResultSchema);
    }

    public getKnowledgeGraph(corpusId: string): Promise<MemoryKnowledgeGraph> {
        return this.invoke(
            memoryToolNames.knowledgeGraphGet,
            { corpusId },
            knowledgeGraphSchema,
        );
    }

    public getCapabilities(): Promise<MemoryServiceCapabilities> {
        return this.invoke(
            memoryToolNames.capabilities,
            {},
            capabilitiesSchema,
        );
    }

    public waitForJob(
        jobId: string,
        options: MemoryClientCallOptions & { pollIntervalMs?: number } = {},
    ): Promise<IngestionJobStatus> {
        return this.invoke<IngestionJobStatus>(
            memoryToolNames.jobWait,
            {
                jobId,
                ...(options.pollIntervalMs === undefined
                    ? {}
                    : { pollIntervalMs: options.pollIntervalMs }),
            },
            jobStatusSchema,
            options,
        );
    }

    public async close(): Promise<void> {
        await this.client.close();
    }

    private async invoke<T>(
        name: string,
        args: object,
        schema: z.ZodType,
        options: MemoryClientCallOptions = {},
    ): Promise<T> {
        const result = await this.client.callTool(
            {
                name,
                arguments: args as Record<string, unknown>,
            },
            {
                ...(this.timeoutMs === undefined
                    ? {}
                    : { timeout: this.timeoutMs }),
                ...(options.signal === undefined
                    ? {}
                    : { signal: options.signal }),
                ...(options.onProgress === undefined
                    ? {}
                    : {
                          onprogress: (progress) =>
                              options.onProgress?.({
                                  completed: progress.progress,
                                  ...(progress.total === undefined
                                      ? {}
                                      : { total: progress.total }),
                                  ...(progress.message === undefined
                                      ? {}
                                      : { message: progress.message }),
                              }),
                      }),
            },
        );
        return parseToolResult(name, result, schema);
    }
}

async function waitForJob(
    client: MemoryService,
    jobId: string,
    options: MemoryClientCallOptions & { pollIntervalMs?: number },
): Promise<IngestionJobStatus> {
    const interval = options.pollIntervalMs ?? 250;
    while (true) {
        if (options.signal?.aborted) {
            await client.cancelJob(jobId);
            throw options.signal.reason ?? new Error("Job wait cancelled");
        }
        const job = await client.getJob(jobId);
        if (job === undefined) {
            throw new Error(`Unknown memory job '${jobId}'`);
        }
        options.onProgress?.(job.progress);
        if (terminalJobStates.has(job.state)) {
            return job;
        }
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, interval);
            options.signal?.addEventListener(
                "abort",
                () => {
                    clearTimeout(timeout);
                    reject(
                        options.signal?.reason ??
                            new Error("Job wait cancelled"),
                    );
                },
                { once: true },
            );
        });
    }
}

function createTransport(config: MemoryMcpTransportConfig): MemoryMcpTransport {
    if (config.kind === "http") {
        return new StreamableHTTPClientTransport(new URL(config.url), {
            ...(config.headers === undefined
                ? {}
                : { requestInit: { headers: config.headers } }),
            ...(config.timeoutMs === undefined
                ? {}
                : {
                      fetch: (input, init) =>
                          globalThis.fetch(input, {
                              ...init,
                              signal:
                                  init?.signal == null
                                      ? AbortSignal.timeout(config.timeoutMs!)
                                      : AbortSignal.any([
                                            init.signal,
                                            AbortSignal.timeout(
                                                config.timeoutMs!,
                                            ),
                                        ]),
                          }),
                  }),
        });
    }
    const parameters: StdioServerParameters = {
        command: config.command,
        args: config.args,
        stderr: "pipe",
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        ...(config.env === undefined
            ? {}
            : { env: { ...getDefaultEnvironment(), ...config.env } }),
    };
    return new StdioClientTransport(parameters);
}

function parseToolResult<T>(
    name: string,
    result: CallToolResult,
    schema: z.ZodType,
): T {
    if (result.isError === true) {
        const message = result.content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .join("\n");
        throw new Error(message || `Memory tool '${name}' failed`);
    }
    const envelope = result.structuredContent;
    const parsed = schema.safeParse(
        envelope !== null &&
            typeof envelope === "object" &&
            "result" in envelope
            ? envelope.result
            : undefined,
    );
    if (!parsed.success) {
        throw new Error(
            `Memory tool '${name}' returned invalid structured content: ${parsed.error.message}`,
        );
    }
    return parsed.data as T;
}
