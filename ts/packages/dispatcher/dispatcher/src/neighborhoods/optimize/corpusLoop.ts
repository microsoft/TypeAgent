// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Run-level orchestrator. Creates `optimization-run-<ts>/`, builds the
// sandbox, snapshots it, picks the top-N cases by gravity, runs each
// through `runCaseLoop`, and writes `optimization-run.json` plus a row
// per attempt to `<workdir>/patterns.jsonl`.
//
// Combined re-probe and HTML report are sketched but optional: Phase 3
// ships with `runCombinedReprobe` injected (the corpus runner wires it
// to a real reprobe; tests pass undefined). Phase 5's `validate` command
// uses the same logic in standalone form.

import * as fs from "node:fs";
import * as path from "node:path";

import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../../context/commandHandlerContext.js";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import type { TranslationProbeFile } from "../../translation/translationProbeRunner.js";
import {
    computeActionGravity,
    type ActionGravity,
} from "../actionGravity.js";
import type { Neighborhood } from "../types.js";

import { analyzeCase } from "./caseAnalyzer.js";
import { runCaseLoop } from "./caseLoop.js";
import type { DiffPayload } from "./hypothesisEvaluator.js";
import { initBuiltInLevers } from "./levers/index.js";
import type { ApplyContext, ProposeContext } from "./registry.js";
import { buildSandbox } from "./sandboxBuilder.js";
import {
    revertAllFromOriginal,
    snapshotSandboxOriginal,
} from "./sandboxRevert.js";
import type {
    CaseResult,
    EvaluationResult,
    OptimizationRun,
} from "./types.js";
import {
    DEFAULT_CONCURRENCY,
    ensureDir,
    pmap,
} from "./util.js";

import { openai, type ChatModel } from "aiclient";
import { schemaGuidelines } from "../../translation/schemaGuidelines.js";

// =============================================================================
// Types
// =============================================================================

export interface CorpusLoopOpts {
    /** Path to neighborhoods.json (output of `@collision neighborhoods`). */
    neighborhoodsPath: string;
    /** Path to translation-results.json (the baseline probe). */
    baselinePath: string;
    /** Workdir-level output base. The runner creates
     *  `<workdir>/optimization-run-<ts>/` inside it. */
    workdir: string;
    /** Live source provider — the sandbox is built from this. */
    sourceProvider: ActionConfigProvider;
    /** ActionContext for any LLM/probe calls. */
    context: ActionContext<CommandHandlerContext>;

    /** Top-N cases to run. Default 5. */
    top?: number;
    /** Severity tiers to include. Default ["blocker", "leaky"]. */
    severities?: ("blocker" | "leaky" | "minor")[];
    /** Lever name filter. Default: all registered. */
    leverFilter?: string[];
    /** Recursion depth. Phase 3 default 0; Phase 8 raises to 2. */
    depth?: number;
    /** Per-attempt probe runner. When omitted, the orchestrator can't do
     *  real evaluations; only useful for dry-run. */
    runProbe?: (
        runRoot: string,
        hypothesis: import("./types.js").Hypothesis,
        caseDesc: import("./types.js").CaseDescription,
    ) => Promise<DiffPayload>;
    /** Combined re-probe of stacked winners over the full corpus. Optional
     *  in Phase 3 — Phase 5's `validate` command provides the real one. */
    runCombinedReprobe?: (
        runRoot: string,
        winners: CaseResult[],
    ) => Promise<EvaluationResult>;
    /** Dry-run mode propagates to caseLoop. No LLM, no apply, no probe. */
    dryRun?: boolean;
    /** Concurrency for case loops. Default DEFAULT_CONCURRENCY. */
    concurrency?: number;
    /** Progress callback. Called with the per-phase progress label. */
    onProgress?: (label: string) => void;
}

// =============================================================================
// Public API
// =============================================================================

export async function runCorpusLoop(
    opts: CorpusLoopOpts,
): Promise<OptimizationRun> {
    initBuiltInLevers();

    const runId = newRunId();
    const runRoot = path.join(opts.workdir, `optimization-run-${runId}`);
    ensureDir(runRoot);

    opts.onProgress?.(`reading inputs from ${opts.neighborhoodsPath}…`);
    const { neighborhoods, gravity } = readNeighborhoods(
        opts.neighborhoodsPath,
    );
    const translationResults = readTranslationResults(opts.baselinePath);

    // ---- Pick top-N cases by gravity + severity filter ----
    const severities = new Set<"blocker" | "leaky" | "minor">(
        opts.severities ?? ["blocker", "leaky"],
    );
    const ranked = rankNeighborhoods(neighborhoods, gravity, severities);
    const top = ranked.slice(0, opts.top ?? 5);

    // ---- Build + snapshot sandbox ----
    opts.onProgress?.(`building sandbox for ${top.length} case(s)…`);
    const sandboxDir = path.join(runRoot, "sandbox");
    ensureDir(sandboxDir);
    const involvedSchemas = uniqueSchemas(top);
    const buildResult = buildSandbox({
        sandboxDir,
        sourceProvider: opts.sourceProvider,
        schemaNames: involvedSchemas,
    });
    snapshotSandboxOriginal(sandboxDir);

    // ---- Filter cases whose schemas aren't all materializable ----
    // Dynamic sub-actions (e.g. taskflow flows registered at runtime)
    // can appear as neighborhood members but lack a buildable
    // ActionConfig — the live provider returns undefined for
    // `tryGetActionConfig("taskflow.dailyAgendaEmail")`. Letting these
    // through means the lever crashes at apply time with a missing-
    // checksum error. Skip them up front and surface in coverage.
    const skippedSchemaSet = new Set(
        buildResult.skipped.map((s) => s.schemaName),
    );
    const runnableNeighborhoods: Neighborhood[] = [];
    const skippedCases: { neighborhoodId: string; reason: string }[] = [];
    for (const n of top) {
        const unbuildable = n.members.filter((m) =>
            skippedSchemaSet.has(m.schemaName),
        );
        if (unbuildable.length > 0) {
            skippedCases.push({
                neighborhoodId: n.id,
                reason: `schema(s) not materializable in sandbox: ${unbuildable
                    .map((m) => m.schemaName)
                    .join(", ")}`,
            });
            continue;
        }
        runnableNeighborhoods.push(n);
    }
    if (skippedCases.length > 0) {
        opts.onProgress?.(
            `skipping ${skippedCases.length} case(s) with non-materializable schemas (e.g. dynamic sub-actions)`,
        );
    }

    // ---- Run per-case loops ----
    const casesDir = path.join(runRoot, "cases");
    ensureDir(casesDir);
    const caseResults: CaseResult[] = [];

    const cases = runnableNeighborhoods.map((n, i) => ({
        neighborhood: n,
        index: i,
    }));

    // Run cases sequentially. Within a case, hypotheses are evaluated
    // sequentially too (sandbox state requires it). The concurrency knob
    // is reserved for future per-case parallelism via sandbox subdirs.
    void opts.concurrency;
    void pmap;
    void DEFAULT_CONCURRENCY;

    for (const c of cases) {
        const caseSlug = caseDirSlug(c.index, c.neighborhood);
        const caseDir = path.join(casesDir, caseSlug);

        opts.onProgress?.(
            `[case ${c.index + 1}/${cases.length}] ${caseSlug} — analyzing…`,
        );
        let caseDesc;
        try {
            caseDesc = await analyzeCase({
                neighborhood: c.neighborhood,
                translationResults,
                provider: opts.sourceProvider,
                createModel: (name) => openai.createChatModel(name),
                schemaGuidelines,
                ...(opts.dryRun && { skipLLM: true }),
                severityTier: pickSeverity(c.neighborhood, gravity),
                sandboxDir,
            });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            skippedCases.push({
                neighborhoodId: c.neighborhood.id,
                reason: `analyzeCase failed: ${reason}`,
            });
            opts.onProgress?.(
                `[case ${c.index + 1}/${cases.length}] ${caseSlug} — skipped (${reason})`,
            );
            continue;
        }

        opts.onProgress?.(
            `[case ${c.index + 1}/${cases.length}] ${caseSlug} — generating + evaluating…`,
        );

        let result;
        try {
            result = await runCaseLoop({
                caseDesc,
                caseDir,
                buildProposeCtx: (cd) => buildProposeCtx(cd, runRoot),
                buildApplyCtx: (cd) =>
                    buildApplyCtx(cd, opts.sourceProvider, sandboxDir),
                ...(opts.leverFilter && { leverFilter: opts.leverFilter }),
                maxDepth: opts.depth ?? 0,
                runProbe: async (hypothesis, cd) => {
                    if (opts.runProbe) {
                        return opts.runProbe(runRoot, hypothesis, cd);
                    }
                    // Dry-run fallthrough — should not be reached when dryRun
                    // is set because caseLoop short-circuits before calling.
                    return { rescues: 0, regressions: 0, regressionPhrases: [] };
                },
                revertSandbox: () => {
                    // Revert ALL schemas — the stacked-winner flow in Phase 5
                    // will replace this with a more targeted revert.
                    revertAllFromOriginal(sandboxDir);
                },
                ...(opts.dryRun && { dryRun: true }),
            });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            skippedCases.push({
                neighborhoodId: c.neighborhood.id,
                reason: `caseLoop crashed: ${reason}`,
            });
            opts.onProgress?.(
                `[case ${c.index + 1}/${cases.length}] ${caseSlug} — skipped mid-run (${reason})`,
            );
            continue;
        }
        caseResults.push(result);

        // Append patterns.jsonl rows (one per attempt).
        appendPatternsJsonl(
            opts.workdir,
            runId,
            caseSlug,
            result,
        );
    }

    // ---- Stack winners + combined re-probe (optional Phase 3) ----
    let combinedReprobe: EvaluationResult | undefined;
    if (opts.runCombinedReprobe && !opts.dryRun) {
        const winners = caseResults.filter((r) => r.winner !== null);
        if (winners.length > 0) {
            opts.onProgress?.(
                `stacking ${winners.length} winner(s) for combined re-probe…`,
            );
            combinedReprobe = await opts.runCombinedReprobe(runRoot, winners);
        }
    }

    // ---- Write optimization-run.json ----
    const coverage = computeCoverage(
        ranked,
        top,
        involvedSchemas,
        buildResult.skipped.map((s) => s.schemaName),
        gravity,
    );
    if (skippedCases.length > 0) {
        coverage.skippedCases = skippedCases;
    }
    const run: OptimizationRun = {
        schemaVersion: 1,
        runId,
        builtAt: new Date().toISOString(),
        inputs: {
            baseline: opts.baselinePath,
            corpus: opts.neighborhoodsPath,
        },
        cases: caseResults,
        ...(combinedReprobe && { combinedReprobe }),
        sandboxRoot: sandboxDir,
        corpusCoverage: coverage,
    };
    fs.writeFileSync(
        path.join(runRoot, "optimization-run.json"),
        JSON.stringify(run, undefined, 2),
    );
    opts.onProgress?.(`wrote ${runRoot}`);
    // Sandbox builder skip reasons are logged via the coverage report;
    // keep the variable referenced so it isn't a no-unused error.
    void buildResult;

    return run;
}

// =============================================================================
// ApplyContext + ProposeContext factories
// =============================================================================

function buildProposeCtx(caseDir: string, runRoot: string): ProposeContext {
    return {
        createModel: (name) => createProposeModel(name, 16384),
        pmap,
        workdir: runRoot,
        outDir: caseDir,
        schemaGuidelines,
    };
}

/**
 * Build a ChatModel for the lever propose path with an enlarged response
 * cap. Bumping the cap matters because propose prompts emit verbose JSON
 * (schema rewrites with WRONG/RIGHT example blocks, K hypotheses per call).
 * The default cap (~4k tokens) truncates responses and fails the whole
 * batch's JSON parse.
 *
 * The cap parameter migrated from `max_tokens` to `max_completion_tokens`
 * between GPT-4 and GPT-5/reasoning-model APIs:
 *   - GPT-4 family: accepts `max_tokens`; may not recognize the newer
 *     parameter.
 *   - GPT-5 / reasoning models: reject `max_tokens` with a 400 error;
 *     require `max_completion_tokens`.
 *
 * The caller can't tell which family the resolved endpoint belongs to at
 * createChatModel time, so this wrapper probes: try the modern parameter
 * first, fall back to the legacy one on a 400 that names the parameter.
 * The choice is cached per logical endpoint name so subsequent calls
 * skip the probe.
 */
const tokenParamCache = new Map<string, "modern" | "legacy">();

function createProposeModel(
    endpointName: string,
    cap: number,
): ChatModel {
    const buildModel = (param: "modern" | "legacy") =>
        openai.createChatModel(
            endpointName,
            param === "modern"
                ? { max_completion_tokens: cap }
                : { max_tokens: cap },
        );

    const cached = tokenParamCache.get(endpointName);
    if (cached) {
        return buildModel(cached);
    }

    // First call for this endpoint — probe via a wrapper that retries
    // on the specific 400 signature ("Setting 'max_tokens'" /
    // "max_completion_tokens" in the error message). On success, cache
    // the working param for the rest of the run.
    const modernModel = buildModel("modern");
    const originalComplete = modernModel.complete.bind(modernModel);
    const wrapped: ChatModel = {
        ...modernModel,
        complete: async (...args: Parameters<typeof originalComplete>) => {
            const result = await originalComplete(...args);
            if (result.success) {
                tokenParamCache.set(endpointName, "modern");
                return result;
            }
            const msg = result.message ?? "";
            const looksLikeParamRejection =
                /400/.test(msg) &&
                (/max_completion_tokens/i.test(msg) ||
                    /unsupported parameter/i.test(msg) ||
                    /unknown parameter/i.test(msg));
            if (!looksLikeParamRejection) {
                return result;
            }
            // Endpoint doesn't accept max_completion_tokens. Retry
            // with max_tokens, cache the legacy choice.
            tokenParamCache.set(endpointName, "legacy");
            const legacy = buildModel("legacy");
            return legacy.complete(...args);
        },
    };
    return wrapped;
}

function buildApplyCtx(
    caseDesc: import("./types.js").CaseDescription,
    sourceProvider: ActionConfigProvider,
    sandboxDir: string,
): ApplyContext {
    return {
        originalProvider: sourceProvider,
        sandboxDir,
        schemaSourceLookup(schemaName: string) {
            const schemaDir = path.join(sandboxDir, "agents", schemaName);
            return {
                tsPath: path.join(schemaDir, "schema.ts"),
                pasPath: path.join(schemaDir, "schema.pas.json"),
                manifestPath: path.join(schemaDir, "manifest.json"),
            };
        },
        checksums: caseDesc.originalChecksum,
    };
}

// =============================================================================
// Helpers
// =============================================================================

function newRunId(): string {
    return new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "");
}

interface NeighborhoodsFile {
    neighborhoods: Neighborhood[];
    gravity: Record<string, ActionGravity[]>;
}

function readNeighborhoods(p: string): NeighborhoodsFile {
    if (!fs.existsSync(p)) {
        throw new Error(
            `neighborhoods file not found: ${p}. Run @collision neighborhoods first.`,
        );
    }
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
        neighborhoods: parsed.neighborhoods ?? [],
        gravity: parsed.gravity ?? {},
    };
}

function readTranslationResults(p: string): TranslationProbeFile {
    if (!fs.existsSync(p)) {
        throw new Error(
            `translation results file not found: ${p}. Run @collision corpus translate first.`,
        );
    }
    return JSON.parse(fs.readFileSync(p, "utf-8")) as TranslationProbeFile;
}

interface RankedNeighborhood {
    neighborhood: Neighborhood;
    score: number;
}

/**
 * Rank neighborhoods by user-visible misroute volume:
 * Σ endUserOwedTraffic across members, falling back to misrouteCount when
 * gravity is missing. Filters out neighborhoods whose max-severity tier
 * isn't in `severities`.
 */
function rankNeighborhoods(
    neighborhoods: Neighborhood[],
    gravity: Record<string, ActionGravity[]>,
    severities: Set<"blocker" | "leaky" | "minor">,
): Neighborhood[] {
    const ranked: RankedNeighborhood[] = [];
    for (const n of neighborhoods) {
        const g = gravity[n.id] ?? [];
        // ActionGravity reports tiers as "blocker" | "leaky" | "clean".
        // Map "clean" -> "minor" before comparing against the requested
        // severities; the optimize vocabulary excludes "clean."
        const matchesSeverity =
            g.length === 0 ||
            g.some((m) => {
                const tier =
                    m.severityTier === "clean"
                        ? "minor"
                        : m.severityTier;
                return tier !== undefined && severities.has(tier);
            });
        if (!matchesSeverity) continue;
        let score = 0;
        for (const m of g) score += m.endUserOwedTraffic ?? 0;
        if (score === 0) {
            // Fall back to total misroute count when translator gravity
            // didn't populate.
            const ranker = (n.evidence.misrouteCount ?? 0);
            const tx = totalTranslatorEdgeCount(
                n.evidence.translatorMisrouteEdges,
            );
            score = ranker + tx;
        }
        ranked.push({ neighborhood: n, score });
    }
    ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.neighborhood.members.length !== a.neighborhood.members.length) {
            return b.neighborhood.members.length - a.neighborhood.members.length;
        }
        return a.neighborhood.id.localeCompare(b.neighborhood.id);
    });
    return ranked.map((r) => r.neighborhood);
}

function totalTranslatorEdgeCount(
    edges:
        | import("../types.js").MisrouteEdgeEvidence[]
        | undefined,
): number {
    if (!edges) return 0;
    let n = 0;
    for (const e of edges) n += e.count;
    return n;
}

function uniqueSchemas(neighborhoods: Neighborhood[]): string[] {
    const set = new Set<string>();
    for (const n of neighborhoods) {
        for (const m of n.members) set.add(m.schemaName);
    }
    return [...set];
}

function pickSeverity(
    neighborhood: Neighborhood,
    gravity: Record<string, ActionGravity[]>,
): "blocker" | "leaky" | "minor" {
    const g = gravity[neighborhood.id] ?? [];
    if (g.some((m) => m.severityTier === "blocker")) return "blocker";
    if (g.some((m) => m.severityTier === "leaky")) return "leaky";
    // ActionGravity carries "clean" for translator-handled cases; map to
    // minor since the optimize loop's severity vocabulary uses minor for
    // "not worth a blocker tier."
    return "minor";
}

function caseDirSlug(index: number, n: Neighborhood): string {
    const padded = String(index + 1).padStart(3, "0");
    // Use the neighborhood's existing slug; replace separators that
    // confuse path traversal.
    const safe = n.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `case-${padded}-${safe}`;
}

function computeCoverage(
    allRanked: Neighborhood[],
    selected: Neighborhood[],
    materializedSchemas: string[],
    skippedSchemas: string[],
    gravity: Record<string, ActionGravity[]>,
): OptimizationRun["corpusCoverage"] {
    const totalMass = totalMassFromGravity(allRanked, gravity);
    const reachableMass = totalMassFromGravity(selected, gravity);
    void materializedSchemas;
    return {
        totalCollisionMass: totalMass,
        reachableMass,
        skippedAgents: skippedSchemas,
    };
}

function totalMassFromGravity(
    ns: Neighborhood[],
    gravity: Record<string, ActionGravity[]>,
): number {
    let total = 0;
    for (const n of ns) {
        const g = gravity[n.id] ?? [];
        for (const m of g) total += m.endUserOwedTraffic ?? 0;
        if (g.length === 0) {
            total +=
                (n.evidence.misrouteCount ?? 0) +
                totalTranslatorEdgeCount(n.evidence.translatorMisrouteEdges);
        }
    }
    return total;
}

function appendPatternsJsonl(
    workdir: string,
    runId: string,
    caseSlug: string,
    result: CaseResult,
): void {
    const out = path.join(workdir, "patterns.jsonl");
    const lines: string[] = [];
    for (const a of result.attempts) {
        const row = {
            runId,
            caseId: caseSlug,
            schemaName: result.case.members[0]?.schemaName ?? "",
            actionName: result.case.members[0]?.actionName ?? "",
            neighborhoodId: result.case.neighborhoodId,
            failurePattern: result.case.failurePattern,
            failurePatternHeuristic: result.case.failurePatternHeuristic,
            lever: a.hypothesis.lever,
            mechanism: a.hypothesis.mechanism,
            guidelineHook: a.hypothesis.guidelineHook,
            diffSummary: a.hypothesis.diffSummary,
            depth: a.hypothesis.depth,
            rescues: a.evaluation.rescues,
            regressions: a.evaluation.regressions,
            netDelta: a.evaluation.netDelta,
            score: a.evaluation.score,
            isWinner: result.winner?.artifactPath === a.artifactPath,
            regressionPhrases: a.evaluation.regressionPhrases,
            evaluationPath: a.artifactPath,
        };
        lines.push(JSON.stringify(row));
    }
    if (lines.length > 0) {
        fs.appendFileSync(out, lines.join("\n") + "\n");
    }
}

// Internal re-exports to avoid circular import surprises elsewhere.
export { computeActionGravity };
