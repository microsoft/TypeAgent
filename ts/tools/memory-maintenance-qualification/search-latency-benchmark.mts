// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    appendFile,
    cp,
    mkdir,
    readFile,
    rename,
    writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

type Variant = "search-and-ask" | "find-control" | "understand" | "follow-on";
interface Case {
    id: string;
    corpusId: string;
    question: string;
    understand?: boolean;
    followOn?: string;
}
export interface Span {
    stage: string;
    scope: string;
    elapsedMs: number;
    endEpochMs: number;
    status: string;
    metadata: Record<string, unknown>;
}
export interface ProviderCall {
    kind: "chat" | "embeddings";
    startEpochMs: number;
    elapsedMs: number;
    headersMs?: number;
    status: number | "error";
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedTokens?: number;
    observationError?: string;
}
interface Outcome {
    answer?: unknown;
    status: string;
    evidenceCount: number;
    warningCount: number;
    plannedModules?: number;
    snapshotId?: string;
    turnId?: string;
}
export interface Sample {
    batchId: string;
    caseId: string;
    corpusId: string;
    variant: Variant;
    round: number;
    firstCorpusUse: boolean;
    startedAt: string;
    elapsedMs: number;
    cpuMs: number;
    status: "completed" | "failed";
    outcome?: Outcome;
    errorName?: string;
    spans: Span[];
    providers: ProviderCall[];
    observationErrors: string[];
}

export function answerOutcomeStatus(
    answer: { status?: string } | undefined,
): string {
    return (
        answer?.status ?? (answer ? "answer-returned" : "no-answer-returned")
    );
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readCases(value: unknown): Case[] {
    assert(record(value) && Array.isArray(value.cases), "Expected cases array");
    const ids = new Set<string>();
    return value.cases.map((item: unknown) => {
        assert(record(item), "Invalid case");
        assert(
            typeof item.id === "string" && item.id.length,
            "Missing case id",
        );
        assert(!ids.has(item.id), "Duplicate case id");
        ids.add(item.id);
        assert(typeof item.corpusId === "string" && item.corpusId.length);
        assert(
            typeof item.question === "string" &&
                item.question.trim().length > 0 &&
                item.question.length <= 4000,
            "Invalid question",
        );
        assert(
            item.understand === undefined ||
                typeof item.understand === "boolean",
        );
        assert(
            item.followOn === undefined || typeof item.followOn === "string",
        );
        const result: Case = {
            id: item.id,
            corpusId: item.corpusId,
            question: item.question,
        };
        if (typeof item.understand === "boolean")
            result.understand = item.understand;
        if (typeof item.followOn === "string") result.followOn = item.followOn;
        return result;
    });
}

export function summarize(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
        sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
    return {
        count: sorted.length,
        minMs: sorted[0] ?? null,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: sorted.at(-1) ?? null,
    };
}

export function intervalUnionMs(intervals: [number, number][]): number {
    let total = 0;
    let end = -Infinity;
    for (const [start, finish] of [...intervals].sort((a, b) => a[0] - b[0])) {
        assert(
            Number.isFinite(start) &&
                Number.isFinite(finish) &&
                finish >= start,
        );
        total += Math.max(0, finish - Math.max(start, end));
        end = Math.max(end, finish);
    }
    return total;
}

function timing(line: string): Span {
    const value: unknown = JSON.parse(
        line.slice("[memory-search-timing] ".length),
    );
    assert(record(value), "Invalid timing entry");
    assert(typeof value.stage === "string" && typeof value.scope === "string");
    assert(
        typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs),
    );
    assert(
        typeof value.endEpochMs === "number" &&
            Number.isFinite(value.endEpochMs),
    );
    assert(typeof value.status === "string" && record(value.metadata));
    return {
        stage: value.stage,
        scope: value.scope,
        elapsedMs: value.elapsedMs,
        endEpochMs: value.endEpochMs,
        status: value.status,
        metadata: value.metadata,
    };
}

function providerUsage(value: unknown): Partial<ProviderCall> {
    assert(record(value), "Provider response was not a JSON object");
    const result: Partial<ProviderCall> = {};
    if (typeof value.model === "string") result.model = value.model;
    if (!record(value.usage)) return result;
    const usage = value.usage;
    if (typeof usage.prompt_tokens === "number")
        result.inputTokens = usage.prompt_tokens;
    if (typeof usage.completion_tokens === "number")
        result.outputTokens = usage.completion_tokens;
    if (
        record(usage.completion_tokens_details) &&
        typeof usage.completion_tokens_details.reasoning_tokens === "number"
    )
        result.reasoningTokens =
            usage.completion_tokens_details.reasoning_tokens;
    if (
        record(usage.prompt_tokens_details) &&
        typeof usage.prompt_tokens_details.cached_tokens === "number"
    )
        result.cachedTokens = usage.prompt_tokens_details.cached_tokens;
    return result;
}

function observe(
    context: AsyncLocalStorage<{
        sample: Sample;
        pending: Promise<void>[];
        signal: AbortSignal;
    }>,
) {
    const warn = console.warn;
    const fetch = globalThis.fetch;
    console.warn = (...args: unknown[]) => {
        const active = context.getStore();
        if (
            active &&
            typeof args[0] === "string" &&
            args[0].startsWith("[memory-search-timing] ")
        ) {
            try {
                active.sample.spans.push(timing(args[0]));
            } catch (error) {
                active.sample.observationErrors.push(
                    error instanceof Error ? error.name : "UnknownTimingError",
                );
            }
        } else warn(...args);
    };
    globalThis.fetch = async (input, init) => {
        const active = context.getStore();
        if (!active) return fetch(input, init);
        const url = new URL(
            input instanceof Request ? input.url : String(input),
        );
        const kind = /\/chat\/completions$/.test(url.pathname)
            ? "chat"
            : /\/embeddings$/.test(url.pathname)
              ? "embeddings"
              : undefined;
        const startEpochMs = Date.now();
        const started = performance.now();
        const signals = [active.signal];
        if (init?.signal) signals.push(init.signal);
        if (input instanceof Request) signals.push(input.signal);
        let response: Response;
        try {
            response = await fetch(input, {
                ...init,
                signal: AbortSignal.any(signals),
            });
        } catch (error) {
            if (kind)
                active.sample.providers.push({
                    kind,
                    startEpochMs,
                    elapsedMs: performance.now() - started,
                    status: "error",
                });
            throw error;
        }
        if (kind) {
            const call: ProviderCall = {
                kind,
                startEpochMs,
                headersMs: performance.now() - started,
                elapsedMs: 0,
                status: response.status,
            };
            active.sample.providers.push(call);
            active.pending.push(
                response
                    .clone()
                    .json()
                    .then((body: unknown) => {
                        Object.assign(call, providerUsage(body));
                    })
                    .catch((error: unknown) => {
                        call.observationError =
                            error instanceof Error
                                ? error.name
                                : "UnknownBodyError";
                    })
                    .finally(() => {
                        call.elapsedMs = performance.now() - started;
                    }),
            );
        }
        return response;
    };
    return () => {
        console.warn = warn;
        globalThis.fetch = fetch;
    };
}

function benchmarkOptions() {
    const { values } = parseArgs({
        options: {
            store: { type: "string" },
            out: { type: "string" },
            cases: { type: "string" },
            rounds: { type: "string", default: "3" },
            experiments: { type: "string", default: "" },
            "fast-model": { type: "string" },
            "retain-answers": { type: "boolean", default: false },
            "understanding-rounds": { type: "string", default: "2" },
            paths: {
                type: "string",
                default: "search-and-ask,find-control,understand",
            },
            "allow-model-calls": { type: "boolean", default: false },
        },
    });
    assert(
        values["allow-model-calls"],
        "Live execution requires --allow-model-calls",
    );
    assert(
        values.store && values.out && values.cases,
        "Required: --store, --out, --cases",
    );
    const rounds = Number(values.rounds);
    const understandingRounds = Number(values["understanding-rounds"]);
    assert(
        Number.isInteger(understandingRounds) &&
            understandingRounds >= 0 &&
            understandingRounds <= 3,
        "Understanding rounds must be 0..3",
    );
    const paths = new Set(values.paths.split(","));
    assert(
        paths.size &&
            [...paths].every((item) =>
                ["search-and-ask", "find-control", "understand"].includes(item),
            ),
        "Unknown benchmark path",
    );
    assert(
        Number.isInteger(rounds) && rounds >= 1 && rounds <= 5,
        "Rounds must be 1..5",
    );
    return {
        values: {
            ...values,
            store: values.store,
            out: values.out,
            cases: values.cases,
        },
        rounds,
        understandingRounds,
        paths,
    };
}

async function main() {
    const { values, rounds, understandingRounds, paths } = benchmarkOptions();
    const source = resolve(values.store);
    const output = resolve(values.out);
    const nested = relative(source, output);
    assert(
        nested && (nested.startsWith(`..${sep}`) || isAbsolute(nested)),
        "Output must not be inside the source store",
    );
    const manifestBytes = await readFile(values.cases);
    const cases = readCases(JSON.parse(manifestBytes.toString("utf8")));
    assert(cases.length, "No cases");
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output);
    const memory = resolve(output, "store");
    await cp(source, memory, {
        recursive: true,
        force: false,
        errorOnExist: true,
    });
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const { loadConfigSync } = await import(
        "../../packages/config/dist/index.js"
    );
    const { initRuntimeConfigFromProcessEnv } = await import(
        "../../packages/aiclient/dist/index.js"
    );
    const { runWithSearchTiming } = await import(
        "../../packages/knowPro/dist/index.js"
    );
    const { FileMemoryService } = await import(
        "../../packages/memory/service/dist/fileMemoryService.js"
    );
    const { TypedViewStore } = await import(
        "../../packages/memory/service/dist/viewStore.js"
    );
    const { createMemoryHubQueryFunctions } = await import(
        "../../packages/agents/browser/dist/agent/memoryHubQuery.mjs"
    );
    const { createMemoryHubSynthesizer } = await import(
        "../../packages/agents/browser/dist/agent/memoryHubAnswer.mjs"
    );
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
    const offlineViews = new TypedViewStore(memory);
    for (const corpusId of new Set(cases.map((test) => test.corpusId)))
        await offlineViews.updateKnowledgeState(corpusId, (state) => {
            state.discovery.policy = "off";
        });
    const service = new FileMemoryService(memory, {
        performanceExperiments: values.experiments,
        ...(values["fast-model"]
            ? { fastQueryModelEndpoint: values["fast-model"] }
            : {}),
        understanding: true,
        maintenanceMode: "manual",
        discoveryPolicy: "off",
        sourceSynopses: false,
    });
    const hub = createMemoryHubQueryFunctions(
        () => service,
        () => undefined,
        createMemoryHubSynthesizer(),
    );
    const context = new AsyncLocalStorage<{
        sample: Sample;
        pending: Promise<void>[];
        signal: AbortSignal;
    }>();
    const restore = observe(context);
    const samples: Sample[] = [];
    const seen = new Set<string>();
    const startedAt = new Date().toISOString();
    const compiledDigests: Record<string, string> = {};
    for (const path of [
        "packages/memory/service/dist/integratedAnswer.js",
        "packages/memory/service/dist/fileMemoryService.js",
        "packages/memory/service/dist/understanding.js",
        "packages/memory/service/dist/understandingReader.js",
        "packages/memory/service/dist/memoryPerformanceExperiments.js",
        "packages/memory/service/dist/translationCache.js",
        "packages/memory/service/dist/maintenanceScheduler.js",
        "packages/memory/service/dist/knowProCorpusIndex.js",
        "packages/knowPro/dist/searchTiming.js",
    ])
        compiledDigests[path] = createHash("sha256")
            .update(await readFile(resolve(root, path)))
            .digest("hex");
    const metadata = {
        schemaVersion: 1,
        startedAt,
        gitRevision: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        gitStatus: execFileSync("git", ["status", "--porcelain"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        compiledDigests,
        manifestSha256: createHash("sha256")
            .update(manifestBytes)
            .digest("hex"),
        maintenanceMode: "manual",
        discoveryPolicy: "off",
        discoveryDisabledOnExistingCopy: true,
        sourceSynopses: false,
        originalStoreUntouched: true,
        browserTransportIncluded: false,
        ordering: `Selected paths: rotated Search/Ask rounds, then Find, then ${understandingRounds} Understanding rounds with immediate follow-ons`,
        runnerSha256: createHash("sha256")
            .update(await readFile(fileURLToPath(import.meta.url)))
            .digest("hex"),
        rounds,
        understandingRounds,
        paths: [...paths],
        performanceExperiments: values.experiments,
        fastQueryModelEndpoint: values["fast-model"],
        privateAnswersRetained: values["retain-answers"],
        uniquePrimaryQueries: cases.length,
    };
    async function save(finished = false) {
        const variants = [...new Set(samples.map((sample) => sample.variant))];
        await writeFile(
            resolve(output, "results.json.tmp"),
            JSON.stringify(
                {
                    ...metadata,
                    finished,
                    updatedAt: new Date().toISOString(),
                    summary: variants.map((variant) => {
                        const group = samples.filter(
                            (sample) => sample.variant === variant,
                        );
                        return {
                            variant,
                            all: summarize(
                                group.map((sample) => sample.elapsedMs),
                            ),
                            completed: summarize(
                                group
                                    .filter(
                                        (sample) =>
                                            sample.status === "completed",
                                    )
                                    .map((sample) => sample.elapsedMs),
                            ),
                            failures: group.filter(
                                (sample) => sample.status === "failed",
                            ).length,
                        };
                    }),
                    samples,
                },
                undefined,
                2,
            ),
        );
        await rename(
            resolve(output, "results.json.tmp"),
            resolve(output, "results.json"),
        );
    }
    async function measure(
        test: Case,
        variant: Variant,
        round: number,
        work: () => Promise<Outcome>,
    ) {
        const sample: Sample = {
            batchId: randomUUID(),
            caseId: test.id,
            corpusId: test.corpusId,
            variant,
            round,
            firstCorpusUse: !seen.has(test.corpusId),
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            cpuMs: 0,
            status: "failed",
            spans: [],
            providers: [],
            observationErrors: [],
        };
        seen.add(test.corpusId);
        const pending: Promise<void>[] = [];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180_000);
        const start = performance.now();
        const cpu = process.cpuUsage();
        let outcome: Outcome | undefined;
        try {
            outcome = await context.run(
                { sample, pending, signal: controller.signal },
                () =>
                    runWithSearchTiming(
                        sample.batchId,
                        "latency-benchmark",
                        () => work(),
                        { batchId: sample.batchId },
                    ),
            );
            sample.status = "completed";
            sample.outcome = {
                status: outcome.status,
                evidenceCount: outcome.evidenceCount,
                warningCount: outcome.warningCount,
                ...(outcome.plannedModules === undefined
                    ? {}
                    : { plannedModules: outcome.plannedModules }),
            };
        } catch (error) {
            sample.errorName =
                error instanceof Error ? error.name : "UnknownError";
            console.error(
                `FAILED ${variant}/${test.id}/${round}: ${sample.errorName}`,
            );
        } finally {
            sample.elapsedMs = performance.now() - start;
            const usage = process.cpuUsage(cpu);
            sample.cpuMs = (usage.user + usage.system) / 1000;
            clearTimeout(timeout);
            await Promise.all(pending);
        }
        samples.push(sample);
        if (values["retain-answers"] && outcome?.answer !== undefined)
            await appendFile(
                resolve(output, "answers.jsonl"),
                JSON.stringify({
                    batchId: sample.batchId,
                    caseId: test.id,
                    variant,
                    round,
                    answer: outcome.answer,
                }) + "\n",
            );
        await appendFile(
            resolve(output, "samples.jsonl"),
            JSON.stringify(sample) + "\n",
        );
        await save();
        process.stdout.write(
            `${samples.length}: ${variant}/${test.id}/${round} ${sample.status} ${(sample.elapsedMs / 1000).toFixed(2)}s; ${sample.providers.length} provider calls\n`,
        );
        return outcome;
    }
    async function understand(test: Case, round: number, parent?: Outcome) {
        return measure(
            test,
            parent ? "follow-on" : "understand",
            round,
            async () => {
                const result = await service.understand({
                    corpusId: test.corpusId,
                    question: test.question,
                    ...(parent
                        ? {
                              parentSnapshotId: parent.snapshotId,
                              parentTurnId: parent.turnId,
                          }
                        : {}),
                });
                return {
                    answer: result,
                    status: answerOutcomeStatus(result.answer),
                    evidenceCount: result.citations.length,
                    warningCount: result.warnings.length,
                    plannedModules: result.modules.filter(
                        (module) => module.status === "planned",
                    ).length,
                    snapshotId: result.snapshotId,
                    turnId: result.turnId,
                };
            },
        );
    }
    try {
        await save();
        for (
            let round = 1;
            paths.has("search-and-ask") && round <= rounds;
            round++
        ) {
            const offset = ((round - 1) * 5) % cases.length;
            for (const test of [
                ...cases.slice(offset),
                ...cases.slice(0, offset),
            ]) {
                await measure(test, "search-and-ask", round, async () => {
                    const result = await hub.memoryHubSearch({
                        query: test.question,
                        corpusId: test.corpusId,
                        limit: 50,
                        generateAnswer: true,
                    });
                    assert(!result.errors.length, "Hub returned errors");
                    return {
                        answer: result,
                        status: answerOutcomeStatus(result.answer),
                        evidenceCount: result.matches.length,
                        warningCount: result.warnings.length,
                    };
                });
            }
        }
        for (const test of paths.has("find-control") ? cases : [])
            await measure(test, "find-control", 1, async () => {
                const result = await hub.memoryHubSearch({
                    query: test.question,
                    corpusId: test.corpusId,
                    limit: 50,
                    generateAnswer: false,
                });
                assert(!result.errors.length, "Hub returned errors");
                return {
                    status: "results",
                    evidenceCount: result.matches.length,
                    warningCount: result.warnings.length,
                };
            });
        for (
            let round = 1;
            paths.has("understand") && round <= understandingRounds;
            round++
        )
            for (const test of cases.filter((item) => item.understand)) {
                const parent = await understand(test, round);
                if (test.followOn) {
                    if (!parent?.snapshotId || !parent.turnId) {
                        console.error(
                            `Follow-on skipped for ${test.id}: no successful parent`,
                        );
                        process.exitCode = 1;
                    } else
                        await understand(
                            {
                                ...test,
                                id: `${test.id}-follow-on`,
                                question: test.followOn,
                            },
                            round,
                            parent,
                        );
                }
            }
        await save(true);
        if (
            samples.some(
                (sample) =>
                    sample.status === "failed" ||
                    sample.observationErrors.length ||
                    sample.providers.some((call) => call.observationError),
            )
        )
            process.exitCode = 1;
    } finally {
        restore();
        await service.close();
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    await main();
