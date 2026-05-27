// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Orchestrate `@collision optimize validate`:
//   1. Find the target optimization-run-<ts>/ directory (latest by
//      default, or --run flag).
//   2. Read optimization-run.json to recover the case results.
//   3. Stack all winners into the sandbox (revert → apply each in
//      deterministic order → write proposalsApplied.json).
//   4. Load the sandbox provider.
//   5. Run translator probe over the full baseline corpus (or filtered
//      to a single neighborhood via --phrases).
//   6. Build the impact payload (transitions, per-schema, winner
//      attribution).
//   7. Write optimization-impact.json + optimization-impact.html.

import * as fs from "node:fs";
import * as path from "node:path";

import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../../context/commandHandlerContext.js";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import type {
    TranslationCorpus,
    TranslationProbeFile,
} from "../../translation/translationProbeRunner.js";

import {
    buildImpactPayload,
    type ImpactPayload,
} from "./impactPayload.js";
import { buildImpactHTML } from "./impactViz.js";
import { initBuiltInLevers } from "./levers/index.js";
import { loadSandboxProvider } from "./sandboxProvider.js";
import { translateCorpusWithProvider } from "./sandboxTranslate.js";
import { stackWinners } from "./stackWinners.js";
import type { CaseResult, OptimizationRun } from "./types.js";

export interface ValidateImpactOpts {
    workdir: string;
    /** Run timestamp suffix (the `<ts>` in `optimization-run-<ts>/`). If
     *  omitted, the latest run under `workdir` is used. */
    runId?: string;
    /** Path to the baseline translation-results.json. When the run's
     *  recorded baseline is no longer available, this overrides. */
    baselinePathOverride?: string;
    /** When set, restrict the probe to phrases whose expectedSchema or
     *  expectedAction matches the named neighborhood. Faster iteration
     *  for cross-validating a single case. */
    neighborhoodFilter?: string;
    /** Only stack winners whose `hypothesis.id` matches one of these.
     *  Mutually exclusive with `excludeWinners`. Useful for verifying a
     *  short list of presumed-safe winners in isolation. */
    includeWinners?: string[];
    /** Stack all winners EXCEPT these. Useful for "leave-one-out"
     *  ablation — see what changes when a specific winner is dropped. */
    excludeWinners?: string[];
    sourceProvider: ActionConfigProvider;
    context: ActionContext<CommandHandlerContext>;
    onProgress?: (label: string) => void;
}

export interface ValidateImpactResult {
    runRoot: string;
    impact: ImpactPayload;
    impactJsonPath: string;
    impactHtmlPath: string;
}

export async function runValidate(
    opts: ValidateImpactOpts,
): Promise<ValidateImpactResult> {
    initBuiltInLevers();

    const runRoot = resolveRunRoot(opts.workdir, opts.runId);
    opts.onProgress?.(`reading ${runRoot}…`);
    const run = readOptimizationRun(runRoot);

    const baselinePath =
        opts.baselinePathOverride ?? run.inputs.baseline;
    if (!fs.existsSync(baselinePath)) {
        throw new Error(
            `validate: baseline ${baselinePath} not found. Pass --baseline to override.`,
        );
    }
    const baseline = JSON.parse(
        fs.readFileSync(baselinePath, "utf-8"),
    ) as TranslationProbeFile;

    // Apply the winner filter, if any. Cases whose winner doesn't pass
    // the filter retain their CaseResult but have winner nulled, which
    // stackWinners handles (records as skipped, doesn't apply).
    const filteredCases = applyWinnerFilter(run.cases, {
        ...(opts.includeWinners && { include: opts.includeWinners }),
        ...(opts.excludeWinners && { exclude: opts.excludeWinners }),
    });
    const droppedByFilter = run.cases.length - filteredCases.filter(
        (c) => c.winner !== null,
    ).length;

    // Stack all winners. This reverts sandbox to .original/ then applies
    // each winner via its lever. Fails loud on apply errors.
    opts.onProgress?.(
        `stacking winners${
            droppedByFilter > 0 ? ` (filter dropped ${droppedByFilter})` : ""
        }…`,
    );
    await stackWinners({
        sandboxDir: run.sandboxRoot,
        runId: run.runId,
        caseResults: filteredCases,
        sourceProvider: opts.sourceProvider,
    });

    // Load sandbox provider against the stacked state.
    const { provider: sandboxProvider } = loadSandboxProvider(run.sandboxRoot);

    // Build the corpus for re-probing.
    const corpus = buildCorpusFromBaseline(
        baseline,
        run.cases,
        opts.neighborhoodFilter,
    );
    if (corpus.actions.length === 0) {
        throw new Error(
            opts.neighborhoodFilter
                ? `validate: --phrases ${opts.neighborhoodFilter} matched 0 phrases`
                : "validate: baseline contained 0 phrases",
        );
    }

    opts.onProgress?.(`re-probing ${countPhrases(corpus)} phrase(s)…`);
    const candidate = await translateCorpusWithProvider(
        sandboxProvider,
        corpus,
        opts.context,
    );

    opts.onProgress?.(`computing impact…`);
    const impact = buildImpactPayload({
        baseline,
        candidate,
        baselinePath,
        candidatePath: `${runRoot}/sandbox`,
        caseResults: filteredCases,
    });

    const impactJsonPath = path.join(runRoot, "optimization-impact.json");
    const impactHtmlPath = path.join(runRoot, "optimization-impact.html");
    fs.writeFileSync(
        impactJsonPath,
        JSON.stringify(impact, undefined, 2),
    );
    fs.writeFileSync(impactHtmlPath, buildImpactHTML(impact));

    return {
        runRoot,
        impact,
        impactJsonPath,
        impactHtmlPath,
    };
}

// =============================================================================
// Helpers
// =============================================================================

interface WinnerFilter {
    include?: string[];
    exclude?: string[];
}

/**
 * Apply an include/exclude filter to the case list's winners. Cases
 * whose winner doesn't pass the filter keep their CaseResult but have
 * `winner` set to null — stackWinners records them as filter-skipped.
 * Cases that already had no winner pass through untouched.
 */
function applyWinnerFilter(
    cases: CaseResult[],
    filter: WinnerFilter,
): CaseResult[] {
    if (!filter.include && !filter.exclude) return cases;
    const includeSet = filter.include
        ? new Set(filter.include)
        : undefined;
    const excludeSet = filter.exclude
        ? new Set(filter.exclude)
        : undefined;
    return cases.map((c) => {
        if (!c.winner) return c;
        const id = c.winner.hypothesis.id;
        const passesInclude = !includeSet || includeSet.has(id);
        const passesExclude = !excludeSet || !excludeSet.has(id);
        if (passesInclude && passesExclude) return c;
        return { ...c, winner: null };
    });
}

function resolveRunRoot(workdir: string, runId?: string): string {
    if (runId) {
        const candidate = path.join(workdir, `optimization-run-${runId}`);
        if (!fs.existsSync(candidate)) {
            throw new Error(
                `validate: run dir ${candidate} not found`,
            );
        }
        return candidate;
    }
    // Pick the most recent optimization-run-* directory by mtime.
    if (!fs.existsSync(workdir)) {
        throw new Error(`validate: workdir ${workdir} not found`);
    }
    const entries = fs
        .readdirSync(workdir, { withFileTypes: true })
        .filter(
            (e) =>
                e.isDirectory() && e.name.startsWith("optimization-run-"),
        )
        .map((e) => {
            const full = path.join(workdir, e.name);
            return { full, mtime: fs.statSync(full).mtimeMs };
        });
    if (entries.length === 0) {
        throw new Error(
            `validate: no optimization-run-* dirs under ${workdir}. Run @collision optimize explore first.`,
        );
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    return entries[0]!.full;
}

function readOptimizationRun(runRoot: string): OptimizationRun {
    const file = path.join(runRoot, "optimization-run.json");
    if (!fs.existsSync(file)) {
        throw new Error(
            `validate: ${file} not found. The run directory looks incomplete.`,
        );
    }
    return JSON.parse(fs.readFileSync(file, "utf-8")) as OptimizationRun;
}

/**
 * Re-build a TranslationCorpus from a baseline probe file. We need a
 * TranslationCorpus (with `phrases`) to feed into runTranslationProbe;
 * the probe file's rows already have phraseText + expected schema/action,
 * which is enough.
 */
function buildCorpusFromBaseline(
    baseline: TranslationProbeFile,
    caseResults: CaseResult[],
    neighborhoodFilter?: string,
): TranslationCorpus {
    const memberKeys = neighborhoodFilter
        ? membersForNeighborhood(caseResults, neighborhoodFilter)
        : undefined;

    const byAction = new Map<
        string,
        {
            schemaName: string;
            actionName: string;
            phrases: { text: string; sources: any[] }[];
        }
    >();
    for (const row of baseline.results) {
        if (memberKeys && !memberKeys.has(`${row.expectedSchema}.${row.expectedAction}`)) {
            continue;
        }
        const key = `${row.expectedSchema}.${row.expectedAction}`;
        let bucket = byAction.get(key);
        if (!bucket) {
            bucket = {
                schemaName: row.expectedSchema,
                actionName: row.expectedAction,
                phrases: [],
            };
            byAction.set(key, bucket);
        }
        bucket.phrases.push({
            text: row.phraseText,
            sources: row.phraseSources ?? [],
        });
    }
    return { actions: [...byAction.values()] };
}

function membersForNeighborhood(
    caseResults: CaseResult[],
    neighborhoodId: string,
): Set<string> {
    const target = caseResults.find(
        (c) => c.case.neighborhoodId === neighborhoodId,
    );
    if (!target) {
        throw new Error(
            `validate: neighborhood '${neighborhoodId}' not found in this run`,
        );
    }
    const set = new Set<string>();
    for (const m of target.case.members) {
        set.add(`${m.schemaName}.${m.actionName}`);
    }
    return set;
}

function countPhrases(corpus: TranslationCorpus): number {
    let n = 0;
    for (const a of corpus.actions) n += a.phrases.length;
    return n;
}
