// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Seal-Tools translation-bench runner.
 *
 * Builds a suite directly from `seal-tools-validation.jsonl` (each row keeps
 * its own candidate tools) and evaluates it across every model in the run
 * config, honoring per-model concurrency and a shared TPM rate limiter.
 *
 * From `ts/packages/benchmarks`:
 *   pnpm run build
 *   node dist/translationBench/public_datasets/Seal-Tools/eval/runEval.js
 *
 * Flags: --models <csv> --max-cases <n> --config <file> --out-dir <dir>
 *        --model-concurrency <n> --no-rate-limit --env-file <file...>
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
    createTranslationBenchReport,
    renderTranslationBenchHtml,
} from "../../../runner/report.js";
import {
    appendTranslationBenchCheckpointRows,
    createTranslationBenchRunFingerprint,
    createTranslationBenchTranslationCheckpointRow,
    readTranslationBenchCheckpoint,
    rebuildTranslationBenchRunResult,
    translationBenchResumeKey,
    type TranslationBenchCheckpoint,
    type TranslationBenchCheckpointHeader,
} from "../../../runner/scale.js";
import {
    getDefaultTranslationBenchScenario,
    runTranslationBench,
    type TranslationBenchRow,
    type TranslationBenchRunResult,
    type TranslationBenchRunnerOptions,
    type TranslationBenchScenario,
} from "../../../runner/runner.js";
import {
    createRunnerRateLimiter,
    defaultInstanceDir,
    ensureParentDir,
    loadDotEnvFiles,
    loadResolvedConfig,
    parseCsvList,
} from "../../../scripts/cliShared.js";
import { DATASET_NAME, type TypeAgentEvalRow } from "../toTypeAgentSchema.js";
import { buildSealToolsSuite } from "./buildSuite.js";
import {
    scoreSealToolsOfficial,
    type SealToolsOfficialScore,
} from "./sealToolsGrader.js";
import type { SealToolsGoldAction } from "../toTypeAgentSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/translationBench/public_datasets/Seal-Tools/eval -> package root.
const PACKAGE_ROOT = path.resolve(__dirname, "../../../../..");
const SEAL_DIR = path.join(
    PACKAGE_ROOT,
    "src/translationBench/public_datasets/Seal-Tools",
);
const DEFAULT_CONFIG = path.join(SEAL_DIR, "eval", "run-config.json");
const DEFAULT_DATASET = path.join(SEAL_DIR, `${DATASET_NAME}.jsonl`);

type ReasoningEffort = NonNullable<TranslationBenchScenario["reasoningEffort"]>;
const VALID_EFFORTS: ReadonlySet<string> = new Set<ReasoningEffort>([
    "",
    "minimal",
    "low",
    "medium",
    "high",
    "none",
    "xhigh",
    "max",
]);

/**
 * A model entry may carry a reasoning effort as `id#effort` (e.g.
 * `azure/gpt-5.6-luna#none`). The base id is used for the API call, TPM
 * budget, and concurrency lookup; the effort routes the same model through a
 * distinct scenario. No suffix inherits the gateway default.
 */
function parseModelSpec(spec: string): {
    baseId: string;
    effort?: ReasoningEffort;
} {
    const hash = spec.indexOf("#");
    if (hash < 0) return { baseId: spec };
    const baseId = spec.slice(0, hash);
    const effort = spec.slice(hash + 1);
    if (!VALID_EFFORTS.has(effort)) {
        throw new Error(
            `Invalid reasoning effort '${effort}' in model spec '${spec}'. ` +
                `Valid: ${[...VALID_EFFORTS].filter(Boolean).join(", ")}.`,
        );
    }
    return { baseId, effort: effort as ReasoningEffort };
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

function readRows(datasetPath: string): TypeAgentEvalRow[] {
    return fs
        .readFileSync(datasetPath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TypeAgentEvalRow);
}

async function runOneModel(
    model: string,
    suite: ReturnType<typeof buildSealToolsSuite>["suite"],
    sourceManifest: ReturnType<typeof buildSealToolsSuite>["sourceManifest"],
    goldByCaseId: ReadonlyMap<string, readonly SealToolsGoldAction[]>,
    actionContext: ActionContext<CommandHandlerContext>,
    resolved: ReturnType<typeof loadResolvedConfig>["resolved"],
    outDir: string,
    opts: { rateLimit?: boolean; rateLimiterDb?: string },
): Promise<{
    result: TranslationBenchRunResult;
    sealToolsOfficial: SealToolsOfficialScore;
}> {
    const slug = model.replace(/[^A-Za-z0-9_.-]/g, "_");
    const { baseId, effort } = parseModelSpec(model);
    const checkpointPath = path.join(outDir, `checkpoint-${slug}.jsonl`);
    const outPath = path.join(outDir, `results-${slug}.json`);
    const htmlPath = path.join(outDir, `report-${slug}.html`);

    const scenarios: TranslationBenchScenario[] =
        effort !== undefined
            ? [
                  {
                      ...getDefaultTranslationBenchScenario(),
                      id: `baseline-${effort === "" ? "default" : effort}`,
                      reasoningEffort: effort,
                  },
              ]
            : (suite.scenarios ?? [getDefaultTranslationBenchScenario()]);
    const settings = {
        kind: "seal-tools-eval",
        models: [baseId],
        scenarios: scenarios.map((s) => s.id),
        suiteCaseCount: suite.cases.length,
        caseIds: suite.cases.map((c) => c.id),
        validateActions: false,
        validateExpectedActions: false,
        sourceManifest,
    };
    const header: TranslationBenchCheckpointHeader = {
        kind: "translation-bench-checkpoint",
        version: 1,
        runFingerprint: createTranslationBenchRunFingerprint({ settings }),
        settings,
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
            readTranslationBenchCheckpoint<TranslationBenchRow>(checkpointPath);
        if (loaded.header.runFingerprint === header.runFingerprint) {
            checkpointState = loaded;
            for (const row of loaded.rows) {
                if (row.phase !== "translation") continue;
                seedRows.push(row.value);
                completed.add(translationBenchResumeKey(row));
            }
            console.log(
                `  [${model}] resuming ${seedRows.length} row(s) from checkpoint`,
            );
        }
    }

    // Per-model shared TPM limiter (respects run-config tpmLimit + headroom).
    const rateLimiter = createRunnerRateLimiter(resolved.tpmLimits, {
        disabled: opts.rateLimit === false,
        ...(opts.rateLimiterDb !== undefined
            ? { dbPath: opts.rateLimiterDb }
            : {}),
    });

    const runnerOptions: TranslationBenchRunnerOptions = {
        models: [baseId],
        scenarios,
        validateActions: false,
        validateExpectedActions: false,
        sourceManifest,
        concurrencyByModel:
            baseId === model
                ? resolved.concurrencyByModel
                : {
                      ...resolved.concurrencyByModel,
                      [baseId]: resolved.concurrencyByModel[model] ?? 10,
                  },
        seedRows,
        isWorkComplete: ({ model: m, scenarioId, caseId }) =>
            completed.has(
                translationBenchResumeKey({
                    phase: "translation",
                    model: m,
                    scenario: scenarioId,
                    caseId,
                }),
            ),
        onRowComplete: async (row) => {
            const ckptRow = createTranslationBenchTranslationCheckpointRow(row);
            checkpointState = appendTranslationBenchCheckpointRows(
                checkpointPath,
                header,
                [ckptRow],
                checkpointState,
            );
            completed.add(translationBenchResumeKey(ckptRow));
        },
        // Full LLM calls per row → one shared trajectories.jsonl, one line per
        // call, keyed by {caseId}-{slug} (rowid-setupid).
        onModelCalls: (work, calls) => {
            if (calls.length === 0) {
                return;
            }
            const lines =
                calls
                    .map((call, callIndex) =>
                        JSON.stringify({
                            id: `${work.caseId}-${slug}`,
                            rowid: work.caseId,
                            setupid: slug,
                            model,
                            scenarioId: work.scenarioId,
                            callIndex,
                            name: call.name,
                            atMs: call.atMs,
                            durationMs: call.durationMs,
                            request: call.request,
                            response: call.response,
                            usage: call.usage,
                        }),
                    )
                    .join("\n") + "\n";
            fs.appendFileSync(path.join(outDir, "trajectories.jsonl"), lines);
        },
    };
    if (
        process.env.TYPEAGENT_MODEL_PROVIDER === "openai" &&
        process.env.OPENAI_ENDPOINT !== undefined
    ) {
        process.env.OPENAI_MODEL = baseId;
        initRuntimeConfigFromProcessEnv();
        runnerOptions.availableModels = [baseId];
    }
    if (rateLimiter !== undefined) runnerOptions.rateLimiter = rateLimiter;

    let result: TranslationBenchRunResult;
    try {
        result = await runTranslationBench(
            suite,
            actionContext,
            runnerOptions,
            (done, total) => {
                if (done === total || done % 25 === 0) {
                    console.log(`  [${model}] ${done}/${total}`);
                }
            },
        );
    } finally {
        rateLimiter?.close();
    }

    if (checkpointState !== undefined && checkpointState.rows.length > 0) {
        const rebuilt = rebuildTranslationBenchRunResult(
            checkpointState.rows
                .filter((r) => r.phase === "translation")
                .map((r) => r.value),
            { schemaHashes: result.schemaHashes, settings: result.settings },
        );
        if (rebuilt.rows.length >= result.rows.length) result = rebuilt;
    }

    const sealToolsOfficial = scoreSealToolsOfficial(result.rows, goldByCaseId);
    const sealToolsCaseInsensitive = scoreSealToolsOfficial(
        result.rows,
        goldByCaseId,
        { ignoreStringCase: true },
    );
    const outputResult = {
        ...result,
        sealToolsOfficial,
        sealToolsCaseInsensitive,
    };
    const report = createTranslationBenchReport(suite, result);
    report.benchmarkMetricTables = [
        {
            title: "Seal-Tools metrics (API only, case-insensitive)",
            description:
                "Primary benchmark score for this test. Assesses API-call selection only: corpus-level format accuracy plus micro-averaged tool precision, recall, and F1, with case-insensitive string matching. Parameters are not scored because the dataset seeds required parameter values that the instruction never states (see docs/api-only-scoring.md). TypeAgent pass/fail below is supplemental.",
            columns: [
                { key: "formatAccuracy", label: "Format ACC" },
                { key: "toolPrecision", label: "Tool P" },
                { key: "toolRecall", label: "Tool R" },
                { key: "toolF1", label: "Tool F1" },
            ],
            rows: [
                {
                    key: model,
                    values: {
                        formatAccuracy: sealToolsCaseInsensitive.formatAccuracy,
                        toolPrecision: sealToolsCaseInsensitive.tool.precision,
                        toolRecall: sealToolsCaseInsensitive.tool.recall,
                        toolF1: sealToolsCaseInsensitive.tool.f1,
                    },
                },
            ],
        },
        {
            title: "Official Seal-Tools metrics (case-sensitive, parameters included)",
            description:
                "Reference only. The creator's exact case-sensitive calculate_score_ToolLearning, including the parameter score we exclude above. Shown so the dropped parameter penalty stays visible.",
            columns: [
                { key: "formatAccuracy", label: "Format ACC" },
                { key: "toolPrecision", label: "Tool P" },
                { key: "toolRecall", label: "Tool R" },
                { key: "toolF1", label: "Tool F1" },
                { key: "parameterPrecision", label: "Parameter P" },
                { key: "parameterRecall", label: "Parameter R" },
                { key: "parameterF1", label: "Parameter F1" },
            ],
            rows: [
                {
                    key: model,
                    values: {
                        formatAccuracy: sealToolsOfficial.formatAccuracy,
                        toolPrecision: sealToolsOfficial.tool.precision,
                        toolRecall: sealToolsOfficial.tool.recall,
                        toolF1: sealToolsOfficial.tool.f1,
                        parameterPrecision:
                            sealToolsOfficial.parameter.precision,
                        parameterRecall: sealToolsOfficial.parameter.recall,
                        parameterF1: sealToolsOfficial.parameter.f1,
                    },
                },
            ],
        },
    ];

    ensureParentDir(outPath);
    fs.writeFileSync(outPath, JSON.stringify(outputResult, null, 2), "utf8");
    fs.writeFileSync(htmlPath, renderTranslationBenchHtml(report), "utf8");
    console.log(
        `  [${model}] format ${formatPercent(sealToolsCaseInsensitive.formatAccuracy)} ` +
            `tool F1 ${formatPercent(sealToolsCaseInsensitive.tool.f1)} ` +
            `errors ${result.summary.errors} → ${path.relative(process.cwd(), outPath)}`,
    );
    return { result, sealToolsOfficial };
}

function formatPercent(value: number | undefined): string {
    return value === undefined ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
    const program = new Command()
        .name("seal-tools-eval")
        .description("Run the Seal-Tools validation suite across models")
        .option("--dataset <file>", "eval jsonl", DEFAULT_DATASET)
        .option("--config <file>", "run config JSON", DEFAULT_CONFIG)
        .option("--batch <name>", "named batch profile", "eval")
        .option("--models <ids>", "comma-separated model override")
        .option("--case-ids <ids>", "comma-separated exact case ids")
        .option("--max-cases <n>", "limit cases (smoke)", Number)
        .option("--out-dir <dir>", "results directory")
        .option("--env-file <file...>", "optional dotenv files")
        .option(
            "--instance-dir <dir>",
            "agent provider discovery dir",
            defaultInstanceDir("eval"),
        )
        .option("--rate-limiter-db <file>", "shared TPM sqlite path")
        .option("--no-rate-limit", "disable the TPM limiter")
        .parse();

    const opts = program.opts<{
        dataset: string;
        config: string;
        batch: string;
        models?: string;
        caseIds?: string;
        maxCases?: number;
        outDir?: string;
        envFile?: string[];
        instanceDir: string;
        rateLimiterDb?: string;
        rateLimit?: boolean;
    }>();

    loadDotEnvFiles([
        path.join(PACKAGE_ROOT, ".env"),
        path.join(PACKAGE_ROOT, ".env.real"),
        path.join(process.cwd(), ".env"),
        path.join(process.cwd(), ".env.real"),
        ...(opts.envFile ?? []),
    ]);
    initRuntimeConfigFromProcessEnv();

    const { resolved } = loadResolvedConfig({
        config: opts.config,
        batch: opts.batch,
    });
    const models = parseCsvList(opts.models) ?? resolved.evalModels;
    if (models.length === 0) {
        throw new Error(
            "No models configured. Pass --models or set base.eval.models in the run config.",
        );
    }

    const evalRows = readRows(path.resolve(opts.dataset));
    let { suite, sourceManifest } = buildSealToolsSuite(evalRows);
    const caseIds = parseCsvList(opts.caseIds);
    if (caseIds !== undefined) {
        if (new Set(caseIds).size !== caseIds.length) {
            throw new Error("--case-ids must not contain duplicates");
        }
        const byId = new Map(suite.cases.map((c) => [c.id, c]));
        const unknown = caseIds.filter((id) => !byId.has(id));
        if (unknown.length > 0) {
            throw new Error(`Unknown case id(s): ${unknown.join(", ")}`);
        }
        suite = { ...suite, cases: caseIds.map((id) => byId.get(id)!) };
    }
    const maxCases = opts.maxCases ?? resolved.maxCases;
    if (maxCases !== undefined) {
        suite = {
            ...suite,
            cases: suite.cases.slice(0, Math.max(0, maxCases)),
        };
    }
    const selectedCaseIds = new Set(suite.cases.map((c) => c.id));
    const goldByCaseId = new Map(
        evalRows
            .filter((row) => selectedCaseIds.has(row.id))
            .map((row) => [row.id, row.sealToolsGoldActions] as const),
    );

    const outDir = path.resolve(
        opts.outDir ?? path.join(SEAL_DIR, "eval", "results"),
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(opts.instanceDir, { recursive: true });

    console.log(
        `Seal-Tools eval: ${suite.cases.length} case(s) × ${models.length} model(s)`,
    );
    console.log(`models: ${models.join(", ")}`);

    const handlerContext = await initializeCommandHandlerContext(
        "seal-tools-eval",
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

    const summaryByModel: Record<string, unknown> = {};
    try {
        // One model at a time keeps the shared TPM ledger simple; per-model
        // case concurrency still comes from concurrencyByModel.
        for (const model of models) {
            console.log(`\n=== ${model} ===`);
            const { result, sealToolsOfficial } = await runOneModel(
                model,
                suite,
                sourceManifest,
                goldByCaseId,
                actionContext,
                resolved,
                outDir,
                {
                    ...(opts.rateLimit !== undefined
                        ? { rateLimit: opts.rateLimit }
                        : {}),
                    ...(opts.rateLimiterDb !== undefined
                        ? { rateLimiterDb: opts.rateLimiterDb }
                        : {}),
                },
            );
            summaryByModel[model] = {
                sealToolsOfficial,
                sealToolsCaseInsensitive: scoreSealToolsOfficial(
                    result.rows,
                    goldByCaseId,
                    { ignoreStringCase: true },
                ),
                typeAgentSupplemental: result.summary,
            };
        }
    } finally {
        await closeCommandHandlerContext(handlerContext);
    }

    const summaryPath = path.join(outDir, "summary.json");
    fs.writeFileSync(
        summaryPath,
        JSON.stringify(
            { dataset: DATASET_NAME, byModel: summaryByModel },
            null,
            2,
        ),
        "utf8",
    );
    console.log(`\nwrote ${path.relative(process.cwd(), summaryPath)}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
