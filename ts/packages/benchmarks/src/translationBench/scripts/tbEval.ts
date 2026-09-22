// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Translation-bench evaluation CLI.
 *
 *   node dist/translationBench/scripts/tbEval.js \
 *     --draft ./artifacts/benchmark-draft-1000.jsonl \
 *     --config ./config.json \
 *     --batch eval
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { initRuntimeConfigFromProcessEnv } from "@typeagent/aiclient";
import type { ActionContext } from "@typeagent/agent-sdk";
import {
    getDefaultAppAgentProviders,
    getDefaultDispatcherOptions,
} from "default-agent-provider";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    type CommandHandlerContext,
} from "agent-dispatcher/internal";

import {
    assertTranslationBenchBenchmarkApproved,
    computeTranslationBenchBenchmarkApprovalHash,
    parseTranslationBenchBenchmarkJsonl,
    parseTranslationBenchBenchmarkForEvaluation,
    type TranslationBenchBenchmark,
} from "../synthesizer/benchmark.js";
import { translationBenchBenchmarkToSuite } from "../synthesizer/benchmarkAdapter.js";
import {
    createTranslationBenchReport,
    renderTranslationBenchHtml,
} from "../runner/report.js";
import {
    appendTranslationBenchCheckpointRows,
    createTranslationBenchRunFingerprint,
    createTranslationBenchTranslationCheckpointRow,
    mergeTranslationBenchExecutionCheckpoints,
    readTranslationBenchCheckpoint,
    translationBenchResumeKey,
    type TranslationBenchCheckpoint,
    type TranslationBenchCheckpointHeader,
} from "../runner/scale.js";
import {
    getDefaultTranslationBenchScenario,
    runTranslationBench,
    type TranslationBenchRow,
    type TranslationBenchRunResult,
    type TranslationBenchRunnerOptions,
    type TranslationBenchScenario,
    type TranslationBenchSuite,
    type TranslationBenchSuiteSourceIndex,
} from "../runner/runner.js";
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

function writeLine(message: string): void {
    process.stdout.write(`${message}\n`);
}

function defaultApprovedPath(draftPath: string): string {
    const dir = path.dirname(draftPath);
    const base = path.basename(draftPath);
    const approved = base.includes("-draft")
        ? base.replace("-draft", "-approved")
        : base.replace(/\.jsonl$/i, "-approved.jsonl");
    return path.join(dir, approved);
}

function createHeadlessActionContext(
    context: CommandHandlerContext,
): ActionContext<CommandHandlerContext> {
    const noopIO = {
        setDisplay() {},
        appendDisplay() {},
        takeAction() {},
        appendDiagnosticData() {},
    };
    return {
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
    } as unknown as ActionContext<CommandHandlerContext>;
}

function parseEvalOptions(): TbEvalOptions {
    const program = new Command()
        .name("tb-eval")
        .description(
            "Evaluate a translation-bench benchmark jsonl with checkpoint resume",
        )
        .requiredOption("--draft <file>", "benchmark draft jsonl")
        .option(
            "--approved <file>",
            "approved benchmark jsonl (default: derived from --draft)",
        )
        .option(
            "--out <file>",
            "eval-results.json (default: <draft-dir>/eval-results.json)",
        )
        .option(
            "--html <file>",
            "eval-report.html (default: <out-dir>/eval-report.html)",
        )
        .option(
            "--checkpoint <file>",
            "append-only checkpoint jsonl (default: <out-dir>/eval-checkpoint.jsonl)",
        )
        .option("--config <file>", "run config JSON (config.schema.json)")
        .option("--batch <name>", "named batch profile", "eval")
        .option("--models <ids>", "comma-separated model override")
        .option("--headroom <n>", "TPM headroom override", Number)
        .option(
            "--concurrency <n>",
            "default per-model case concurrency",
            Number,
        )
        .option(
            "--model-concurrency <n>",
            "models evaluated in parallel",
            Number,
        )
        .option("--max-cases <n>", "limit cases (smoke)", Number)
        .option("--env-file <file...>", "optional dotenv files")
        .option(
            "--instance-dir <dir>",
            "directory for default agent provider discovery",
            defaultInstanceDir("eval"),
        )
        .option("--rate-limiter-db <file>", "shared TPM sqlite path")
        .option("--no-rate-limit", "disable TPM limiter")
        .parse();

    return program.opts<TbEvalOptions>();
}

function prepareEvalPaths(opts: TbEvalOptions): {
    draftPath: string;
    approvedPath: string;
    outPath: string;
    checkpointPath: string;
} {
    const draftPath = resolveExistingFile(opts.draft, "draft");
    const approvedPath = path.resolve(
        opts.approved ?? defaultApprovedPath(draftPath),
    );
    const outPath = path.resolve(
        opts.out ?? path.join(path.dirname(draftPath), "eval-results.json"),
    );
    const checkpointPath = path.resolve(
        opts.checkpoint ??
            path.join(path.dirname(outPath), "eval-checkpoint.jsonl"),
    );
    return { draftPath, approvedPath, outPath, checkpointPath };
}

async function prepareEvalRun(opts: TbEvalOptions): Promise<TbEvalRunInputs> {
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

    const { draftPath, approvedPath, outPath, checkpointPath } =
        prepareEvalPaths(opts);
    const htmlPath = path.resolve(
        opts.html ?? path.join(path.dirname(outPath), "eval-report.html"),
    );

    const configArgs: { config?: string; batch?: string; headroom?: number } = {
        batch: opts.batch,
    };
    if (opts.config !== undefined) configArgs.config = opts.config;
    if (opts.headroom !== undefined) configArgs.headroom = opts.headroom;
    const { resolved } = loadResolvedConfig(configArgs);

    const models = parseCsvList(opts.models) ?? resolved.evalModels;
    if (models.length === 0) {
        throw new Error(
            "No eval models configured. Pass --models or set batches.<batch>.eval.models.",
        );
    }

    // Eval never mints approval. Operators approve drafts out-of-band; the
    // approved artifact is the sole eval input (draft is used for drift check).
    if (!fs.existsSync(approvedPath)) {
        throw new Error(
            `Approved benchmark not found: ${approvedPath}. ` +
                `Approve the draft first (do not auto-approve from tb-eval).`,
        );
    }
    const draft = parseTranslationBenchBenchmarkJsonl(
        fs.readFileSync(draftPath, "utf8"),
        draftPath,
    );
    const benchmark = parseTranslationBenchBenchmarkForEvaluation(
        fs.readFileSync(approvedPath, "utf8"),
        approvedPath,
    );
    assertTranslationBenchBenchmarkApproved(benchmark);
    // Content identity ignores approval stamps so draft vs approved compare
    // cases/metadata only (see benchmarkApprovalPayload draft branch).
    const contentIdentity = (bench: typeof draft): string => {
        const clone = structuredClone(bench);
        clone.metadata.approval = { status: "draft" };
        return computeTranslationBenchBenchmarkApprovalHash(clone);
    };
    if (contentIdentity(draft) !== contentIdentity(benchmark)) {
        throw new Error(
            `Draft ${draftPath} does not match approved ${approvedPath} ` +
                `(case/metadata drift). Re-approve the draft before eval.`,
        );
    }
    writeLine(`using approved → ${approvedPath}`);

    const converted = translationBenchBenchmarkToSuite(benchmark);
    let { suite } = converted;
    const { sourceManifest } = converted;
    if (resolved.caseOrder !== undefined) {
        suite = {
            ...suite,
            cases: suite.cases.filter(
                (testCase) => testCase.seed.order === resolved.caseOrder,
            ),
        };
    }
    const maxCases = opts.maxCases ?? resolved.maxCases;
    if (maxCases !== undefined) {
        suite = {
            ...suite,
            cases: suite.cases.slice(0, Math.max(0, maxCases)),
        };
    }

    const scenarios = suite.scenarios ?? [getDefaultTranslationBenchScenario()];
    const checkpointSettings = {
        kind: "translation-bench-eval",
        models: [...models],
        scenarios: scenarios.map((s) => s.id),
        suiteCaseCount: suite.cases.length,
        sourceManifest,
        // Content identity — gold/utterance edits must invalidate resume.
        benchmarkHash:
            benchmark.metadata.approval.status === "approved"
                ? benchmark.metadata.approval.benchmarkHash
                : contentIdentity(benchmark),
    };
    const checkpointHeader: TranslationBenchCheckpointHeader = {
        kind: "translation-bench-checkpoint",
        version: 1,
        runFingerprint: createTranslationBenchRunFingerprint({
            settings: checkpointSettings,
        }),
        settings: checkpointSettings,
        shardIndex: 0,
        shardCount: 1,
    };

    const seedRows: TranslationBenchRow[] = [];
    let checkpointState:
        | TranslationBenchCheckpoint<TranslationBenchRow>
        | undefined;
    const completed = new Set<string>();

    if (fs.existsSync(checkpointPath) && fs.statSync(checkpointPath).size > 0) {
        const loaded =
            readTranslationBenchCheckpoint<TranslationBenchRow>(checkpointPath);
        if (loaded.header.runFingerprint !== checkpointHeader.runFingerprint) {
            throw new Error(
                `Checkpoint fingerprint mismatch at ${checkpointPath}. ` +
                    `Delete it or pass matching --models/--max-cases/--draft.`,
            );
        }
        checkpointState = loaded;
        for (const row of loaded.rows) {
            if (row.phase !== "translation") continue;
            seedRows.push(row.value);
            completed.add(translationBenchResumeKey(row));
        }
        writeLine(`resuming ${seedRows.length} row(s) from ${checkpointPath}`);
    }

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
        "translation-bench-eval",
        {
            ...getDefaultDispatcherOptions(),
            appAgentProviders: getDefaultAppAgentProviders(opts.instanceDir),
            explanationAsynchronousMode: false,
            persistSession: false,
            metrics: false,
            explainer: { enabled: false },
        },
    );
    const actionContext = createHeadlessActionContext(handlerContext);

    const runnerOptions: TranslationBenchRunnerOptions = {
        models,
        scenarios,
        sourceManifest,
        concurrencyByModel: resolved.concurrencyByModel,
        modelConcurrency: opts.modelConcurrency ?? resolved.modelConcurrency,
        seedRows,
        isWorkComplete: ({ model, scenarioId, caseId }) =>
            completed.has(
                translationBenchResumeKey({
                    phase: "translation",
                    model,
                    scenario: scenarioId,
                    caseId,
                }),
            ),
        onRowComplete: async (row) => {
            const ckptRow = createTranslationBenchTranslationCheckpointRow(row);
            checkpointState = appendTranslationBenchCheckpointRows(
                checkpointPath,
                checkpointHeader,
                [ckptRow],
                checkpointState,
            );
            completed.add(translationBenchResumeKey(ckptRow));
        },
    };
    if (opts.concurrency !== undefined) {
        runnerOptions.concurrency = opts.concurrency;
    }
    if (rateLimiter !== undefined) {
        runnerOptions.rateLimiter = rateLimiter;
    }

    const onProgress = (done: number, total: number) => {
        if (done === total || done % 25 === 0) {
            writeLine(`progress ${done}/${total}`);
        }
    };

    return {
        suite,
        benchmark,
        models,
        scenarios,
        sourceManifest,
        seedRows,
        completed,
        checkpointState,
        checkpointHeader,
        checkpointPath,
        outPath,
        htmlPath,
        rateLimiter,
        resolved,
        actionContext,
        handlerContext,
        onProgress,
    };
}

interface TbEvalOptions {
    draft: string;
    approved?: string;
    out?: string;
    html?: string;
    checkpoint?: string;
    config?: string;
    batch: string;
    models?: string;
    headroom?: number;
    concurrency?: number;
    modelConcurrency?: number;
    maxCases?: number;
    envFile?: string[];
    instanceDir: string;
    rateLimiterDb?: string;
    rateLimit?: boolean;
}

interface TbEvalRunInputs {
    suite: TranslationBenchSuite;
    benchmark: TranslationBenchBenchmark;
    models: string[];
    scenarios: TranslationBenchScenario[];
    sourceManifest: TranslationBenchSuiteSourceIndex;
    seedRows: TranslationBenchRow[];
    completed: Set<string>;
    checkpointState:
        | TranslationBenchCheckpoint<TranslationBenchRow>
        | undefined;
    checkpointHeader: TranslationBenchCheckpointHeader;
    checkpointPath: string;
    outPath: string;
    htmlPath: string;
    rateLimiter: ReturnType<typeof createRunnerRateLimiter>;
    resolved: ReturnType<typeof loadResolvedConfig>["resolved"];
    actionContext: ActionContext<CommandHandlerContext>;
    handlerContext: CommandHandlerContext;
    onProgress: (done: number, total: number) => void;
}

async function executeEval(
    opts: TbEvalOptions,
    inputs: TbEvalRunInputs,
): Promise<TranslationBenchRunResult> {
    const {
        suite,
        benchmark,
        models,
        completed,
        checkpointState: initialCheckpointState,
        checkpointHeader,
        checkpointPath,
        rateLimiter,
        actionContext,
        handlerContext,
        onProgress,
    } = inputs;

    // Openai gateway (e.g. LiteLLM): the requested model id is carried by
    // OPENAI_MODEL, a process-global that runtime-config reads at init, and the
    // ids are gateway routes rather than typed-config entries. So run each
    // model sequentially with its own runtime config and trust the requested
    // name instead of discovery-based validation. The shared checkpoint and TPM
    // ledger make this transparent; per-model case concurrency still applies.
    const useGateway =
        process.env.TYPEAGENT_MODEL_PROVIDER === "openai" &&
        process.env.OPENAI_ENDPOINT !== undefined;

    const started = Date.now();
    let checkpointState = initialCheckpointState;
    let result: TranslationBenchRunResult;
    try {
        const runnerOptions: TranslationBenchRunnerOptions = {
            models,
            scenarios: inputs.scenarios,
            sourceManifest: inputs.sourceManifest,
            concurrencyByModel: inputs.resolved.concurrencyByModel,
            modelConcurrency:
                opts.modelConcurrency ?? inputs.resolved.modelConcurrency,
            seedRows: inputs.seedRows,
            isWorkComplete: ({ model, scenarioId, caseId }) =>
                completed.has(
                    translationBenchResumeKey({
                        phase: "translation",
                        model,
                        scenario: scenarioId,
                        caseId,
                    }),
                ),
            onRowComplete: async (row) => {
                const ckptRow =
                    createTranslationBenchTranslationCheckpointRow(row);
                checkpointState = appendTranslationBenchCheckpointRows(
                    checkpointPath,
                    checkpointHeader,
                    [ckptRow],
                    checkpointState,
                );
                completed.add(translationBenchResumeKey(ckptRow));
            },
        };
        if (opts.concurrency !== undefined) {
            runnerOptions.concurrency = opts.concurrency;
        }
        if (rateLimiter !== undefined) {
            runnerOptions.rateLimiter = rateLimiter;
        }
        if (useGateway) {
            let last: TranslationBenchRunResult | undefined;
            for (const model of models) {
                writeLine(`=== ${model} ===`);
                process.env.OPENAI_MODEL = model;
                initRuntimeConfigFromProcessEnv();
                last = await runTranslationBench(
                    suite,
                    actionContext,
                    {
                        ...runnerOptions,
                        models: [model],
                        availableModels: [model],
                        modelConcurrency: 1,
                    },
                    onProgress,
                );
            }
            // Every model's rows live in the shared checkpoint; `last` only
            // supplies schemaHashes/settings for the rebuild below.
            result = {
                ...last!,
                settings: {
                    ...last!.settings,
                    models: [...models],
                },
            };
        } else {
            result = await runTranslationBench(
                suite,
                actionContext,
                runnerOptions,
                onProgress,
            );
        }
    } finally {
        rateLimiter?.close();
        await closeCommandHandlerContext(handlerContext);
    }

    if (checkpointState !== undefined && checkpointState.rows.length > 0) {
        const fromCheckpoint = mergeTranslationBenchExecutionCheckpoints(
            [checkpointState],
            {
                schemaHashes: result.schemaHashes,
                settings: result.settings,
            },
        ).runResult;
        if (fromCheckpoint.rows.length >= result.rows.length) {
            result = fromCheckpoint;
        }
    }

    const { outPath, htmlPath } = inputs;
    ensureParentDir(outPath);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    ensureParentDir(htmlPath);
    fs.writeFileSync(
        htmlPath,
        renderTranslationBenchHtml(
            createTranslationBenchReport(suite, result, [], benchmark),
        ),
        "utf8",
    );

    const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
    writeLine(
        `done rows=${result.rows.length} pass=${(result.summary.passRate * 100).toFixed(1)}% in ${elapsedSec}s`,
    );
    writeLine(`results → ${outPath}`);
    writeLine(`report  → ${htmlPath}`);
    return result;
}

async function main(): Promise<void> {
    const opts = parseEvalOptions();
    const inputs = await prepareEvalRun(opts);
    await executeEval(opts, inputs);
}

main().catch((error) => {
    console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
});
