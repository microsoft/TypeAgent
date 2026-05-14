// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// 5-step pipeline orchestrator: neighborhoods → explore → validate →
// patterns → distill. Predecessor-gated via --from flag, modeled on
// `CollisionCorpusRunCommandHandler.run` (collisionCorpusHandlers.ts:4271).
//
// The orchestrator can run either inside the dispatcher REPL
// (`@collision optimize run`) or out-of-process via the CLI runner
// (`packages/defaultAgentProvider/src/collisions/optimizationRunner.ts`).
// Both call into `runPipeline()` with a shared options shape.

import * as fs from "node:fs";
import * as path from "node:path";

import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../../context/commandHandlerContext.js";

import {
    buildNeighborhoodsFromTranslator,
    type BuildNeighborhoodsFromTranslatorOptions,
} from "../merge.js";
import { buildNeighborhoodPreviewHTML } from "../previewViz.js";
import {
    computeActionGravity,
    type ActionGravity,
} from "../actionGravity.js";
import type { TranslationProbeFile } from "../../translation/translationProbeRunner.js";

import { runCorpusLoop } from "./corpusLoop.js";
import type {
    CaseDescription,
    Hypothesis,
} from "./types.js";
import type { DiffPayload } from "./hypothesisEvaluator.js";
import { runValidate } from "./validateImpact.js";
import { initBuiltInLevers } from "./levers/index.js";
import {
    minePatterns,
    parsePatternsJsonl,
} from "./patternMiner.js";
import { buildPatternsHTML } from "./patternsViz.js";
import { distillGuidelineCandidates } from "./guidelineDistiller.js";
import { buildCandidatesMarkdown } from "./guidelinesViz.js";
import { schemaGuidelines as canonicalSchemaGuidelines } from "../../translation/schemaGuidelines.js";
import { openai, type ChatModel } from "aiclient";
import {
    defaultPath as defaultPathHelper,
    ensureDir,
    resolveWorkdir,
    withReadOnlySession,
} from "./util.js";

import { loadSandboxProvider } from "./sandboxProvider.js";
import { translateCorpusWithProvider } from "./sandboxTranslate.js";

// =============================================================================
// Step list — re-exported from a zero-deps module to avoid TDZ cycles
// when the optimize handlers eagerly reference RUN_STEPS during
// initialization.
// =============================================================================

export { RUN_STEPS, type RunStep } from "./runSteps.js";
import { RUN_STEPS, type RunStep } from "./runSteps.js";

export const DEFAULT_FILES = {
    neighborhoodsJson: "neighborhoods.json",
    neighborhoodsHtml: "neighborhoods.html",
    baseline: "translation-results.json",
    patternsJsonl: "patterns.jsonl",
    patternsJson: "patterns.json",
    patternsHtml: "patterns.html",
    guidelineCandidates: "schemaGuidelines.candidates.md",
} as const;

// =============================================================================
// Options
// =============================================================================

export interface RunPipelineOpts {
    context: ActionContext<CommandHandlerContext>;
    /** Workdir under which intermediates live. */
    workdir: string;
    /** Starting step. Default `neighborhoods`. */
    from?: RunStep;
    /** Skip the distill step regardless of attempts-threshold gating. */
    skipDistill?: boolean;
    /** Forwarded to explore. */
    top?: number;
    /** Forwarded to explore. */
    depth?: number;
    /** Forwarded to explore. */
    leverFilter?: string[];
    /** Forwarded to explore. */
    severities?: ("blocker" | "leaky" | "minor")[];
    /** Dry-run mode (forwarded to explore). */
    dryRun?: boolean;
    /** Minimum winners in patterns.jsonl for distill to run. Default 10. */
    distillMinAttempts?: number;
    /** Progress callback. Receives one short line per step transition. */
    onStep?: (step: RunStep, label: string) => void;
}

export interface RunPipelineResult {
    stepsRun: RunStep[];
    stepsSkipped: { step: RunStep; reason: string }[];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the optimize pipeline from `--from` (default first step) through
 * `distill` (or stop at `patterns` when `--skip-distill`). Each step's
 * predecessor file is checked before running. Halts cleanly with a
 * warning when a predecessor is missing.
 */
export async function runPipeline(
    opts: RunPipelineOpts,
): Promise<RunPipelineResult> {
    initBuiltInLevers();

    const from = opts.from ?? "neighborhoods";
    if (!(RUN_STEPS as readonly string[]).includes(from)) {
        throw new Error(
            `Invalid --from "${from}". Use one of: ${RUN_STEPS.join(", ")}.`,
        );
    }
    const startIndex = RUN_STEPS.indexOf(from);
    const workdir = opts.workdir;
    const systemContext = opts.context.sessionContext.agentContext;

    const files = {
        baseline: path.join(workdir, DEFAULT_FILES.baseline),
        neighborhoodsJson: path.join(workdir, DEFAULT_FILES.neighborhoodsJson),
        patternsJsonl: path.join(workdir, DEFAULT_FILES.patternsJsonl),
        patternsJson: path.join(workdir, DEFAULT_FILES.patternsJson),
        patternsHtml: path.join(workdir, DEFAULT_FILES.patternsHtml),
        candidates: path.join(workdir, DEFAULT_FILES.guidelineCandidates),
    };

    // Predecessor checks. `neighborhoods` requires translation-results.json
    // (the corpus pipeline upstream of optimize). `explore` requires
    // neighborhoods.json. `validate` requires the latest optimization-run-*
    // dir to exist. `patterns` + `distill` require patterns.jsonl.
    const predecessor: Record<RunStep, () => string | null> = {
        neighborhoods: () => files.baseline,
        explore: () => files.neighborhoodsJson,
        validate: () =>
            findLatestRunRoot(workdir) ??
            "<at least one optimization-run-*/optimization-run.json>",
        patterns: () => files.patternsJsonl,
        distill: () => files.patternsJsonl,
    };
    const requiredFile = predecessor[from]();
    if (
        requiredFile &&
        !requiredFile.startsWith("<") &&
        !fs.existsSync(requiredFile)
    ) {
        throw new Error(
            `--from ${from} requires ${requiredFile} to exist. Run an earlier step first.`,
        );
    }
    if (requiredFile && requiredFile.startsWith("<")) {
        // validate's predecessor is the latest run dir — symbolic check.
        const latest = findLatestRunRoot(workdir);
        if (!latest) {
            throw new Error(
                `--from validate requires at least one optimization-run-* directory under ${workdir}.`,
            );
        }
    }

    const result: RunPipelineResult = {
        stepsRun: [],
        stepsSkipped: [],
    };

    await withReadOnlySession(opts.context, async () => {
        // ---- 1. neighborhoods ----
        if (startIndex <= RUN_STEPS.indexOf("neighborhoods")) {
            opts.onStep?.("neighborhoods", "building from translator-results");
            await runNeighborhoodsStep(workdir, files, opts);
            result.stepsRun.push("neighborhoods");
        }
        // ---- 2. explore ----
        if (startIndex <= RUN_STEPS.indexOf("explore")) {
            opts.onStep?.("explore", "running case loops");
            await runExploreStep(workdir, files, opts);
            result.stepsRun.push("explore");
        }
        // ---- 3. validate ----
        if (startIndex <= RUN_STEPS.indexOf("validate")) {
            opts.onStep?.("validate", "stacking winners + re-probing");
            await runValidateStep(workdir, opts);
            result.stepsRun.push("validate");
        }
        // ---- 4. patterns ----
        if (startIndex <= RUN_STEPS.indexOf("patterns")) {
            opts.onStep?.("patterns", "mining cross-run patterns");
            await runPatternsStep(workdir, files, opts);
            result.stepsRun.push("patterns");
        }
        // ---- 5. distill ----
        if (startIndex <= RUN_STEPS.indexOf("distill")) {
            if (opts.skipDistill) {
                result.stepsSkipped.push({
                    step: "distill",
                    reason: "skipped via --skip-distill",
                });
            } else {
                opts.onStep?.("distill", "checking data + distilling");
                const distillResult = await runDistillStep({
                    patternsFile: files.patternsJsonl,
                    candidatesFile: files.candidates,
                    minAttempts: opts.distillMinAttempts ?? 10,
                });
                if (distillResult === "not-enough-data") {
                    result.stepsSkipped.push({
                        step: "distill",
                        reason: "patterns.jsonl below --min-attempts threshold",
                    });
                } else {
                    result.stepsRun.push("distill");
                }
            }
        }
    });

    void systemContext;
    return result;
}

// =============================================================================
// Step 1: neighborhoods (reads translation-results.json, writes
// neighborhoods.{json,html})
// =============================================================================

async function runNeighborhoodsStep(
    workdir: string,
    files: { baseline: string; neighborhoodsJson: string },
    opts: RunPipelineOpts,
): Promise<void> {
    if (!fs.existsSync(files.baseline)) {
        throw new Error(
            `neighborhoods step: ${files.baseline} not found. Run @collision corpus translate first.`,
        );
    }
    const translationResults = JSON.parse(
        fs.readFileSync(files.baseline, "utf-8"),
    ) as TranslationProbeFile;

    const buildOpts: BuildNeighborhoodsFromTranslatorOptions = {
        translationResults,
        minMisrouteCount: 2,
        includeSameSchema: true,
        translatorCorpusFile: files.baseline,
    };
    const preview = buildNeighborhoodsFromTranslator(buildOpts);
    const gravity: Record<string, ActionGravity[]> = {};
    for (const n of preview.neighborhoods) {
        gravity[n.id] = computeActionGravity(n);
    }
    const output = {
        schemaVersion: 1 as const,
        builtAt: preview.builtAt,
        sources: { translatorCorpus: files.baseline },
        neighborhoods: preview.neighborhoods,
        gravity,
    };
    ensureDir(path.dirname(files.neighborhoodsJson));
    fs.writeFileSync(
        files.neighborhoodsJson,
        JSON.stringify(output, undefined, 2),
    );
    const htmlPath = path.join(workdir, DEFAULT_FILES.neighborhoodsHtml);
    const html = buildNeighborhoodPreviewHTML(preview, { pairScores: [] });
    fs.writeFileSync(htmlPath, html);
    void opts;
}

// =============================================================================
// Step 2: explore (reads neighborhoods.json + baseline, writes
// optimization-run-<ts>/ and appends patterns.jsonl)
// =============================================================================

async function runExploreStep(
    workdir: string,
    files: { baseline: string; neighborhoodsJson: string },
    opts: RunPipelineOpts,
): Promise<void> {
    const dryRun = opts.dryRun ?? false;
    let runProbe:
        | ((
              runRoot: string,
              hypothesis: Hypothesis,
              caseDesc: CaseDescription,
          ) => Promise<DiffPayload>)
        | undefined;
    if (!dryRun) {
        runProbe = async (runRoot, hypothesis, caseDesc) =>
            runRealProbe(runRoot, hypothesis, caseDesc, files.baseline, opts);
    }

    await runCorpusLoop({
        neighborhoodsPath: files.neighborhoodsJson,
        baselinePath: files.baseline,
        workdir,
        sourceProvider:
            opts.context.sessionContext.agentContext.agents,
        context: opts.context,
        top: opts.top ?? 5,
        ...(opts.severities && { severities: opts.severities }),
        ...(opts.leverFilter && { leverFilter: opts.leverFilter }),
        depth: opts.depth ?? 2,
        ...(runProbe && { runProbe }),
        dryRun,
    });
}

// =============================================================================
// Step 3: validate (latest run + sandbox-stacked re-probe)
// =============================================================================

async function runValidateStep(
    workdir: string,
    opts: RunPipelineOpts,
): Promise<void> {
    await runValidate({
        workdir,
        sourceProvider:
            opts.context.sessionContext.agentContext.agents,
        context: opts.context,
    });
}

// =============================================================================
// Step 4: patterns (mine patterns.jsonl, write patterns.{json,html})
// =============================================================================

async function runPatternsStep(
    workdir: string,
    files: {
        patternsJsonl: string;
        patternsJson: string;
        patternsHtml: string;
    },
    opts: RunPipelineOpts,
): Promise<void> {
    if (!fs.existsSync(files.patternsJsonl)) {
        throw new Error(
            `patterns step: ${files.patternsJsonl} not found. Run explore first.`,
        );
    }
    const content = fs.readFileSync(files.patternsJsonl, "utf-8");
    const rows = parsePatternsJsonl(content);
    const report = minePatterns({ rows });
    fs.writeFileSync(files.patternsJson, JSON.stringify(report, undefined, 2));
    fs.writeFileSync(
        files.patternsHtml,
        buildPatternsHTML(report, {}),
    );
    void workdir;
    void opts;
}

// =============================================================================
// Step 5: distill (Phase 9 — LLM-driven schemaGuidelines candidate
// proposal)
// =============================================================================

export interface RunDistillStepOpts {
    patternsFile: string;
    candidatesFile: string;
    minAttempts: number;
    /** Canonical schemaGuidelines text. Defaults to the live
     *  `schemaGuidelines` constant. Tests pass a stub. */
    schemaGuidelines?: string;
    /** ChatModel factory. Defaults to `openai.createChatModel`. Tests
     *  pass a mock. */
    createModel?: (name: string) => ChatModel;
}

/**
 * Distill step. Reads `patterns.jsonl`, filters winners, gates on
 * `--min-attempts`, groups by `(mechanism, guidelineHook)`, samples
 * evidence from each group, calls the LLM with the current
 * schemaGuidelines as context, and writes a markdown report of
 * candidate additions.
 *
 * Status semantics:
 *   - `not-enough-data` — winners < minAttempts OR no group reached
 *     --min-per-group (the candidates.md still gets a placeholder
 *     entry explaining why).
 *   - `completed` — at least one candidate was produced.
 *
 * Exported standalone so unit tests can exercise gating + LLM-mock
 * paths without spinning up the full pipeline.
 */
export async function runDistillStep(
    opts: RunDistillStepOpts,
): Promise<"completed" | "not-enough-data"> {
    const schemaGuidelines =
        opts.schemaGuidelines ?? canonicalSchemaGuidelines;
    const createModel =
        opts.createModel ??
        ((name: string) => openai.createChatModel(name));

    if (!fs.existsSync(opts.patternsFile)) {
        fs.writeFileSync(
            opts.candidatesFile,
            `# schemaGuidelines candidates\n\n` +
                `**Status:** not-enough-data\n\n` +
                `patterns.jsonl not found at ${opts.patternsFile}.\n`,
        );
        return "not-enough-data";
    }

    const report = await distillGuidelineCandidates({
        patternsFile: opts.patternsFile,
        minAttempts: opts.minAttempts,
        schemaGuidelines,
        createModel,
    });

    const md = buildCandidatesMarkdown(report);
    fs.writeFileSync(opts.candidatesFile, md);
    return report.status;
}

// =============================================================================
// Helpers
// =============================================================================

function findLatestRunRoot(workdir: string): string | null {
    if (!fs.existsSync(workdir)) return null;
    const dirs = fs
        .readdirSync(workdir, { withFileTypes: true })
        .filter(
            (e) =>
                e.isDirectory() && e.name.startsWith("optimization-run-"),
        )
        .map((e) => {
            const full = path.join(workdir, e.name);
            return { full, mtime: fs.statSync(full).mtimeMs };
        });
    if (dirs.length === 0) return null;
    dirs.sort((a, b) => b.mtime - a.mtime);
    return path.join(dirs[0]!.full, "optimization-run.json");
}

// Real-probe wrapper — mirrors the one in collisionOptimizeHandlers, kept
// here so runPipeline can be called from the CLI runner without pulling
// in the in-shell handler.
async function runRealProbe(
    runRoot: string,
    _hypothesis: Hypothesis,
    caseDesc: CaseDescription,
    baselinePath: string,
    opts: RunPipelineOpts,
): Promise<DiffPayload> {
    const sandboxDir = path.join(runRoot, "sandbox");
    const { provider: sandboxProvider } = loadSandboxProvider(sandboxDir);
    const corpus = buildFocusedCorpus(caseDesc);
    const baseline = JSON.parse(
        fs.readFileSync(baselinePath, "utf-8"),
    );
    const baselineByPhrase = new Map<
        string,
        { chosenSchema?: string; chosenAction?: string; outcome: string }
    >();
    for (const row of baseline.results ?? []) {
        const key = `${row.expectedSchema}\0${row.expectedAction}\0${row.phraseText}`;
        baselineByPhrase.set(key, {
            chosenSchema: row.chosenSchema,
            chosenAction: row.chosenAction,
            outcome: row.outcome,
        });
    }
    const probe = await translateCorpusWithProvider(
        sandboxProvider,
        corpus,
        opts.context,
        {},
    );
    let rescues = 0;
    let regressions = 0;
    const regressionPhrases: string[] = [];
    const memberKeys = new Set(
        caseDesc.members.map((m) => `${m.schemaName}.${m.actionName}`),
    );
    for (const row of probe.results) {
        const baselineRow = baselineByPhrase.get(
            `${row.expectedSchema}\0${row.expectedAction}\0${row.phraseText}`,
        );
        if (!baselineRow) continue;
        const expectedKey = `${row.expectedSchema}.${row.expectedAction}`;
        const candidateMatches =
            row.outcome === "CLEAN" &&
            row.chosenSchema === row.expectedSchema &&
            row.chosenAction === row.expectedAction;
        const baselineMatches = baselineRow.outcome === "CLEAN";
        if (memberKeys.has(expectedKey)) {
            if (!baselineMatches && candidateMatches) rescues++;
            else if (baselineMatches && !candidateMatches) {
                regressions++;
                regressionPhrases.push(row.phraseText);
            }
        }
    }
    return { rescues, regressions, regressionPhrases };
}

function buildFocusedCorpus(caseDesc: CaseDescription) {
    const byAction = new Map<
        string,
        {
            schemaName: string;
            actionName: string;
            phrases: { text: string; sources: any[] }[];
        }
    >();
    const all = [
        ...caseDesc.misroutePhrases,
        ...caseDesc.cleanPhrases,
        ...caseDesc.reverseDirectionPhrases,
    ];
    for (const p of all) {
        const key = `${p.expectedSchema}.${p.expectedAction}`;
        let bucket = byAction.get(key);
        if (!bucket) {
            bucket = {
                schemaName: p.expectedSchema,
                actionName: p.expectedAction,
                phrases: [],
            };
            byAction.set(key, bucket);
        }
        bucket.phrases.push({
            text: p.phraseText,
            sources: p.sources ?? [],
        });
    }
    return { actions: [...byAction.values()] };
}

// Re-export utility helpers in case the CLI runner needs them.
export { resolveWorkdir, defaultPathHelper as defaultPath };
