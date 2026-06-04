// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compute the impact payload for `@collision optimize validate`. Diffs a
// candidate translator-probe file against a baseline, classifies each
// phrase transition (rescue / regression / clean-stable / still-broken /
// other), tallies per-schema and per-transition counts, and (Phase 5)
// attributes regressions to winners using a "schemas touched" heuristic
// for cross-neighborhood flagging.
//
// Mirrors the shape of `translationDiffViz.buildDiffPayload` in
// `defaultAgentProvider/src/collisions/`, but lives in dispatcher because
// optimize/ can't import upstream from defaultAgentProvider. Re-implements
// just the math; the viz lives in `impactViz.ts`.

import * as path from "node:path";

import type {
    TranslationOutcome,
    TranslationProbeFile,
    TranslationProbeRow,
} from "../../translation/translationProbeRunner.js";
import type { CaseResult } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export type TransitionClass =
    | "clean-stable"
    | "rescue"
    | "regression"
    | "still-broken"
    | "still-clarify"
    | "other";

export interface ImpactTransitionRow {
    phraseText: string;
    expectedSchema: string;
    expectedAction: string;
    baseline: {
        outcome: TranslationOutcome;
        chosenSchema?: string;
        chosenAction?: string;
    };
    candidate: {
        outcome: TranslationOutcome;
        chosenSchema?: string;
        chosenAction?: string;
    };
    transitionClass: TransitionClass;
}

export interface ImpactSchemaSummary {
    schema: string;
    baseline: Record<TranslationOutcome, number>;
    candidate: Record<TranslationOutcome, number>;
    rescued: number;
    regressed: number;
}

/** Per-winner attribution. Two complementary perspectives:
 *
 *   - **Expected-side**: phrases whose `expectedSchema` is in this
 *     winner's `schemasTouched`. The winner's neighborhood "owns" these
 *     phrases. localRescues = baseline misrouted → now CLEAN;
 *     localRegressions = baseline CLEAN → now misrouted.
 *   - **Caused-side**: regressions where the CANDIDATE's `chosenSchema`
 *     is in this winner's `schemasTouched`. The winner's edit pulled
 *     phrases that previously routed correctly into the wrong target.
 *     This is the more accurate "this winner caused that regression"
 *     signal.
 *
 *  The OLD `crossNeighborhoodRegressions` heuristic (count regressions
 *  whose expectedSchema is NOT in schemasTouched) shared blame across
 *  every winner whose neighborhood didn't include the regression's
 *  expected — meaning with N winners stacked, every winner appeared to
 *  cause ~(total regressions × (N-1)/N). Useless for triage.
 *  `causedRegressions` replaces it.
 */
export interface WinnerImpact {
    /** Canonical attempt id (e.g. `h02-jsdoc`). */
    attemptId: string;
    caseId: string;
    /** Case directory slug (`case-NNN-<sanitized neighborhood>`). Used by
     *  the impact viz to link each row into its `case.html`. Derived from
     *  the winner's artifact path. Optional for backward compatibility
     *  with older payloads. */
    caseSlug?: string;
    /** Schemas this winner's edits touched (from the case's members). */
    schemasTouched: string[];
    /** Rescues on phrases whose expectedSchema is in `schemasTouched`. */
    localRescues: number;
    /** Regressions on phrases whose expectedSchema is in `schemasTouched`. */
    localRegressions: number;
    /** Regressions where the CANDIDATE routed to a schema in
     *  `schemasTouched`. Strongest signal that this winner's edit
     *  pulled phrases it shouldn't have. */
    causedRegressions: number;
    /** Local net contribution: localRescues − localRegressions −
     *  causedRegressions. Negative means this winner is net-harmful
     *  even before considering shared regressions. */
    localNet: number;
    /** Flagged when `causedRegressions > localRescues`. The winner
     *  pulled in more wrong-target phrases than it rescued. Reviewer
     *  should consider dropping. */
    causedRegression: boolean;
    /** @deprecated The old shared-blame metric. Retained as 0 in v2
     *  for backward compatibility with prior `optimization-impact.json`
     *  readers. Will be removed in a future revision. */
    crossNeighborhoodRegressions: number;
    /** @deprecated Always false in v2; use `causedRegression`. */
    crossNeighborhoodRegression: boolean;
}

export interface ImpactPayload {
    schemaVersion: 1;
    builtAt: string;
    inputs: { baseline: string; candidate: string };
    /** Aggregated transition counts. */
    transitions: {
        cleanStable: number;
        rescued: number;
        regressed: number;
        stillBroken: number;
        stillClarify: number;
        other: number;
        /** Total phrases joined across both probes. */
        total: number;
    };
    /** Per-(baselineOutcome × candidateOutcome) count grid. */
    transitionMatrix: Record<
        TranslationOutcome,
        Record<TranslationOutcome, number>
    >;
    /** Per-schema rescue/regression counts. */
    bySchema: ImpactSchemaSummary[];
    /** Per-phrase rows. Capped to keep the JSON manageable; the viz
     *  paginates. */
    rows: ImpactTransitionRow[];
    /** Per-winner cross-neighborhood attribution. */
    winners: WinnerImpact[];
}

// =============================================================================
// Public API
// =============================================================================

export interface BuildImpactPayloadOpts {
    baseline: TranslationProbeFile;
    candidate: TranslationProbeFile;
    /** Paths recorded in `inputs` for provenance. */
    baselinePath: string;
    candidatePath: string;
    /** CaseResults whose winners were stacked. Used to attribute
     *  rescues/regressions to winners. */
    caseResults: CaseResult[];
    /** Cap on the per-row payload (viz paginates). Default 5000. */
    rowCap?: number;
}

export function buildImpactPayload(
    opts: BuildImpactPayloadOpts,
): ImpactPayload {
    const rowCap = opts.rowCap ?? 5000;
    const baselineByKey = indexByPhrase(opts.baseline.results);
    const candidateByKey = indexByPhrase(opts.candidate.results);

    const rows: ImpactTransitionRow[] = [];
    const transitions = {
        cleanStable: 0,
        rescued: 0,
        regressed: 0,
        stillBroken: 0,
        stillClarify: 0,
        other: 0,
        total: 0,
    };
    const transitionMatrix = emptyMatrix();
    const bySchema = new Map<string, ImpactSchemaSummary>();

    // Walk baseline rows; join with candidate by (expectedSchema,
    // expectedAction, phraseText). Phrases unique to either side are
    // skipped — they signal corpus mismatch rather than a translator
    // behavior change.
    for (const baselineRow of opts.baseline.results) {
        const key = keyOf(baselineRow);
        const candidateRow = candidateByKey.get(key);
        if (!candidateRow) continue;

        const transition = classifyTransition(
            baselineRow.outcome,
            candidateRow.outcome,
        );
        transitions.total++;
        transitionMatrix[baselineRow.outcome][candidateRow.outcome]++;

        switch (transition) {
            case "clean-stable":
                transitions.cleanStable++;
                break;
            case "rescue":
                transitions.rescued++;
                break;
            case "regression":
                transitions.regressed++;
                break;
            case "still-broken":
                transitions.stillBroken++;
                break;
            case "still-clarify":
                transitions.stillClarify++;
                break;
            case "other":
                transitions.other++;
                break;
        }

        // Per-schema rollup.
        const schemaSummary = getOrCreateSchemaSummary(
            bySchema,
            baselineRow.expectedSchema,
        );
        schemaSummary.baseline[baselineRow.outcome]++;
        schemaSummary.candidate[candidateRow.outcome]++;
        if (transition === "rescue") schemaSummary.rescued++;
        if (transition === "regression") schemaSummary.regressed++;

        // Per-phrase row (capped).
        if (rows.length < rowCap) {
            rows.push({
                phraseText: baselineRow.phraseText,
                expectedSchema: baselineRow.expectedSchema,
                expectedAction: baselineRow.expectedAction,
                baseline: {
                    outcome: baselineRow.outcome,
                    ...(baselineRow.chosenSchema && {
                        chosenSchema: baselineRow.chosenSchema,
                    }),
                    ...(baselineRow.chosenAction && {
                        chosenAction: baselineRow.chosenAction,
                    }),
                },
                candidate: {
                    outcome: candidateRow.outcome,
                    ...(candidateRow.chosenSchema && {
                        chosenSchema: candidateRow.chosenSchema,
                    }),
                    ...(candidateRow.chosenAction && {
                        chosenAction: candidateRow.chosenAction,
                    }),
                },
                transitionClass: transition,
            });
        }
    }

    // Per-winner attribution.
    const winners = attributeToWinners(opts.caseResults, rows);
    void baselineByKey;

    return {
        schemaVersion: 1,
        builtAt: new Date().toISOString(),
        inputs: {
            baseline: opts.baselinePath,
            candidate: opts.candidatePath,
        },
        transitions,
        transitionMatrix,
        bySchema: [...bySchema.values()].sort((a, b) =>
            a.schema.localeCompare(b.schema),
        ),
        rows,
        winners,
    };
}

// =============================================================================
// Transition classification — same semantics as translationDiffViz
// =============================================================================

export function classifyTransition(
    baseline: TranslationOutcome,
    candidate: TranslationOutcome,
): TransitionClass {
    if (baseline === "CLEAN" && candidate === "CLEAN") return "clean-stable";
    if (baseline !== "CLEAN" && candidate === "CLEAN") return "rescue";
    if (baseline === "CLEAN" && candidate !== "CLEAN") return "regression";
    if (baseline === "MISROUTE" && candidate === "MISROUTE")
        return "still-broken";
    if (baseline === "CLARIFY" && candidate === "CLARIFY")
        return "still-clarify";
    return "other";
}

// =============================================================================
// Winner attribution
// =============================================================================

/**
 * Per-winner attribution. Two attribution paths:
 *
 *   Expected-side (legacy): phrases whose `expectedSchema` is in the
 *   winner's `schemasTouched`. These count toward `localRescues` /
 *   `localRegressions` — phrases the neighborhood "owns."
 *
 *   Caused-side (new): regressions where the CANDIDATE'S `chosenSchema`
 *   is in the winner's `schemasTouched`. These count toward
 *   `causedRegressions` — the winner's edit pulled the phrase into a
 *   wrong target. This is the meaningful "this winner is responsible"
 *   signal.
 *
 * Multiple winners can touch overlapping schemas; in that case caused-
 * side attribution will count the same regression for each implicated
 * winner. That's intentional shared blame for actually-overlapping
 * causes (rare in v1 because each case targets disjoint schemas).
 *
 * The legacy `crossNeighborhoodRegressions` field is set to 0 in the
 * output for backward compatibility — old readers see zero rather
 * than the bogus inflated value the prior heuristic produced.
 */
function attributeToWinners(
    caseResults: CaseResult[],
    rows: ImpactTransitionRow[],
): WinnerImpact[] {
    const out: WinnerImpact[] = [];
    for (const caseResult of caseResults) {
        if (!caseResult.winner) continue;
        const schemas = new Set(
            caseResult.case.members.map((m) => m.schemaName),
        );
        let localRescues = 0;
        let localRegressions = 0;
        let causedRegressions = 0;
        for (const row of rows) {
            const expectedIsLocal = schemas.has(row.expectedSchema);
            if (row.transitionClass === "rescue" && expectedIsLocal) {
                localRescues++;
                continue;
            }
            if (row.transitionClass === "regression") {
                if (expectedIsLocal) {
                    localRegressions++;
                }
                const candidateChose = row.candidate.chosenSchema;
                if (candidateChose && schemas.has(candidateChose)) {
                    causedRegressions++;
                }
            }
        }
        const localNet = localRescues - localRegressions - causedRegressions;
        // Derive case slug from the winner's artifactPath, which is
        // `<runDir>/cases/<caseSlug>/attempts/<id>`. Two `dirname` hops up
        // from the attempt dir gets us the case dir; the basename is the
        // slug. Falls back to undefined if the path doesn't match.
        const winnerPath = caseResult.winner.artifactPath;
        const caseSlug = winnerPath
            ? path.basename(path.dirname(path.dirname(winnerPath)))
            : undefined;
        out.push({
            attemptId: caseResult.winner.hypothesis.id,
            caseId: caseResult.case.neighborhoodId,
            ...(caseSlug && { caseSlug }),
            schemasTouched: [...schemas].sort(),
            localRescues,
            localRegressions,
            causedRegressions,
            localNet,
            causedRegression: causedRegressions > localRescues,
            // Backward-compat zeros — old readers see neutral values.
            crossNeighborhoodRegressions: 0,
            crossNeighborhoodRegression: false,
        });
    }
    return out;
}

// =============================================================================
// Helpers
// =============================================================================

function emptyMatrix(): Record<
    TranslationOutcome,
    Record<TranslationOutcome, number>
> {
    const outs: TranslationOutcome[] = [
        "CLEAN",
        "MISROUTE",
        "CLARIFY",
        "INVALID",
        "ERROR",
    ];
    const out = {} as Record<
        TranslationOutcome,
        Record<TranslationOutcome, number>
    >;
    for (const a of outs) {
        out[a] = {} as Record<TranslationOutcome, number>;
        for (const b of outs) out[a][b] = 0;
    }
    return out;
}

function emptyOutcomeCounts(): Record<TranslationOutcome, number> {
    return { CLEAN: 0, MISROUTE: 0, CLARIFY: 0, INVALID: 0, ERROR: 0 };
}

function getOrCreateSchemaSummary(
    map: Map<string, ImpactSchemaSummary>,
    schema: string,
): ImpactSchemaSummary {
    let s = map.get(schema);
    if (!s) {
        s = {
            schema,
            baseline: emptyOutcomeCounts(),
            candidate: emptyOutcomeCounts(),
            rescued: 0,
            regressed: 0,
        };
        map.set(schema, s);
    }
    return s;
}

function keyOf(row: {
    expectedSchema: string;
    expectedAction: string;
    phraseText: string;
}): string {
    return `${row.expectedSchema}\0${row.expectedAction}\0${row.phraseText}`;
}

function indexByPhrase(
    rows: readonly TranslationProbeRow[],
): Map<string, TranslationProbeRow> {
    const out = new Map<string, TranslationProbeRow>();
    for (const row of rows) {
        const k = keyOf(row);
        if (!out.has(k)) out.set(k, row);
    }
    return out;
}
