// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import {
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    rm,
    stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
    createBenchmarkRuntime,
    BenchmarkResponseError as QuestionError,
} from "@typeagent/memory-service/benchmark";
import {
    documentsFrom,
    loadDataset,
    queriesFor,
    selectQueries,
    beamSplits,
    validateDataset,
} from "./data.js";
import { loadProtocol, render, type Protocol } from "./protocol.js";
import { MemoryProvider } from "./provider.js";
import { bm25Retrieve, judge } from "./scoring.js";
import {
    bytesHash,
    digest,
    list,
    object,
    readJson,
    saveJson,
    string,
    updateProgress,
} from "./storage.js";
import type {
    DatasetName,
    Generate,
    Prediction,
    ProviderName,
    Query,
    Runtime,
    Stage,
} from "./types.js";

const predictionSchema = z.object({
    queryId: z.string(),
    query: z.string(),
    category: z.string(),
    answer: z.string(),
    context: z.string(),
    retrievedSourceIds: z.array(z.string()),
    retrieveTimeMs: z.number(),
    nativeAnswer: z.record(z.string(), z.unknown()).optional(),
});
const scoredSchema = predictionSchema.extend({
    correct: z.boolean(),
    score: z.number(),
    judgeReason: z.string(),
    evidenceRecall: z.number().nullable(),
    evidenceRecallGranularity: z.string(),
    totalSeconds: z.number(),
    eventOrdering: z
        .object({ f1: z.number(), tauNorm: z.number(), finalScore: z.number() })
        .optional(),
});
const questionFailureSchema = z.object({
    queryId: z.string(),
    query: z.string(),
    unit: z.string(),
    category: z.string(),
    kind: z.enum(["provider-blocked", "invalid-response"]),
    phase: z.enum(["generation", "judging"]),
    error: z.string(),
    at: z.string(),
    totalSeconds: z.number(),
    prediction: predictionSchema.optional(),
});
const statusSchema = z
    .object({
        version: z.literal("typeagent-memory-ts-v2"),
        run: z.string(),
        state: z.string(),
        startedAt: z.string(),
        fingerprint: z.string().optional(),
        manifest: z.record(z.string(), z.unknown()).optional(),
        results: z.array(scoredSchema),
        questionFailures: z.array(questionFailureSchema),
        pendingPrediction: predictionSchema.optional(),
        error: z.string().optional(),
        failedAt: z.string().optional(),
        previousFailures: z
            .array(z.object({ at: z.string(), error: z.string() }))
            .optional(),
    })
    .passthrough();
type Status = z.infer<typeof statusSchema>;
export interface RunOptions {
    repo: string;
    output: string;
    progress: string;
    cache: string;
    protocol: string;
    dataset: DatasetName;
    split: string;
    stage: Stage | "suite";
    provider: ProviderName;
    mode: "rag" | "agent";
    input?: string;
    unit?: string;
    signal?: AbortSignal;
}
export interface Dependencies {
    openRuntime?: (store: string) => Promise<Runtime>;
}
async function sourceIdentity(repo: string) {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const files = (await readdir(directory))
        .filter((file) => file.endsWith(".js"))
        .sort();
    return {
        repoCommit: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
            encoding: "utf8",
        }).trim(),
        productTrackedDiffSha256: bytesHash(
            execFileSync("git", ["-C", repo, "diff", "HEAD", "--", "ts"], {
                maxBuffer: 64 * 1024 * 1024,
            }),
        ),
        adapterFilesSha256: digest(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    bytesHash(await readFile(path.join(directory, file))),
                ]),
            ),
        ),
        bridgeSourceSha256: bytesHash(
            await readFile(
                path.join(
                    repo,
                    "ts",
                    "packages",
                    "memory",
                    "service",
                    "src",
                    "benchmarkBridge.ts",
                ),
            ),
        ),
    };
}
async function predict(
    query: Query,
    options: RunOptions,
    provider: MemoryProvider | undefined,
    documents: ReturnType<typeof documentsFrom>,
    protocol: Protocol,
    generate: Generate,
): Promise<Prediction> {
    if (options.mode === "agent") {
        if (!provider) throw new Error("Native answers require content memory");
        return {
            queryId: query.id,
            query: query.query,
            category: query.category,
            retrieveTimeMs: 0,
            ...(await provider
                .directAnswer(query.query, query.unit, query.timestamp)
                .catch((error: unknown) => {
                    throw providerBlockedError(error) ?? error;
                })),
        };
    }
    const started = performance.now();
    const evidence = provider
        ? await provider.retrieve(query.query, query.unit)
        : bm25Retrieve(documents, query.query, query.unit);
    const retrieveTimeMs = performance.now() - started,
        context = evidence.map((doc) => doc.content).join("\n\n");
    const answer = await generate(
        render(protocol.beamAnswer, { query: query.query, context }),
        { answer: { type: "string" } },
    );
    return {
        queryId: query.id,
        query: query.query,
        category: query.category,
        answer: string(answer.answer),
        context,
        retrieveTimeMs,
        retrievedSourceIds: [
            ...new Set(evidence.flatMap((doc) => doc.sourceIds)),
        ].sort(),
    };
}
function outcomeMetrics(
    results: Status["results"],
    failures: Status["questionFailures"],
    total: number,
) {
    const scored = results.length;
    const blocked = failures.filter(
        (failure) => failure.kind === "provider-blocked",
    ).length;
    const correct = results.filter((result) => result.correct).length;
    return {
        total,
        completed: scored + failures.length,
        scored,
        blocked,
        failed: failures.length - blocked,
        coverage: scored / total,
        correct,
        accuracy: scored ? correct / scored : null,
        accuracyDenominator: "scored-questions",
        correctOverTotal: correct / total,
        meanScore: scored
            ? results.reduce((sum, result) => sum + result.score, 0) / scored
            : null,
    };
}
function summary(status: Status, queries: Query[]) {
    const categories = Object.fromEntries(
        [...new Set(queries.map((query) => query.category))].map((category) => {
            const metrics = outcomeMetrics(
                status.results.filter((result) => result.category === category),
                status.questionFailures.filter(
                    (failure) => failure.category === category,
                ),
                queries.filter((query) => query.category === category).length,
            );
            return [category, { count: metrics.scored, ...metrics }];
        }),
    );
    return {
        ...outcomeMetrics(
            status.results,
            status.questionFailures,
            queries.length,
        ),
        categories,
    };
}
function completedCount(status: Status) {
    return status.results.length + status.questionFailures.length;
}
function lastQuestionFailure(status: Status) {
    const failure = status.questionFailures[status.questionFailures.length - 1];
    return failure
        ? {
              queryId: failure.queryId,
              kind: failure.kind,
              phase: failure.phase,
              error: failure.error,
          }
        : null;
}
async function diskBytes(directory: string): Promise<number> {
    let bytes = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        bytes += entry.isDirectory()
            ? await diskBytes(file)
            : (await stat(file)).size;
    }
    return bytes;
}
function providerBlockedError(error: unknown) {
    if (
        error instanceof Error &&
        error.message === "Model response blocked by content filter"
    )
        return new QuestionError("provider-blocked", error.message);
    return undefined;
}
function validateGenerated(
    value: unknown,
    properties: Record<string, unknown>,
) {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsed.success)
        throw new QuestionError(
            "invalid-response",
            "Model returned a non-object response",
        );
    for (const [key, schema] of Object.entries(properties)) {
        const type = object(schema).type;
        if (!["string", "boolean", "number"].includes(string(type)))
            throw new Error(
                `Unsupported benchmark response type: ${String(type)}`,
            );
        if (
            typeof parsed.data[key] !== type ||
            (type === "number" && !Number.isFinite(parsed.data[key]))
        )
            throw new QuestionError(
                "invalid-response",
                `Model response has invalid ${key}; expected ${String(type)}`,
            );
    }
    return parsed.data;
}
function generateWith(runtime: Runtime): Generate {
    return async (prompt, properties) => {
        let value: unknown;
        try {
            value = await runtime.bridge.execute({
                operation: "generate",
                prompt,
                schema: {
                    type: "object",
                    properties,
                    required: Object.keys(properties),
                    additionalProperties: false,
                },
            });
        } catch (error) {
            if (error instanceof SyntaxError)
                throw new QuestionError("invalid-response", error.message);
            throw providerBlockedError(error) ?? error;
        }
        return validateGenerated(value, properties);
    };
}
async function evaluateQuery(
    options: RunOptions,
    query: Query,
    status: Status,
    predictAnswer: () => Promise<Prediction>,
    protocol: Protocol,
    generate: Generate,
    resultPath: string,
) {
    const started = performance.now();
    let phase: "generation" | "judging" = "generation";
    try {
        const prediction = status.pendingPrediction ?? (await predictAnswer());
        status.pendingPrediction = prediction;
        await saveJson(resultPath, status);
        phase = "judging";
        const scored = await judge(
            query,
            prediction.answer,
            protocol,
            generate,
        );
        const gold = new Set(query.goldIds);
        status.results.push({
            ...prediction,
            ...scored,
            evidenceRecall: gold.size
                ? [...gold].filter((id) =>
                      prediction.retrievedSourceIds.includes(id),
                  ).length / gold.size
                : null,
            evidenceRecallGranularity:
                options.dataset === "beam"
                    ? "conversation-only; not turn coverage"
                    : "session",
            totalSeconds: (performance.now() - started) / 1000,
        });
    } catch (error) {
        if (!(error instanceof QuestionError) || options.signal?.aborted)
            throw error;
        status.questionFailures.push({
            queryId: query.id,
            query: query.query,
            unit: query.unit,
            category: query.category,
            kind: error.kind,
            phase,
            error: error.message,
            at: new Date().toISOString(),
            totalSeconds: (performance.now() - started) / 1000,
            ...(status.pendingPrediction
                ? { prediction: status.pendingPrediction }
                : {}),
        });
        console.error(
            `Benchmark question ${query.id} ${phase} ${error.kind}: ${error.message}`,
        );
    }
    delete status.pendingPrediction;
    await saveJson(resultPath, status);
    await updateProgress(options.progress, {
        activeRun: status.run,
        state: "running",
        activeQuery: null,
        ...outcomeMetrics(
            status.results,
            status.questionFailures,
            list(object(status.manifest).queryIds).length,
        ),
        lastQuestionFailure: lastQuestionFailure(status),
    });
}
async function evaluateUnit(
    options: RunOptions,
    queries: Query[],
    documents: ReturnType<typeof documentsFrom>,
    status: Status,
    provider: MemoryProvider | undefined,
    protocol: Protocol,
    generate: Generate,
    resultPath: string,
) {
    for (const query of queries) {
        if (
            status.results.some((result) => result.queryId === query.id) ||
            status.questionFailures.some(
                (failure) => failure.queryId === query.id,
            )
        )
            continue;
        options.signal?.throwIfAborted();
        await updateProgress(options.progress, {
            activeRun: status.run,
            state: "running",
            activeQuery: query.id,
            completed: completedCount(status),
        });
        if (
            status.pendingPrediction &&
            status.pendingPrediction.queryId !== query.id
        )
            throw new Error("Pending prediction does not match the next query");
        await evaluateQuery(
            options,
            query,
            status,
            () =>
                predict(
                    query,
                    options,
                    provider,
                    documents,
                    protocol,
                    generate,
                ),
            protocol,
            generate,
            resultPath,
        );
    }
}
async function finishRun(
    options: RunOptions,
    status: Status,
    queries: Query[],
    resultPath: string,
    directory: string,
) {
    const report = summary(status, queries);
    Object.assign(status, report, {
        state: status.questionFailures.length
            ? "complete-with-errors"
            : "complete",
        completedAt: new Date().toISOString(),
        diskBytes: await diskBytes(directory),
    });
    await saveJson(resultPath, status);
    await updateProgress(options.progress, {
        activeRun: status.run,
        state: status.state,
        resultPath,
        activeQuery: null,
        ...report,
    });
}
async function inspectRuntime(
    directory: string,
    factory: (store: string) => Promise<Runtime>,
) {
    const temporary = await mkdtemp(path.join(directory, "preflight-"));
    let runtime: Runtime | undefined;
    try {
        runtime = await factory(temporary);
        return object(
            await runtime.bridge.execute({ operation: "capabilities" }),
        );
    } finally {
        try {
            await runtime?.close();
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    }
}

function validateSavedOutcomes(status: Status, queries: Query[]) {
    const outcomes = [...status.results, ...status.questionFailures];
    const ids = new Set(outcomes.map((outcome) => outcome.queryId));
    const selected = new Set(queries.map((query) => query.id));
    if (
        ids.size !== outcomes.length ||
        [...ids].some((id) => !selected.has(id))
    )
        throw new Error(
            "Saved outcomes contain duplicate or unknown query IDs",
        );
}

export async function runStage(
    options: RunOptions,
    dependencies: Dependencies = {},
) {
    validateOptions(options);
    if (options.stage === "suite")
        throw new Error("runStage requires a single stage");
    const run = `${options.dataset}-${options.split}-${options.stage}-${options.provider}-${options.mode}`;
    const directory = path.join(options.output, run),
        resultPath = path.join(directory, "results.json");
    await mkdir(directory, { recursive: true });
    const lockPath = path.join(directory, "run.lock"),
        lock = await open(lockPath, "wx");
    let runtime: Runtime | undefined;
    let status: Status = {
        version: "typeagent-memory-ts-v2",
        run,
        state: "preparing",
        startedAt: new Date().toISOString(),
        results: [],
        questionFailures: [],
    };
    let mayWrite = false;
    try {
        await lock.writeFile(
            JSON.stringify({
                pid: process.pid,
                startedAt: new Date().toISOString(),
            }),
        );
        const saved = await readJson(resultPath);
        mayWrite = saved === undefined;
        if (saved !== undefined) status = statusSchema.parse(saved);
        const protocol = await loadProtocol(options.protocol);
        const data = await loadDataset(
            options.dataset,
            options.split,
            options.cache,
            options.input,
        );
        const queries = selectQueries(
            queriesFor(data.rows),
            options.stage,
            options.unit,
        );
        const units = new Set(queries.map((query) => query.unit));
        const documents = documentsFrom(data.rows, units);
        if (
            new Set(documents.map((doc) => doc.unit)).size !== units.size ||
            new Set(documents.map((doc) => `${doc.unit}:${doc.id}`)).size !==
                documents.length
        )
            throw new Error("Missing or duplicate conversation documents");
        options.signal?.throwIfAborted();
        const factory = dependencies.openRuntime ?? createBenchmarkRuntime;
        const capabilities = await inspectRuntime(directory, factory);
        const benchmark = object(capabilities.benchmark);
        const manifest = {
            ...(await sourceIdentity(options.repo)),
            dataset: options.dataset,
            split: options.split,
            stage: options.stage,
            provider: options.provider,
            mode: options.mode,
            dataSha256: data.hash,
            dataRevision: data.revision,
            protocolSha256: digest(protocol),
            benchmarkModel: string(benchmark.modelId),
            capabilities,
            protocol:
                "AMB prompts/scoring; dated-turn conversion; not Gemini leaderboard parity",
            questionErrorPolicy:
                "v2: terminal provider-blocked/invalid-response outcomes; scored-only accuracy plus coverage; infrastructure failures fatal",
            queryIds: queries.map((query) => query.id),
            documentCount: documents.length,
            turnCount: documents.reduce(
                (sum, doc) => sum + doc.messages.length,
                0,
            ),
        };
        const fingerprint = digest(manifest);
        if (status.fingerprint && status.fingerprint !== fingerprint)
            throw new Error(
                "Run fingerprint changed; choose another output root",
            );
        validateSavedOutcomes(status, queries);
        mayWrite = true;
        runtime = await factory(path.join(directory, "memory"));
        if (status.error) {
            (status.previousFailures ??= []).push({
                at: status.failedAt ?? new Date().toISOString(),
                error: status.error,
            });
            delete status.error;
            delete status.failedAt;
        }
        status.fingerprint = fingerprint;
        status.manifest = manifest;
        await updateProgress(options.progress, {
            activeRun: run,
            state: "indexing",
            resultPath,
            documentCount: documents.length,
            turnCount: manifest.turnCount,
            ...outcomeMetrics(
                status.results,
                status.questionFailures,
                queries.length,
            ),
            lastQuestionFailure: lastQuestionFailure(status),
        });
        const provider =
            options.provider === "bm25"
                ? undefined
                : new MemoryProvider(
                      runtime.bridge,
                      fingerprint,
                      options.provider === "events",
                  );
        await provider?.prepare(directory, units);
        const generate = generateWith(runtime);
        for (const unit of units) {
            options.signal?.throwIfAborted();
            status.state = "indexing";
            await saveJson(resultPath, status);
            const started = performance.now(),
                unitDocuments = documents.filter((doc) => doc.unit === unit);
            await provider?.ingest(unitDocuments);
            const timings = object(status.ingestionSeconds ?? {});
            timings[unit] = (performance.now() - started) / 1000;
            status.ingestionSeconds = timings;
            status.state = "answering";
            await saveJson(resultPath, status);
            await evaluateUnit(
                options,
                queries.filter((query) => query.unit === unit),
                unitDocuments,
                status,
                provider,
                protocol,
                generate,
                resultPath,
            );
        }
        status.state = "settling";
        status.resourceUsage = process.resourceUsage();
        await saveJson(resultPath, status);
        await updateProgress(options.progress, {
            activeRun: run,
            state: "settling",
        });
        await runtime.close();
        runtime = undefined;
        await finishRun(options, status, queries, resultPath, directory);
        return status;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mayWrite) {
            status.state = options.signal?.aborted ? "interrupted" : "failed";
            status.error = message;
            status.failedAt = new Date().toISOString();
            await saveJson(resultPath, status);
        }
        await updateProgress(options.progress, {
            activeRun: run,
            state: "blocked",
            error: message,
            resultPath,
        });
        throw error;
    } finally {
        try {
            await runtime?.close();
        } finally {
            await lock.close();
            await rm(lockPath);
        }
    }
}
export function validateOptions(options: RunOptions) {
    validateDataset(options.dataset, options.split);
    if (options.mode === "agent" && options.provider !== "content")
        throw new Error("Only content memory supports native answers");
    if (options.stage === "suite" && options.input)
        throw new Error("Suite uses pinned downloads; remove --input");
}
export async function run(
    options: RunOptions,
    dependencies: Dependencies = {},
) {
    validateOptions(options);
    await updateProgress(options.progress, {
        licensing: {
            beam: "public-CC-BY-SA-4.0; attribution retained",
        },
    });
    if (options.stage !== "suite") return runStage(options, dependencies);
    for (const split of beamSplits)
        for (const stage of ["smoke", "qualification", "full"] as const)
            for (const [provider, mode] of [
                ["bm25", "rag"],
                ["content", "rag"],
                ["content", "agent"],
                ["events", "rag"],
            ] as const)
                await runStage(
                    { ...options, split, stage, provider, mode },
                    dependencies,
                );
}
