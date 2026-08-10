#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Dual-root eval launcher:
 * - THIS worktree: synthesizer benchmark parse/approve (format matches draft)
 * - SIBLING 1k-eval worktree: dispatcher + runner (exports ActionSchemaFileCache etc.)
 * Local RUN_DIR only; not part of package src.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN = __dirname;
const THIS_TS = path.resolve(RUN, "../../../../../");

// Single config object (commander flags), instead of a pile of TB_* env vars.
// A --config <file.json> can supply any of the same keys; explicit flags win.
const program = new Command();
program
    .option("--config <file>", "JSON config file with any of the options below")
    .option(
        "--runtime-ts <dir>",
        "sibling worktree ts/ root for dispatcher+runner",
    )
    .option("--draft <file>", "benchmark draft jsonl")
    .option("--approved <file>", "approved benchmark jsonl output")
    .option("--out <file>", "eval-results.json output")
    .option("--html <file>", "eval-report.html output")
    .option("--checkpoint <file>", "eval checkpoint jsonl")
    .option("--gateway-dir <dir>", "publish dir for eval-report.html + results")
    .option(
        "--index-gateway-dir <dir>",
        "publish dir for the landing repo (index + explorers)",
    )
    .option("--per-model-concurrency <n>", "rows in-flight per model", Number)
    .option("--model-concurrency <n>", "models evaluated in parallel", Number)
    .option("--max-cases <n>", "trim to N cases for a smoke eval", Number)
    .option("--skip-trust", "skip trust verification for draft approval")
    .allowUnknownOption(true);
program.parse(process.argv);
const opts = program.opts();
const fileCfg = opts.config
    ? JSON.parse(fs.readFileSync(path.resolve(opts.config), "utf8"))
    : {};
const cfg = {
    runtimeTs: THIS_TS,
    draft: path.join(RUN, "artifacts/benchmark-draft-1000.jsonl"),
    approved: path.join(RUN, "artifacts/benchmark-approved-1000.jsonl"),
    out: path.join(RUN, "artifacts/eval-results.json"),
    html: path.join(RUN, "artifacts/eval-report.html"),
    checkpoint: path.join(RUN, "artifacts/eval-checkpoint-azure-gpt56.jsonl"),
    gatewayDir: path.join(RUN, "published-eval"),
    indexGatewayDir: "",
    perModelConcurrency: 10,
    modelConcurrency: 0,
    maxCases: undefined,
    skipTrust: false,
    ...fileCfg,
    ...Object.fromEntries(
        Object.entries({
            runtimeTs: opts.runtimeTs,
            draft: opts.draft,
            approved: opts.approved,
            out: opts.out,
            html: opts.html,
            checkpoint: opts.checkpoint,
            gatewayDir: opts.gatewayDir,
            indexGatewayDir: opts.indexGatewayDir,
            perModelConcurrency: opts.perModelConcurrency,
            modelConcurrency: opts.modelConcurrency,
            maxCases: opts.maxCases,
            skipTrust: opts.skipTrust,
        }).filter(([, v]) => v !== undefined),
    ),
};
const SIB_TS = cfg.runtimeTs;

function loadEnv(file) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        let v = m[2];
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        )
            v = v.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
}
loadEnv(path.join(THIS_TS, ".env.real"));
loadEnv(path.join(SIB_TS, ".env.real"));

const EVAL_MODELS = [
    "azure/gpt-5.6-sol",
    "azure/gpt-5.6-terra",
    "azure/gpt-5.6-luna",
];
for (const id of EVAL_MODELS) process.env[`OPENAI_MODEL_${id}`] = id;
process.env.OPENAI_RESPONSE_FORMAT = "1";

const PER_MODEL_CONCURRENCY = cfg.perModelConcurrency;
const CONCURRENCY_BY_MODEL = Object.fromEntries(
    EVAL_MODELS.map((id) => [id, PER_MODEL_CONCURRENCY]),
);
const CONCURRENCY = PER_MODEL_CONCURRENCY;
const MODEL_CONCURRENCY = cfg.modelConcurrency || EVAL_MODELS.length;
const MAX_CASES = cfg.maxCases;
const PEAK_IN_FLIGHT = Object.values(CONCURRENCY_BY_MODEL).reduce(
    (a, b) => a + b,
    0,
);

const clientPool = String(Math.max(PEAK_IN_FLIGHT, PER_MODEL_CONCURRENCY, 8));
if (process.env.AZURE_OPENAI_MAX_CONCURRENCY === undefined) {
    process.env.AZURE_OPENAI_MAX_CONCURRENCY = clientPool;
}
if (process.env.OPENAI_MAX_CONCURRENCY === undefined) {
    process.env.OPENAI_MAX_CONCURRENCY = clientPool;
}
console.log(
    `Models=${EVAL_MODELS.join(",")} perModel=${PER_MODEL_CONCURRENCY} modelConcurrency=${MODEL_CONCURRENCY} clientPool=${clientPool}`,
);
console.log(`runtimeTS=${SIB_TS}`);
console.log(`benchmarkTS=${THIS_TS}`);

const aiclient = await import(
    pathToFileURL(path.join(SIB_TS, "packages/aiclient/dist/index.js")).href
);
aiclient.initRuntimeConfigFromProcessEnv();

const dap = await import(
    pathToFileURL(
        path.join(SIB_TS, "packages/defaultAgentProvider/dist/index.js"),
    ).href
);
const disp = await import(
    pathToFileURL(
        path.join(SIB_TS, "packages/dispatcher/dispatcher/dist/internal.js"),
    ).href
);
const bmMod = await import(
    pathToFileURL(
        path.join(
            THIS_TS,
            "packages/benchmarks/dist/translationBench/synthesizer/benchmark.js",
        ),
    ).href
);
const srcMod = await import(
    pathToFileURL(
        path.join(
            THIS_TS,
            "packages/benchmarks/dist/translationBench/synthesizer/sourceBuilder.js",
        ),
    ).href
);
const runnerMod = await import(
    pathToFileURL(
        path.join(
            SIB_TS,
            "packages/benchmarks/dist/translationBench/runner/runner.js",
        ),
    ).href
);
const scaleMod = await import(
    pathToFileURL(
        path.join(
            SIB_TS,
            "packages/benchmarks/dist/translationBench/runner/scale.js",
        ),
    ).href
);
const reportMod = await import(
    pathToFileURL(
        path.join(
            SIB_TS,
            "packages/benchmarks/dist/translationBench/runner/report.js",
        ),
    ).href
);
await import(
    pathToFileURL(
        path.join(
            THIS_TS,
            "packages/benchmarks/dist/translationBench/synthesizer/adapters/seedQaJsonlAdapter.js",
        ),
    ).href
);

/** Local adapter (no cross-branch coverage asserts). */
function toRunnerLineage(lineage) {
    return {
        dataset: lineage.dataset,
        revision: lineage.revision,
        config: lineage.config,
        split: lineage.split,
        rowIndex: lineage.rowIndex,
        rowId: lineage.rowId,
        sourceUrl: lineage.sourceUrl,
        sourceHash: lineage.canonicalPayloadHash,
        sourcePart: lineage.sourcePart,
        rawRowHash: lineage.rawRowHash,
        sourceSliceHash: lineage.sourceSliceHash,
        canonicalPayloadHash: lineage.canonicalPayloadHash,
        transformVersion: lineage.transformVersion,
        ...(lineage.transformVersion >= 2 ? { derived: true } : {}),
    };
}
function toExplainerProbe(caseId, probe) {
    if (probe.selection.role === "seed") {
        throw new Error(
            `Case '${caseId}' contains a seed in its generalization probes`,
        );
    }
    return {
        id: `${caseId}:${probe.lineage.rowId}:${probe.lineage.sourcePart}${
            probe.lineage.transformVersion >= 2
                ? `:${probe.lineage.canonicalPayloadHash}`
                : ""
        }`,
        role: probe.selection.role,
        lineage: toRunnerLineage(probe.lineage),
        utterance: probe.utterance,
        expectedActions: structuredClone(probe.expectedActions),
        order: probe.order,
        dimensions: structuredClone(probe.selection.dimensions),
        ...(probe.history !== undefined
            ? { history: structuredClone(probe.history) }
            : {}),
    };
}
function translationBenchBenchmarkToSuite(benchmark) {
    if (benchmark.metadata?.approval?.status !== "approved") {
        throw new Error(
            `Benchmark not approved (status=${benchmark.metadata?.approval?.status})`,
        );
    }
    const suite = {
        version: 1,
        name: benchmark.metadata.name,
        schemas: structuredClone(benchmark.metadata.schemas),
        cases: benchmark.cases.flatMap((evalCase) => {
            const primary = {
                id: evalCase.id,
                lineage: toRunnerLineage(evalCase.seed.lineage),
                activeSchemas: structuredClone(evalCase.activeSchemas),
                seed: {
                    utterance: evalCase.seed.utterance,
                    expectedActions: structuredClone(
                        evalCase.seed.expectedActions,
                    ),
                    order: evalCase.seed.order,
                    ...(evalCase.seed.history !== undefined
                        ? { history: structuredClone(evalCase.seed.history) }
                        : {}),
                    // Pass through generator soft-match specs (B fix). Without this the
                    // runner falls back to exact equalNormalizedObject for all params.
                    ...(evalCase.seed.parameterScore !== undefined
                        ? {
                              parameterScore: structuredClone(
                                  evalCase.seed.parameterScore,
                              ),
                          }
                        : {}),
                },
                explainer: {
                    valueInRequest: evalCase.explainer.valueInRequest,
                    noReferences: evalCase.explainer.noReferences,
                    probes: evalCase.generalizations.map((probe) =>
                        toExplainerProbe(evalCase.id, probe),
                    ),
                },
                ...(evalCase.dimensions !== undefined
                    ? { dimensions: structuredClone(evalCase.dimensions) }
                    : {}),
            };
            const translationNegatives = evalCase.generalizations
                .filter((probe) => probe.selection.role === "negative")
                .map((probe) => ({
                    id: `${evalCase.id}:translation-negative:${probe.lineage.rowId}:${probe.lineage.sourcePart}${
                        probe.lineage.transformVersion >= 2
                            ? `:${probe.lineage.canonicalPayloadHash}`
                            : ""
                    }`,
                    lineage: toRunnerLineage(probe.lineage),
                    activeSchemas: structuredClone(evalCase.activeSchemas),
                    seed: {
                        utterance: probe.utterance,
                        expectedActions: [],
                        order: probe.order,
                        ...(probe.history !== undefined
                            ? { history: structuredClone(probe.history) }
                            : {}),
                    },
                    dimensions: structuredClone(probe.selection.dimensions),
                }));
            return [primary, ...translationNegatives];
        }),
        ...(benchmark.metadata.scenarios !== undefined
            ? { scenarios: structuredClone(benchmark.metadata.scenarios) }
            : {}),
        ...(benchmark.metadata.pricing !== undefined
            ? { pricing: structuredClone(benchmark.metadata.pricing) }
            : {}),
    };
    const sourceManifest = {
        version: 1,
        sources: benchmark.cases.flatMap((evalCase) => [
            toRunnerLineage(evalCase.seed.lineage),
            ...evalCase.generalizations.map((probe) =>
                toRunnerLineage(probe.lineage),
            ),
        ]),
    };
    return { suite, sourceManifest };
}

const draftPath = cfg.draft;
const approvedPath = cfg.approved;
const sourcePath = path.join(RUN, "source/anchors-1100.jsonl");
const manifestPath = path.join(RUN, "source/source-manifest.json");
const outPath = cfg.out;
const htmlPath = cfg.html;
const checkpointPath = cfg.checkpoint;

if (!fs.existsSync(draftPath)) throw new Error(`Missing draft: ${draftPath}`);

const instanceDir = path.join(RUN, "instance-eval");
fs.mkdirSync(instanceDir, { recursive: true });
const context = await disp.initializeCommandHandlerContext(
    "translation-bench-1k-eval",
    {
        ...dap.getDefaultDispatcherOptions(),
        appAgentProviders: dap.getDefaultAppAgentProviders(instanceDir),
        explanationAsynchronousMode: false,
        persistSession: false,
        metrics: false,
    },
);

try {
    let benchmark;
    if (fs.existsSync(approvedPath)) {
        benchmark = bmMod.parseTranslationBenchBenchmarkJsonl(
            fs.readFileSync(approvedPath, "utf8"),
            approvedPath,
        );
        console.log("Loaded approved benchmark →", approvedPath);
    } else {
        benchmark = bmMod.parseTranslationBenchBenchmarkJsonl(
            fs.readFileSync(draftPath, "utf8"),
            draftPath,
        );
        if (MAX_CASES && benchmark.cases.length > MAX_CASES) {
            benchmark = {
                ...benchmark,
                cases: benchmark.cases.slice(0, MAX_CASES),
            };
            console.log(`Trimmed to ${MAX_CASES} cases for smoke eval`);
        }
        if (benchmark.metadata.approval.status === "draft") {
            const skipTrust =
                cfg.skipTrust ||
                (MAX_CASES !== undefined && MAX_CASES < benchmark.cases.length);
            if (!skipTrust) {
                const sourceText = fs.readFileSync(sourcePath, "utf8");
                const sourceManifestFile = JSON.parse(
                    fs.readFileSync(manifestPath, "utf8"),
                );
                srcMod.assertTranslationBenchSourceBenchmarkTrust(benchmark, {
                    sourceText,
                    sourceManifest: sourceManifestFile,
                    provider: context.agents,
                });
            } else {
                console.log("Skipping source trust assert (trim/skip flag)");
            }
            benchmark = bmMod.approveTranslationBenchBenchmark(benchmark, {
                reviewedBy: "dom-local-1k-run",
                reviewedAt: new Date().toISOString(),
            });
        }
        fs.writeFileSync(
            approvedPath,
            bmMod.formatTranslationBenchBenchmarkJsonl(benchmark),
        );
        console.log("Approved →", approvedPath);
    }

    if (MAX_CASES && benchmark.cases.length > MAX_CASES) {
        benchmark = {
            ...benchmark,
            cases: benchmark.cases.slice(0, MAX_CASES),
        };
        console.log(`Eval trimmed to ${MAX_CASES} cases`);
    }

    const { suite, sourceManifest } =
        translationBenchBenchmarkToSuite(benchmark);

    const asOf = new Date().toISOString().slice(0, 10);
    suite.pricing = {
        "azure/gpt-5.6-sol": {
            inputUsdPerMToken: 5,
            cachedInputUsdPerMToken: 2.5,
            outputUsdPerMToken: 30,
            source: "litellm model_info azure/gpt-5.6-sol",
            asOf,
        },
        "azure/gpt-5.6-terra": {
            inputUsdPerMToken: 2.5,
            cachedInputUsdPerMToken: 1.25,
            outputUsdPerMToken: 15,
            source: "litellm model_info azure/gpt-5.6-terra",
            asOf,
        },
        "azure/gpt-5.6-luna": {
            inputUsdPerMToken: 1,
            cachedInputUsdPerMToken: 0.5,
            outputUsdPerMToken: 6,
            source: "litellm model_info azure/gpt-5.6-luna",
            asOf,
        },
    };

    const emptyGold = suite.cases.filter(
        (c) => !(c.seed?.expectedActions || []).length,
    ).length;
    console.log(
        `Suite cases=${suite.cases.length} emptyGold=${emptyGold} models=${EVAL_MODELS.length} modelConcurrency=${MODEL_CONCURRENCY} byModel=${JSON.stringify(CONCURRENCY_BY_MODEL)}`,
    );

    const availableModels = await aiclient.getChatModelNames();
    console.log("available models:", availableModels.join(", "));
    const started = Date.now();
    let lastLog = 0;
    const noopIO = {
        setDisplay() {},
        appendDisplay() {},
        takeAction() {},
        appendDiagnosticData() {},
    };
    const actionContext = {
        streamingContext: undefined,
        isFromReasoningLoop: false,
        activityContext: undefined,
        actionIO: noopIO,
        sessionContext: {
            agentContext: context,
            sessionStorage: undefined,
            instanceStorage: undefined,
            notify() {},
            addAgentNameTag: false,
        },
        queueToggleTransientAgent: async () => {},
    };

    const scenarios =
        suite.scenarios ??
        (typeof runnerMod.getDefaultTranslationBenchScenario === "function"
            ? [runnerMod.getDefaultTranslationBenchScenario()]
            : [{ id: "baseline" }]);
    const checkpointSettings = {
        kind: "translation-bench-headless-eval",
        models: [...EVAL_MODELS],
        scenarios: scenarios.map((s) => s.id),
        suiteCaseCount: suite.cases.length,
        sourceManifestHash:
            sourceManifest?.hash ??
            sourceManifest?.sourceManifestHash ??
            JSON.stringify(sourceManifest)?.length,
    };
    const runFingerprint = scaleMod.createTranslationBenchRunFingerprint({
        settings: checkpointSettings,
        suiteCaseIds: suite.cases.map((c) => c.id),
    });
    const checkpointHeader = {
        kind: "translation-bench-checkpoint",
        version: 1,
        runFingerprint,
        settings: checkpointSettings,
        shardIndex: 0,
        shardCount: 1,
    };
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    let checkpoint = scaleMod.appendTranslationBenchCheckpointRows(
        checkpointPath,
        checkpointHeader,
        [],
    );
    const seedRows = checkpoint.rows
        .filter((row) => row.phase === "translation")
        .map((row) => row.value);
    const completed = new Set(checkpoint.resumeKeys);
    console.log(
        `Checkpoint ${checkpointPath}: resumed=${seedRows.length} keys=${completed.size}`,
    );

    const result = await runnerMod.runTranslationBench(
        suite,
        actionContext,
        {
            models: EVAL_MODELS,
            sourceManifest,
            availableModels,
            concurrency: CONCURRENCY,
            concurrencyByModel: CONCURRENCY_BY_MODEL,
            modelConcurrency: MODEL_CONCURRENCY,
            seedRows,
            isWorkComplete: ({ model, scenarioId, caseId }) =>
                completed.has(
                    scaleMod.translationBenchResumeKey({
                        phase: "translation",
                        model,
                        scenario: scenarioId,
                        caseId,
                    }),
                ),
            onRowComplete: (row) => {
                const ckptRow =
                    scaleMod.createTranslationBenchTranslationCheckpointRow(
                        row,
                    );
                checkpoint = scaleMod.appendTranslationBenchCheckpointRows(
                    checkpointPath,
                    checkpointHeader,
                    [ckptRow],
                    checkpoint,
                );
                completed.add(scaleMod.translationBenchResumeKey(ckptRow));
            },
        },
        (done, total) => {
            const now = Date.now();
            if (done === total || now - lastLog > 5000) {
                lastLog = now;
                const elapsed = ((now - started) / 1000).toFixed(0);
                const rate =
                    done > 0 ? (Number(elapsed) / done).toFixed(2) : "?";
                console.log(
                    `[eval] ${done}/${total} (${((done / total) * 100).toFixed(1)}%) elapsed=${elapsed}s sec_per=${rate} modelC=${MODEL_CONCURRENCY} peak=${PEAK_IN_FLIGHT} ckpt=${completed.size}`,
                );
            }
        },
    );

    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    // Side outputs follow the eval art dir (dirname of outPath), not the run root —
    // so smoke subdirs cannot clobber sibling 1k artifacts.
    const artDir = path.dirname(outPath);
    fs.mkdirSync(artDir, { recursive: true });
    fs.copyFileSync(checkpointPath, path.join(artDir, "eval-trajectory.jsonl"));
    const report = reportMod.createTranslationBenchReport(
        suite,
        result,
        [],
        benchmark,
    );
    const html = reportMod.renderTranslationBenchHtml(report);
    fs.writeFileSync(htmlPath, html);
    console.log(
        JSON.stringify(
            {
                outPath,
                htmlPath,
                elapsedSec: (Date.now() - started) / 1000,
                summary: result.summary ?? result.totals ?? Object.keys(result),
            },
            null,
            2,
        ),
    );

    const gw = cfg.gatewayDir;
    fs.mkdirSync(gw, { recursive: true });
    fs.copyFileSync(htmlPath, path.join(gw, "eval-report.html"));
    fs.copyFileSync(outPath, path.join(gw, "eval-results.json"));
    fs.writeFileSync(
        path.join(artDir, "eval-report-by-model.json"),
        JSON.stringify(report.byModel ?? [], null, 2),
    );
    fs.writeFileSync(
        path.join(artDir, "eval-report-summary.json"),
        JSON.stringify(
            {
                suiteName: report.suiteName,
                settings: report.settings,
                summary: report.summary,
                byModel: (report.byModel ?? []).map((m) => ({
                    key: m.key,
                    summary: m.summary,
                })),
                generatedAt: new Date().toISOString(),
            },
            null,
            2,
        ),
    );
    console.log("gateway →", gw);
    console.log("artDir →", artDir);

    // Build + publish the landing "repo": index.html (details + how-each-score-is-
    // calculated + one-cell=utterance×model) and the per-cell explorer, pointed at
    // this run's artifacts. Robust: never fails the eval if a viz generator errors.
    const vizGwDir =
        cfg.indexGatewayDir || cfg.gatewayDir || path.join(RUN, "published");
    const { spawnSync } = await import("node:child_process");
    for (const gen of ["update-eval-cases-viz.mjs", "update-index-viz.mjs"]) {
        try {
            const r = spawnSync(
                process.execPath,
                [
                    path.join(RUN, gen),
                    "--art-dir",
                    artDir,
                    "--gateway-dir",
                    vizGwDir,
                ],
                { cwd: RUN, stdio: "inherit" },
            );
            if (r.status !== 0) console.warn(`${gen} exited ${r.status}`);
        } catch (e) {
            console.warn(`${gen} failed:`, e.message);
        }
    }
    console.log("landing repo →", vizGwDir);
} finally {
    await disp.closeCommandHandlerContext(context);
}
