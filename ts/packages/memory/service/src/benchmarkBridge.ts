// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
import {
    initRuntimeConfigFromProcessEnv,
    openai,
    type ChatModel,
} from "@typeagent/aiclient";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { FileMemoryService } from "./fileMemoryService.js";
import { waitForMemoryJob } from "./rpcFacade.js";
import type { MemoryService, MemoryEventSender } from "./types.js";
export { writeRunbookJson as writeBenchmarkJson } from "./durableRunbookJson.js";

export class BenchmarkResponseError extends Error {
    public constructor(
        public readonly kind: "provider-blocked" | "invalid-response",
        message: string,
    ) {
        super(message);
        this.name = "BenchmarkResponseError";
    }
}

function parseModelResponse(data: string) {
    let value: unknown;
    try {
        value = JSON.parse(data);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new BenchmarkResponseError("invalid-response", error.message);
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new BenchmarkResponseError(
            "invalid-response",
            "Model returned a non-object JSON response",
        );
    return benchmarkObject(value);
}

export function benchmarkObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected a JSON object");
    return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`Expected nonempty ${name}`);
    return value;
}

function positiveLimit(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100
    )
        throw new Error("Limit must be an integer from 1 to 100");
    return value;
}

function sender(value: unknown): MemoryEventSender {
    if (
        value === "user" ||
        value === "assistant" ||
        value === "system" ||
        value === "tool" ||
        value === "other"
    )
        return value;
    throw new Error("Unsupported transcript sender");
}

export class BenchmarkBridge {
    public constructor(
        private readonly service: MemoryService,
        private readonly model?: ChatModel,
        private readonly modelInfo: Record<string, unknown> = {},
    ) {}

    public async execute(value: unknown): Promise<unknown> {
        const request = benchmarkObject(value);
        const operation = text(request.operation, "operation");
        switch (operation) {
            case "capabilities":
                return {
                    ...(await this.service.getCapabilities()),
                    benchmark: this.modelInfo,
                };
            case "createCorpus":
                return this.service.createCorpus(text(request.name, "name"));
            case "inspect":
                return this.service.getCorpus(
                    text(request.corpusId, "corpusId"),
                );
            case "usage":
                return process.resourceUsage();
            case "ingest":
                return this.ingest(request);
            case "ingestBatch":
                return this.ingestBatch(request);
            case "appendEvents":
                return this.appendEvents(request);
            case "search":
                return this.service.search({
                    corpusId: text(request.corpusId, "corpusId"),
                    query: text(request.query, "query"),
                    limit: positiveLimit(request.limit, 10),
                    maxResponseChars: 24000,
                    indexedFragments: true,
                });
            case "searchEvents":
                return this.service.searchEvents({
                    corpusId: text(request.corpusId, "corpusId"),
                    conversationIds: [
                        text(request.conversationId, "conversationId"),
                    ],
                    query: text(request.query, "query"),
                    limit: positiveLimit(request.limit, 10),
                });
            case "answer":
                return this.service.answer({
                    corpusId: text(request.corpusId, "corpusId"),
                    question: text(request.question, "question"),
                    answerMode: "synthesized",
                });
            case "generate": {
                if (!this.model)
                    throw new Error("No benchmark model configured");
                const schema = benchmarkObject(request.schema);
                const result = await this.model.complete(
                    text(request.prompt, "prompt"),
                    undefined,
                    {
                        name: "benchmark_response",
                        strict: true,
                        schema,
                    },
                );
                if (!result.success) {
                    if (
                        result.message ===
                        "Model response blocked by content filter"
                    )
                        throw new BenchmarkResponseError(
                            "provider-blocked",
                            result.message,
                        );
                    throw new Error(result.message);
                }
                return parseModelResponse(result.data);
            }
            default:
                throw new Error(
                    `Unsupported benchmark operation: ${operation}`,
                );
        }
    }

    private async ingest(request: Record<string, unknown>) {
        const corpusId = text(request.corpusId, "corpusId");
        const sourceId = text(request.sourceId, "sourceId");
        const content = text(request.content, "content");
        const timestamp =
            request.timestamp === undefined
                ? undefined
                : text(request.timestamp, "timestamp");
        const result = await this.service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: text(request.title, "title"),
                text: content,
                ...(timestamp ? { capturedAt: timestamp } : {}),
            },
            pipeline: { updatePolicy: "skipIfUnchanged" },
        });
        const job = await waitForMemoryJob(this.service, result.jobId, {
            signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
        });
        if (job.state !== "complete")
            throw new Error(
                `Benchmark indexing ${job.state}: ${job.error ?? job.jobId}`,
            );
        const source = await this.service.getSource(corpusId, sourceId);
        if (
            !source ||
            !source.revisions.some(
                (revision) =>
                    revision.revisionId === source.activeRevisionId &&
                    revision.state === "ready",
            )
        )
            throw new Error("Benchmark source has no ready active revision");
        return { ...result, state: job.state, warnings: job.warnings };
    }

    private async ingestBatch(request: Record<string, unknown>) {
        if (!this.service.startBatchImport || !this.service.getBatchImport)
            throw new Error("Durable batch imports are unavailable");
        if (!Array.isArray(request.documents) || !request.documents.length)
            throw new Error("Expected nonempty documents array");
        const corpusId = text(request.corpusId, "corpusId");
        let batch = await this.service.startBatchImport({
            corpusId,
            idempotencyKey: text(request.fingerprint, "fingerprint"),
            documents: request.documents.map((value) => {
                const document = benchmarkObject(value);
                return {
                    source: {
                        sourceId: text(document.sourceId, "sourceId"),
                        sourceType: "text" as const,
                        title: text(document.title, "title"),
                        text: text(document.content, "content"),
                        ...(document.timestamp === undefined
                            ? {}
                            : {
                                  capturedAt: text(
                                      document.timestamp,
                                      "timestamp",
                                  ),
                              }),
                    },
                    pipeline: { updatePolicy: "skipIfUnchanged" as const },
                };
            }),
        });
        if (
            batch.state === "failed" ||
            batch.state === "partial" ||
            batch.state === "interrupted"
        ) {
            if (!this.service.retryBatchImport)
                throw new Error(
                    "Interrupted benchmark batch cannot be retried",
                );
            batch = await this.service.retryBatchImport(batch.batchId);
        }
        const deadline = Date.now() + 2 * 60 * 60 * 1000;
        while (batch.state === "running") {
            if (Date.now() > deadline)
                throw new Error(`Benchmark batch timed out: ${batch.batchId}`);
            await new Promise((resolve) => setTimeout(resolve, 250));
            batch = await this.service.getBatchImport(batch.batchId);
        }
        if (batch.state !== "complete")
            throw new Error(`Benchmark batch ${batch.state}: ${batch.batchId}`);
        for (const member of batch.members) {
            if (!member.sourceId)
                throw new Error(
                    "Completed batch member has no source identity",
                );
            const source = await this.service.getSource(
                corpusId,
                member.sourceId,
            );
            if (
                !source?.revisions.some(
                    (revision) =>
                        revision.revisionId === source.activeRevisionId &&
                        revision.state === "ready",
                )
            )
                throw new Error("Completed batch has an unready revision");
        }
        return batch;
    }

    private async appendEvents(request: Record<string, unknown>) {
        const corpusId = text(request.corpusId, "corpusId");
        const conversationId = text(request.conversationId, "conversationId");
        const fingerprint = text(request.fingerprint, "fingerprint");
        if (!Array.isArray(request.turns) || request.turns.length === 0)
            throw new Error("Expected nonempty turns array");
        let appended = 0;
        let replayed = 0;
        for (const value of request.turns) {
            const turn = benchmarkObject(value);
            const role = sender(turn.role);
            const timestamp = text(turn.timestamp, "timestamp");
            const result = await this.service.appendEvent({
                corpusId,
                conversationId,
                turnId: text(turn.identity, "identity"),
                idempotencyKey: `${fingerprint}:${text(turn.identity, "identity")}`,
                producer: {
                    producerId: "typeagent.benchmark",
                    producerType: "benchmark-transcript",
                },
                eventType: "imported-transcript-turn",
                sourceKind: "conversation",
                eventTime: timestamp,
                sender: role,
                content: text(turn.content, "content"),
                metadata: {
                    authority:
                        role === "user" ? "user-assertion" : "evidence-only",
                    sourceDocumentId: text(turn.documentId, "documentId"),
                    speaker: text(turn.speaker, "speaker"),
                    originalId: text(turn.originalId, "originalId"),
                    session: text(turn.session, "session"),
                    originalTime: text(turn.originalTime, "originalTime"),
                    timeSource:
                        turn.timeSource === undefined
                            ? "turn"
                            : text(turn.timeSource, "timeSource"),
                },
            });
            if (result.replayed) replayed++;
            else appended++;
        }
        return { appended, replayed };
    }
}

export async function createBenchmarkRuntime(store: string) {
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    const service = new FileMemoryService(resolve(store));
    try {
        const bridge = configuredBenchmarkBridge(service);
        await service.initialize();
        return { bridge, close: () => service.close() };
    } catch (error) {
        await service.close();
        throw error;
    }
}

function configuredBenchmarkBridge(service: MemoryService) {
    const model = openai.createChatModel(
        process.env.TYPEAGENT_BENCHMARK_MODEL,
        { response_format: { type: "json_object" } },
    );
    const settings = openai.getChatModelSettings(
        process.env.TYPEAGENT_BENCHMARK_MODEL,
    );
    const modelName =
        ("modelName" in settings && settings.modelName) ||
        /deployments\/([^/]+)/.exec(new URL(settings.endpoint).pathname)?.[1];
    if (!modelName)
        throw new Error("Cannot identify configured benchmark model");
    return new BenchmarkBridge(service, model, {
        modelId: `${settings.provider}:${modelName}`,
        configurationFingerprint: createHash("sha256")
            .update(
                JSON.stringify({
                    provider: settings.provider,
                    modelName,
                    endpoint: settings.endpoint,
                    embeddingProvider: process.env.TYPEAGENT_EMBEDDING_PROVIDER,
                    embeddingModel: process.env.TYPEAGENT_EMBEDDING_MODEL,
                    embeddingSize: process.env.TYPEAGENT_EMBEDDING_SIZE,
                }),
            )
            .digest("hex"),
        informationalViews: true,
        evidenceLimit: 12,
        evidenceCharacters: 24000,
    });
}

export async function runBenchmarkBridge(args: string[]): Promise<void> {
    if (args.length !== 2 || args[0] !== "--store" || !args[1]?.trim())
        throw new Error("Usage: benchmarkBridge --store <run-owned-directory>");
    // eslint-disable-next-line no-console -- Provider logging must not corrupt the JSON-line transport.
    console.log = (...values: unknown[]) => console.error(...values);
    const runtime = await createBenchmarkRuntime(args[1]);
    let input: ReturnType<typeof createInterface> | undefined;
    try {
        input = createInterface({ input: process.stdin, crlfDelay: Infinity });
        for await (const line of input) {
            let id: unknown = null;
            try {
                if (Buffer.byteLength(line, "utf8") > 8 * 1024 * 1024)
                    throw new Error("Benchmark request exceeds 8 MiB");
                const request = benchmarkObject(JSON.parse(line));
                id = text(request.id, "id");
                if (request.operation === "close") {
                    process.stdout.write(
                        `${JSON.stringify({ id, result: { closed: true } })}\n`,
                    );
                    break;
                }
                const result = await runtime.bridge.execute(request);
                process.stdout.write(`${JSON.stringify({ id, result })}\n`);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.error(`Benchmark request failed: ${message}`);
                process.stdout.write(
                    `${JSON.stringify({ id, error: message })}\n`,
                );
            }
        }
    } finally {
        input?.close();
        await runtime.close();
    }
}

if (process.argv[1]?.endsWith("benchmarkBridge.js")) {
    runBenchmarkBridge(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
