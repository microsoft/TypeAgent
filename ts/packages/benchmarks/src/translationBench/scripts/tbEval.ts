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
    approveTranslationBenchBenchmark,
    formatTranslationBenchBenchmarkJsonl,
    parseTranslationBenchBenchmarkJsonl,
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
    readTranslationBenchCheckpoint,
    rebuildTranslationBenchRunResult,
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

async function main(): Promise<void> {
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
        .option("--concurrency <n>", "default per-model case concurrency", Number)
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
        .option("--reapprove", "force rewrite of the approved artifact")
        .parse();

    const opts = program.opts<{
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
        reapprove?: boolean;
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

    const draftPath = resolveExistingFile(opts.draft, "draft");
    const approvedPath = path.resolve(
        opts.approved ?? defaultApprovedPath(draftPath),
    );
    const outPath = path.resolve(
        opts.out ?? path.join(path.dirname(draftPath), "eval-results.json"),
    );
    const htmlPath = path.resolve(
        opts.html ?? path.join(path.dirname(outPath), "eval-report.html"),
    );
    const checkpointPath = path.resolve(
        opts.checkpoint ??
            path.join(path.dirname(outPath), "eval-checkpoint.jsonl"),
    );

    const configArgs: { config?: string; batch?: string; headroom?: number } =
        { batch: opts.batch };
    if (opts.config !== undefined) configArgs.config = opts.config;
    if (opts.headroom !== undefined) configArgs.headroom = opts.headroom;
    const { resolved } = loadResolvedConfig(configArgs);

    const models = parseCsvList(opts.models) ?? resolved.evalModels;
    if (models.length === 0) {
        throw new Error(
            "No eval models configured. Pass --models or set batches.<batch>.eval.models.",
        );
    }

    if (opts.reapprove === true || !fs.existsSync(approvedPath)) {
        const draft = parseTranslationBenchBenchmarkJsonl(
            fs.readFileSync(draftPath, "utf8"),
            draftPath,
        );
        const approved = approveTranslationBenchBenchmark(draft, {
            reviewedBy: "tb-eval",
            reviewedAt: new Date().toISOString(),
        });
        ensureParentDir(approvedPath);
        fs.writeFileSync(
            approvedPath,
            formatTranslationBenchBenchmarkJsonl(approved),
            "utf8",
        );
        console.log(`approved → ${approvedPath}`);
    } else {
        console.log(`using existing approved → ${approvedPath}`);
    }

    const benchmark = parseTranslationBenchBenchmarkJsonl(
        fs.readFileSync(approvedPath, "utf8"),
        approvedPath,
    );
    let { suite, sourceManifest } = translationBenchBenchmarkToSuite(benchmark);
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

    let seedRows: TranslationBenchRow[] = [];
    let checkpointState:
        | TranslationBenchCheckpoint<TranslationBenchRow>
        | undefined;
    const completed = new Set<string>();

    if (fs.existsSync(checkpointPath) && fs.statSync(checkpointPath).size > 0) {
        const loaded =
            readTranslationBenchCheckpoint<TranslationBenchRow>(
                checkpointPath,
            );
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
        console.log(
            `resuming ${seedRows.length} row(s) from ${checkpointPath}`,
        );
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

    const started = Date.now();
    let result: TranslationBenchRunResult;
    try {
        result = await runTranslationBench(
            suite,
            actionContext,
            runnerOptions,
            (done, total) => {
                if (done === total || done % 25 === 0) {
                    console.log(`progress ${done}/${total}`);
                }
            },
        );
    } finally {
        rateLimiter?.close();
        await closeCommandHandlerContext(handlerContext);
    }

    if (checkpointState !== undefined && checkpointState.rows.length > 0) {
        const fromCheckpoint = rebuildTranslationBenchRunResult(
            checkpointState.rows
                .filter((r) => r.phase === "translation")
                .map((r) => r.value),
            {
                schemaHashes: result.schemaHashes,
                settings: result.settings,
            },
        );
        if (fromCheckpoint.rows.length >= result.rows.length) {
            result = fromCheckpoint;
        }
    }

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
    console.log(
        `done rows=${result.rows.length} pass=${(result.summary.passRate * 100).toFixed(1)}% in ${elapsedSec}s`,
    );
    console.log(`results → ${outPath}`);
    console.log(`report  → ${htmlPath}`);
}

main().catch((error) => {
    console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
});
