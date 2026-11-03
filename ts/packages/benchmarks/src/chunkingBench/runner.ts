// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
    BenchmarkResponseError,
    createBenchmarkRuntime,
} from "@typeagent/memory-service/benchmark";
import {
    bytesHash,
    digest,
    list,
    object,
    readJson,
    saveJson,
    text,
} from "../memoryBench/storage.js";
import type { Runtime } from "../memoryBench/types.js";
import { validateDataset } from "./datasets.js";
import { chunkDocuments, packContext, scoreContext } from "./scoring.js";
import {
    closeVector,
    lexicalRetriever,
    nativeCandidate,
    reciprocalRankFusion,
    sourceMapSchema,
    vectorRetriever,
    type SourceMap,
} from "./retrievers.js";
import {
    MappingError,
    type Arm,
    type Candidate,
    type Dataset,
    type Question,
    type Strategy,
} from "./types.js";

export interface RunOptions {
    input: string;
    output: string;
    repo: string;
    arms: Arm[];
    budget: number;
    size: number;
    overlap: number;
    strategy: Strategy;
    headers: boolean;
    questions: number;
    candidateLimit: number;
    embeddingTokenLimit: number;
    signal?: AbortSignal;
    progress?: (message: string) => void;
}

const metricsSchema = z.object({
    relevantCharacters: z.number(),
    goldCharacters: z.number(),
    retrievedCharacters: z.number(),
    renderedCharacters: z.number(),
    recall: z.number(),
    precision: z.number(),
    contextPrecision: z.number(),
    f1: z.number(),
    duplicateFraction: z.number(),
    documentRecall: z.number(),
});
const rowSchema = z.object({
    questionId: z.string(),
    groupId: z.string(),
    arm: z.enum(["bm25", "vector", "hybrid", "ordinary", "indexed"]),
    state: z.enum(["scored", "failed"]),
    seconds: z.number(),
    candidateCount: z.number(),
    tokens: z.number().nullable(),
    metrics: metricsSchema.nullable(),
    error: z.string().nullable(),
});
export type Row = z.infer<typeof rowSchema>;
export const nativeStateSchema = z.object({
    fingerprint: z.string(),
    corpusId: z.string(),
    ready: z.boolean(),
    configurationFingerprint: z.string(),
    sources: z.record(z.string(), sourceMapSchema),
});

export function summarize(rows: Row[], arms: Arm[], total: number) {
    return arms.map((arm) => {
        const selected = rows.filter((row) => row.arm === arm);
        const scored = selected.filter(
            (row) => row.state === "scored" && row.metrics,
        );
        const mean = (key: keyof z.infer<typeof metricsSchema>) =>
            scored.length
                ? scored.reduce((sum, row) => sum + row.metrics![key], 0) /
                  scored.length
                : null;
        const sum = (key: keyof z.infer<typeof metricsSchema>) =>
            scored.reduce((n, row) => n + row.metrics![key], 0);
        return {
            arm,
            selected: total,
            completed: selected.length,
            scored: scored.length,
            failed: selected.length - scored.length,
            pending: total - selected.length,
            coverage: scored.length / total,
            macroRecall: mean("recall"),
            macroPrecision: mean("precision"),
            macroContextPrecision: mean("contextPrecision"),
            macroF1: mean("f1"),
            failureInclusiveRecall:
                selected.length === total ? sum("recall") / total : null,
            microRecall: scored.length
                ? sum("relevantCharacters") / sum("goldCharacters")
                : null,
            microPrecision: scored.length
                ? sum("retrievedCharacters")
                    ? sum("relevantCharacters") / sum("retrievedCharacters")
                    : 0
                : null,
        };
    });
}

export async function sourceIdentity(repo: string) {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const files = (await readdir(directory))
        .filter((file) => file.endsWith(".js"))
        .sort();
    return {
        commit: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
            encoding: "utf8",
        }).trim(),
        trackedDiff: bytesHash(
            execFileSync("git", ["-C", repo, "diff", "HEAD", "--", "ts"], {
                maxBuffer: 64 * 1024 * 1024,
            }),
        ),
        adapter: digest(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    bytesHash(await readFile(path.join(directory, file))),
                ]),
            ),
        ),
        bridge: bytesHash(
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

function documentSourceId(id: string) {
    return `doc-${bytesHash(id).slice(0, 40)}`;
}

async function prepareNative(
    dataset: Dataset,
    options: RunOptions,
    fingerprint: string,
    open: (store: string) => Promise<Runtime>,
) {
    const store = path.join(options.output, "store");
    const stateFile = path.join(options.output, "native-state.json");
    let runtime = await open(store);
    try {
        const capabilities = object(
            await runtime.bridge.execute({ operation: "capabilities" }),
        );
        const configurationFingerprint = text(
            object(capabilities.benchmark).configurationFingerprint,
        );
        const previous = await readJson(stateFile);
        const state: z.infer<typeof nativeStateSchema> =
            previous === undefined
                ? {
                      fingerprint,
                      corpusId: text(
                          object(
                              await runtime.bridge.execute({
                                  operation: "createCorpus",
                                  name: `chunking-${dataset.dataset}-${fingerprint.slice(0, 12)}`,
                              }),
                          ).corpusId,
                      ),
                      ready: false,
                      configurationFingerprint,
                      sources: {},
                  }
                : nativeStateSchema.parse(previous);
        if (
            state.fingerprint !== fingerprint ||
            state.configurationFingerprint !== configurationFingerprint
        )
            throw new Error(
                "Native store fingerprint mismatch; choose a fresh output directory",
            );
        await saveJson(stateFile, state);
        await saveJson(
            path.join(options.output, "capabilities.json"),
            capabilities,
        );
        for (const [index, document] of dataset.documents.entries()) {
            options.signal?.throwIfAborted();
            if (state.ready && state.sources[document.id]) {
                validateSourceMap(state.sources[document.id], document.text);
                continue;
            }
            options.progress?.(
                `Importing ${index + 1}/${dataset.documents.length}: ${document.id}`,
            );
            await runtime.bridge.execute({
                operation: "ingest",
                corpusId: state.corpusId,
                sourceId: documentSourceId(document.id),
                title: document.title,
                content: document.text,
            });
            const source = sourceMapSchema.parse(
                await runtime.bridge.execute({
                    operation: "retrievalSource",
                    corpusId: state.corpusId,
                    sourceId: documentSourceId(document.id),
                }),
            );
            validateSourceMap(source, document.text);
            state.sources[document.id] = source;
            await saveJson(stateFile, state);
        }
        await runtime.close();
        runtime = await open(store);
        const corpus = object(
            await runtime.bridge.execute({
                operation: "inspect",
                corpusId: state.corpusId,
            }),
        );
        if (
            corpus.sourceCount !== dataset.documents.length ||
            corpus.readyRevisionCount !== dataset.documents.length ||
            corpus.activeJobCount !== 0
        )
            throw new Error(
                "Reopened corpus is incomplete or has unexpected sources",
            );
        state.ready = true;
        await saveJson(stateFile, state);
        return { runtime, state };
    } catch (error) {
        await runtime.close();
        throw error;
    }
}

export function validateSourceMap(source: SourceMap, content: string) {
    let position = 0;
    for (const block of source.blocks) {
        if (
            block.start !== position ||
            block.end <= block.start ||
            block.end > content.length ||
            bytesHash(content.slice(block.start, block.end)) !== block.sha256
        )
            throw new MappingError(
                "Indexed blocks do not round-trip to canonical text",
            );
        position = block.end;
    }
    if (
        source.contentHash !== bytesHash(content) ||
        source.totalChars !== content.length ||
        position !== content.length
    )
        throw new MappingError("Incomplete source coordinate map");
}

export async function runBenchmark(
    options: RunOptions,
    dependencies: { openRuntime?: (store: string) => Promise<Runtime> } = {},
) {
    validateOptions(options);
    const dataset = validateDataset(await readJson(options.input));
    const documents = new Map(
        dataset.documents.map((document) => [document.id, document]),
    );
    const chunks = chunkDocuments(
        dataset.documents,
        options.size,
        options.overlap,
        options.strategy,
        options.headers,
    );
    const questions = [...dataset.questions]
        .sort((a, b) => bytesHash(a.id).localeCompare(bytesHash(b.id)))
        .slice(0, options.questions || undefined);
    const {
        signal: _signal,
        progress: _progress,
        input: _input,
        output: _output,
        ...configuration
    } = options;
    const manifest = {
        version: "chunking-run-v1",
        protocol: dataset.protocol,
        dataset: dataset.dataset,
        datasetHash: digest(dataset),
        documentCount: documents.size,
        questionIds: questions.map((question) => question.id),
        configuration,
        source: await sourceIdentity(options.repo),
        lexicalProtocol:
            "BM25Okapi-k1=1.5-b=0.75-epsilon=0.25-lowercase-whitespace-no-stopwords",
        scoreProtocol: "unique-source-codepoints-clipped-context-v1",
    };
    const fingerprint = digest(manifest);
    await mkdir(options.output, { recursive: true });
    const manifestFile = path.join(options.output, "manifest.json");
    const existing = await readJson(manifestFile);
    if (existing !== undefined && digest(existing) !== fingerprint)
        throw new Error(
            "Run fingerprint mismatch; choose a fresh output directory",
        );
    await saveJson(manifestFile, manifest);
    await saveJson(path.join(options.output, "dataset.json"), dataset);
    await saveJson(path.join(options.output, "chunks.json"), chunks);
    const rows: Row[] = [];
    let native: Awaited<ReturnType<typeof prepareNative>> | undefined;
    let vector: Awaited<ReturnType<typeof vectorRetriever>> | undefined;
    const scorecard = () => ({
        fingerprint,
        protocol: dataset.protocol,
        dataset: dataset.dataset,
        corpusDocuments: documents.size,
        excludedQuestions: dataset.exclusions.length,
        summary: summarize(rows, options.arms, questions.length),
        rows,
    });
    try {
        const lexical = lexicalRetriever(chunks, documents);
        const needsNative = options.arms.some(
            (arm) => arm === "ordinary" || arm === "indexed",
        );
        const needsVector = options.arms.some(
            (arm) => arm === "vector" || arm === "hybrid",
        );
        if (needsNative) {
            native = await prepareNative(
                dataset,
                options,
                fingerprint,
                dependencies.openRuntime ?? createBenchmarkRuntime,
            );
        }
        if (needsVector) {
            vector = await vectorRetriever(
                chunks,
                documents,
                options.embeddingTokenLimit,
            );
            const identityFile = path.join(
                options.output,
                "embedding-identity.json",
            );
            const identity = {
                identity: vector.identity,
                inputLimit: vector.inputLimit,
                tokenizer:
                    "cl100k_base guard; configured model tokenizer must be qualified separately",
            };
            const previousIdentity = await readJson(identityFile);
            if (
                previousIdentity !== undefined &&
                digest(previousIdentity) !== digest(identity)
            )
                throw new Error(
                    "Embedding identity changed; choose a fresh output directory",
                );
            await saveJson(identityFile, identity);
        }
        for (const question of questions) {
            for (const arm of options.arms) {
                options.signal?.throwIfAborted();
                options.progress?.(
                    `${arm}: ${rows.length + 1}/${questions.length * options.arms.length}`,
                );
                rows.push(
                    await evaluateQuestion(
                        options,
                        fingerprint,
                        question,
                        arm,
                        documents,
                        () =>
                            retrieve(
                                arm,
                                question,
                                options,
                                dataset,
                                lexical,
                                native,
                                vector,
                            ),
                    ),
                );
                await saveJson(
                    path.join(options.output, "scorecard.json"),
                    scorecard(),
                );
            }
        }
        await saveJson(path.join(options.output, "status.json"), {
            state: rows.some((row) => row.state === "failed")
                ? "complete-with-failures"
                : "complete",
            fingerprint,
            updatedAt: new Date().toISOString(),
        });
        return scorecard();
    } catch (error) {
        await saveJson(
            path.join(options.output, "scorecard.json"),
            scorecard(),
        );
        await saveJson(path.join(options.output, "status.json"), {
            state: options.signal?.aborted ? "interrupted" : "failed",
            fingerprint,
            error: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
        });
        throw error;
    } finally {
        await closeVector(vector?.model);
        await native?.runtime.close();
    }
}

async function evaluateQuestion(
    options: RunOptions,
    fingerprint: string,
    question: Question,
    arm: Arm,
    documents: ReadonlyMap<string, Dataset["documents"][number]>,
    fetch: () => ReturnType<typeof retrieve>,
): Promise<Row> {
    const file = path.join(
        options.output,
        "receipts",
        `${arm}-${bytesHash(question.id)}.json`,
    );
    const previous = await readJson(file);
    if (previous !== undefined) {
        const receipt = object(previous);
        if (receipt.fingerprint !== fingerprint)
            throw new Error("Receipt fingerprint mismatch");
        const row = rowSchema.parse(receipt.row);
        if (row.questionId !== question.id || row.arm !== arm)
            throw new Error("Receipt query/arm mismatch");
        return row;
    }
    const started = performance.now();
    let row: Row = {
        questionId: question.id,
        groupId: question.groupId,
        arm,
        state: "scored",
        seconds: 0,
        candidateCount: 0,
        tokens: null,
        metrics: null,
        error: null,
    };
    let evidence: unknown;
    try {
        const retrieved = await fetch();
        const candidates = retrieved.candidates.slice(
            0,
            options.candidateLimit,
        );
        const context = packContext(candidates, documents, options.budget);
        row = {
            ...row,
            candidateCount: candidates.length,
            tokens: context.tokens,
            metrics: scoreContext(question.gold, context, documents),
        };
        evidence = { candidates, context, diagnostics: retrieved.diagnostics };
    } catch (error) {
        if (
            !(error instanceof MappingError) &&
            !(error instanceof BenchmarkResponseError)
        )
            throw error;
        row = { ...row, state: "failed", error: error.message };
        evidence = { failureType: error.name };
        options.progress?.(`FAILED ${arm} ${question.id}: ${error.message}`);
    }
    row.seconds = (performance.now() - started) / 1000;
    await saveJson(file, { fingerprint, row, evidence });
    return row;
}

async function retrieve(
    arm: Arm,
    question: Question,
    options: RunOptions,
    dataset: Dataset,
    lexical: (query: string) => Candidate[],
    native: Awaited<ReturnType<typeof prepareNative>> | undefined,
    vector: Awaited<ReturnType<typeof vectorRetriever>> | undefined,
): Promise<{ candidates: Candidate[]; diagnostics: unknown }> {
    if (arm === "bm25")
        return { candidates: lexical(question.text), diagnostics: null };
    if (arm === "vector" || arm === "hybrid") {
        if (!vector) throw new Error("Vector retriever is unavailable");
        const ranking = await vector.retrieve(question.text);
        return {
            candidates:
                arm === "vector"
                    ? ranking
                    : reciprocalRankFusion(
                          [lexical(question.text), ranking],
                          options.candidateLimit,
                      ),
            diagnostics: null,
        };
    }
    if (!native) throw new Error("Native corpus is unavailable");
    const response = object(
        await native.runtime.bridge.execute({
            operation: "retrievalSearch",
            surface: arm,
            corpusId: native.state.corpusId,
            query: question.text,
            limit: 100,
            maxResponseChars: Math.max(
                50_000,
                dataset.documents.reduce(
                    (sum, document) => sum + document.text.length,
                    0,
                ),
            ),
        }),
    );
    const bySource = new Map(
        dataset.documents.map((document) => [
            documentSourceId(document.id),
            document,
        ]),
    );
    const candidates = list(response.matches).map((value) => {
        const sourceId = text(object(value).sourceId);
        const document = bySource.get(sourceId);
        if (!document)
            throw new MappingError("Evidence escaped the dataset search pool");
        return nativeCandidate(
            value,
            document,
            native.state.sources[document.id],
        );
    });
    return { candidates, diagnostics: response };
}

function validateOptions(options: RunOptions) {
    const relative = path.relative(
        path.resolve(options.repo),
        path.resolve(options.output),
    );
    if (
        !relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative)
    )
        throw new Error("Benchmark output must be outside the source checkout");
    for (const [name, number] of Object.entries({
        budget: options.budget,
        size: options.size,
        candidateLimit: options.candidateLimit,
    }))
        if (!Number.isSafeInteger(number) || number < 1)
            throw new Error(`Invalid ${name}`);
    if (
        !Number.isSafeInteger(options.questions) ||
        options.questions < 0 ||
        !options.arms.length ||
        new Set(options.arms).size !== options.arms.length ||
        options.arms.some(
            (arm) =>
                !["bm25", "vector", "hybrid", "ordinary", "indexed"].includes(
                    arm,
                ),
        )
    )
        throw new Error("Invalid question selection or retrieval arms");
}
