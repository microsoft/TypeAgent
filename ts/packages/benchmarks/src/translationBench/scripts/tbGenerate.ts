// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Translation-bench draft generation CLI.
 *
 *   node dist/translationBench/scripts/tbGenerate.js \
 *     --source ./source/anchors.jsonl \
 *     --manifest ./source/source-manifest.json \
 *     --out ./artifacts/benchmark-draft-1000.jsonl \
 *     --config ./config.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import {
    initRuntimeConfigFromProcessEnv,
    openai as ai,
    type CompletionJsonSchema,
} from "@typeagent/aiclient";
import {
    getDefaultAppAgentProviders,
    getDefaultDispatcherOptions,
} from "default-agent-provider";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    translateRequest,
    type CommandHandlerContext,
} from "agent-dispatcher/internal";

import type { RateLimiter } from "../../core/rateLimiter.js";
import { estimatePromptTokens } from "../../core/tokenEstimate.js";
import {
    TRANSLATION_BENCH_DEFAULT_AMBIGUITY_PROBE_MODELS,
    type TranslationBenchAmbiguityProbeRequest,
    type TranslationBenchAmbiguityProbeTranslator,
} from "../synthesizer/ambiguityProbe.js";
import { formatTranslationBenchBenchmarkJsonl } from "../synthesizer/benchmark.js";
import {
    generateTranslationBenchBenchmark,
    type TranslationBenchGenerationLlm,
} from "../synthesizer/datasetGenerator.js";
import type { TranslationBenchSourceManifest } from "../synthesizer/sourceAdapter.js";
import {
    createRunnerRateLimiter,
    defaultInstanceDir,
    ensureParentDir,
    loadDotEnvFiles,
    loadResolvedConfig,
    parseCsvList,
    resolveExistingFile,
} from "./cliShared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

function isTransientRouteError(message: string): boolean {
    const lower = message.toLowerCase();
    if (
        message.includes("404") &&
        /not found|resource|deployment/i.test(message)
    ) {
        return true;
    }
    if (
        /\b429\b/.test(message) ||
        /rate limit|throttl|too many requests/i.test(lower)
    ) {
        return true;
    }
    if (
        /fetch failed|network|econnreset|etimedout|socket hang up|no response/i.test(
            lower,
        )
    ) {
        return true;
    }
    return false;
}

function createOpenAISettings(modelName: string) {
    return {
        provider: "openai" as const,
        modelType: "chat" as const,
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: process.env.OPENAI_ENDPOINT,
        modelName,
        supportsResponseFormat: true,
        maxConcurrency: 8,
        timeout: 180_000,
        maxRetryAttempts: 3,
    };
}

function createGenerationLlm(
    modelName: string,
    role: "generator" | "reviewer",
    rateLimiter: RateLimiter | undefined,
): TranslationBenchGenerationLlm {
    const model = ai.createChatModel(
        createOpenAISettings(modelName) as never,
        {
            response_format: { type: "json_object" },
            temperature: 1,
        },
        undefined,
        [`translation-bench-${role}`],
    );

    return {
        model: modelName,
        async complete(prompt: string, jsonSchema?: CompletionJsonSchema) {
            const estimate = estimatePromptTokens(prompt);
            const invoke = async (): Promise<{
                text: string;
                totalTokens: number;
            }> => {
                let lastMessage = "unknown failure";
                for (let attempt = 1; attempt <= 5; attempt++) {
                    let promptTokens = 0;
                    let completionTokens = 0;
                    const result = await model.complete(
                        prompt,
                        (usage) => {
                            promptTokens += usage.prompt_tokens ?? 0;
                            completionTokens += usage.completion_tokens ?? 0;
                        },
                        jsonSchema,
                    );
                    if (result.success) {
                        const content =
                            typeof result.data === "string"
                                ? result.data
                                : String(result.data ?? "");
                        return {
                            text: content,
                            totalTokens:
                                promptTokens + completionTokens || estimate,
                        };
                    }
                    lastMessage = result.message ?? "model complete failed";
                    if (!isTransientRouteError(lastMessage) || attempt === 5) {
                        throw new Error(
                            `Translation-bench ${role} model failed: ${lastMessage}`,
                        );
                    }
                    const waitMs =
                        400 * attempt + Math.floor(Math.random() * 400);
                    await new Promise((r) => setTimeout(r, waitMs));
                }
                throw new Error(
                    `Translation-bench ${role} model failed: ${lastMessage}`,
                );
            };

            if (rateLimiter === undefined) {
                const result = await invoke();
                return result.text;
            }
            return rateLimiter.run(modelName, estimate, async () => {
                const result = await invoke();
                return {
                    result: result.text,
                    actualTokens: result.totalTokens,
                };
            });
        },
    };
}

function createAmbiguityProbeTranslator(
    context: CommandHandlerContext,
    models: readonly string[],
): TranslationBenchAmbiguityProbeTranslator {
    const noopIO = {
        setDisplay() {},
        appendDisplay() {},
        takeAction() {},
        appendDiagnosticData() {},
    };
    // Serialize model swaps on the shared session — parallel probes must not
    // clobber each other's translation.model or leave a residual config.
    let modelGate: Promise<void> = Promise.resolve();
    const withModel = async <T>(model: string, fn: () => Promise<T>): Promise<T> => {
        const prior = modelGate;
        let release!: () => void;
        modelGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await prior;
        const priorConfig = context.session.getConfig();
        context.session.updateConfig({
            translation: {
                ...priorConfig.translation,
                model,
            },
        });
        try {
            return await fn();
        } finally {
            context.session.updateConfig({
                translation: priorConfig.translation,
            });
            release();
        }
    };
    return {
        models,
        async translate(request: TranslationBenchAmbiguityProbeRequest) {
            return withModel(request.model, async () => {
                const actionContext = {
                    streamingContext: undefined,
                    activityContext: undefined,
                    actionIO: noopIO,
                    sessionContext: {
                        agentContext: context,
                        sessionStorage: undefined,
                        instanceStorage: undefined,
                        notify() {},
                        addAgentNameTag: false,
                    },
                    queuedToggleTransientAgent: async () => {},
                };
                try {
                    const translated = await translateRequest(
                        actionContext as never,
                        request.utterance,
                        undefined,
                        undefined,
                        undefined,
                        [...request.activeSchemas],
                    );
                    return {
                        model: request.model,
                        actions: translated.requestAction.actions.map(
                            (entry) => ({
                                schemaName: entry.action.schemaName,
                                actionName: entry.action.actionName,
                                ...(entry.action.parameters !== undefined
                                    ? {
                                          parameters: entry.action
                                              .parameters as Record<
                                              string,
                                              unknown
                                          >,
                                      }
                                    : {}),
                            }),
                        ),
                    };
                } catch (error) {
                    return {
                        model: request.model,
                        actions: [],
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
            });
        },
    };
}

async function main(): Promise<void> {
    const program = new Command()
        .name("tb-generate")
        .description("Synthesize a translation-bench draft benchmark jsonl")
        .requiredOption("--source <file>", "frozen source pool jsonl")
        .requiredOption("--manifest <file>", "frozen source manifest json")
        .option("--out <file>", "draft jsonl output path")
        .option("--checkpoint <file>", "generation checkpoint jsonl")
        .option("--config <file>", "run config JSON")
        .option("--batch <name>", "named batch profile", "synthesizer")
        .option("--name <id>", "benchmark metadata name", "translation-bench")
        .option("--case-count <n>", "target case count", Number)
        .option("--gen-cases <n>", "gen cases per row (even)", Number)
        .option("--max-attempts <n>", "quality-loop attempts", Number)
        .option("--concurrency <n>", "generation concurrency", Number)
        .option("--generator-model <id>", "generator model override")
        .option("--reviewer-model <id>", "reviewer model override")
        .option(
            "--probe-models <ids>",
            "comma-separated ambiguity probe models",
        )
        .option("--env-file <file...>", "optional dotenv files")
        .option(
            "--instance-dir <dir>",
            "directory for default agent provider discovery",
            defaultInstanceDir("generate"),
        )
        .option("--rate-limiter-db <file>", "shared TPM sqlite path")
        .option("--no-rate-limit", "disable TPM limiter")
        .option("--resume", "resume from an existing checkpoint")
        .option(
            "--require-complete-coverage",
            "fail if target case count / coverage is incomplete",
        )
        .parse();

    const opts = program.opts<{
        source: string;
        manifest: string;
        out?: string;
        checkpoint?: string;
        config?: string;
        batch: string;
        name: string;
        caseCount?: number;
        genCases?: number;
        maxAttempts?: number;
        concurrency?: number;
        generatorModel?: string;
        reviewerModel?: string;
        probeModels?: string;
        envFile?: string[];
        instanceDir: string;
        rateLimiterDb?: string;
        rateLimit?: boolean;
        resume?: boolean;
        requireCompleteCoverage?: boolean;
    }>();

    loadDotEnvFiles([
        path.join(PACKAGE_ROOT, ".env"),
        path.join(PACKAGE_ROOT, ".env.real"),
        path.join(process.cwd(), ".env"),
        path.join(process.cwd(), ".env.real"),
        ...(opts.envFile ?? []),
    ]);
    initRuntimeConfigFromProcessEnv();
    if (process.env.OPENAI_MODEL === undefined) {
        process.env.OPENAI_MODEL = "azure/gpt-4.1";
    }

    const sourcePath = resolveExistingFile(opts.source, "source");
    const manifestPath = resolveExistingFile(opts.manifest, "manifest");
    const configArgs: { config?: string; batch?: string } = {
        batch: opts.batch,
    };
    if (opts.config !== undefined) configArgs.config = opts.config;
    const { resolved } = loadResolvedConfig(configArgs);

    const caseCount = opts.caseCount ?? resolved.caseCount;
    const outPath = path.resolve(
        opts.out ??
            path.join(
                process.cwd(),
                "artifacts",
                `benchmark-draft-${caseCount}.jsonl`,
            ),
    );
    const checkpointPath = path.resolve(
        opts.checkpoint ??
            path.join(
                path.dirname(outPath),
                `generate-checkpoint-${caseCount}.jsonl`,
            ),
    );

    const generatorModel = opts.generatorModel ?? resolved.generatorModel;
    const reviewerModel = opts.reviewerModel ?? resolved.reviewerModel;
    const probeModels =
        parseCsvList(opts.probeModels) ??
        [...TRANSLATION_BENCH_DEFAULT_AMBIGUITY_PROBE_MODELS];

    const limiterArgs: { dbPath?: string; disabled?: boolean } = {
        disabled: opts.rateLimit === false,
    };
    if (opts.rateLimiterDb !== undefined) {
        limiterArgs.dbPath = opts.rateLimiterDb;
    }
    const rateLimiter = createRunnerRateLimiter(
        resolved.tpmLimits,
        limiterArgs,
    );

    fs.mkdirSync(opts.instanceDir, { recursive: true });
    const handlerContext = await initializeCommandHandlerContext(
        "translation-bench-generate",
        {
            ...getDefaultDispatcherOptions(),
            appAgentProviders: getDefaultAppAgentProviders(opts.instanceDir),
            explanationAsynchronousMode: false,
            persistSession: false,
            metrics: false,
            explainer: { enabled: false },
        },
    );

    try {
        const sourceText = fs.readFileSync(sourcePath, "utf8");
        const sourceManifest = JSON.parse(
            fs.readFileSync(manifestPath, "utf8"),
        ) as TranslationBenchSourceManifest;

        console.log(
            `generate name=${opts.name} caseCount=${caseCount} generator=${generatorModel} reviewer=${reviewerModel}`,
        );

        const { benchmark, coverage } = await generateTranslationBenchBenchmark(
            {
                name: opts.name,
                sourceText,
                sourceManifest,
                provider: handlerContext.agents,
                caseCount,
                genCaseCount: opts.genCases ?? resolved.genCases,
                maxAttempts: opts.maxAttempts ?? resolved.maxAttempts,
                concurrency: opts.concurrency ?? resolved.genConcurrency,
                requireCompleteCoverage: opts.requireCompleteCoverage === true,
                generator: createGenerationLlm(
                    generatorModel,
                    "generator",
                    rateLimiter,
                ),
                reviewer: createGenerationLlm(
                    reviewerModel,
                    "reviewer",
                    rateLimiter,
                ),
                ambiguityProbe: createAmbiguityProbeTranslator(
                    handlerContext,
                    probeModels,
                ),
                checkpointPath,
                resume: opts.resume === true,
                onProgress: (done, total) => {
                    if (done === total || done % 10 === 0) {
                        console.log(`progress ${done}/${total}`);
                    }
                },
            },
        );

        ensureParentDir(outPath);
        fs.writeFileSync(
            outPath,
            formatTranslationBenchBenchmarkJsonl(benchmark),
            "utf8",
        );
        console.log(
            `draft → ${outPath} cases=${benchmark.cases.length} coverageComplete=${coverage.complete}`,
        );
    } finally {
        rateLimiter?.close();
        await closeCommandHandlerContext(handlerContext);
    }
}

main().catch((error) => {
    console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
});
