// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Cross-run pattern miner. Reads `patterns.jsonl` (one row per attempt
// across all `@collision optimize explore` runs the workdir has
// accumulated), aggregates into three orthogonal groupings:
//
//   - byMechanism: FailurePattern × Mechanism (lever-agnostic). Primary
//     grid; feeds the Phase 9 distiller because mechanisms generalize
//     across levers.
//   - byLeverMechanism: per-lever FailurePattern × Mechanism drill-downs
//     (sparse — `prune` only emits `deprecate`, etc.). Operator uses for
//     lever-set tuning.
//   - byLever: FailurePattern × Lever lever-effectiveness view.
//
// Plus a heuristic-vs-LLM classifier agreement matrix — surfaces drift
// between the cheap lexical heuristic in caseAnalyzer and the LLM-refined
// FailurePattern label.
//
// The miner is pure: takes parsed rows, returns the report. Filtering
// (--min-attempts threshold) happens at viz time so the JSON output
// retains full data for downstream tooling.

import type { FailurePattern, Mechanism } from "./types.js";

// =============================================================================
// Row schema (matches corpusLoop's patterns.jsonl writer)
// =============================================================================

export interface PatternRow {
    runId: string;
    caseId: string;
    schemaName: string;
    actionName: string;
    neighborhoodId: string;
    failurePattern: FailurePattern;
    /** Raw heuristic classification — recorded BEFORE LLM refinement. */
    failurePatternHeuristic: FailurePattern;
    lever: string;
    mechanism: Mechanism;
    guidelineHook: string | null;
    diffSummary?: {
        addedLines?: number;
        removedLines?: number;
        touchesIdentityLine?: boolean;
        addsAntiExample?: boolean;
    };
    depth: number;
    rescues: number;
    regressions: number;
    netDelta: number;
    score: number;
    isWinner: boolean;
    regressionPhrases: string[];
    evaluationPath: string;
}

// =============================================================================
// Report shape
// =============================================================================

export interface CellStats {
    attempts: number;
    wins: number;
    /** wins / attempts; 0 when attempts === 0. */
    winRate: number;
    /** Mean attempt.score. */
    meanScore: number;
    /** attempts where regressions > 0, divided by attempts. */
    regressionRate: number;
    /** Up to 3 sample evaluationPaths — for the operator to drill into. */
    samples: string[];
}

export interface ClassifierAgreement {
    /** Per-failurePattern (refined): agreement count + total. Open
     *  string-keyed record so the miner is forgiving with rows whose
     *  failurePattern field isn't in the v1 enum (forward-compatible
     *  for future pattern additions). */
    perPattern: Record<
        string,
        {
            attempts: number;
            heuristicMatches: number;
            disagreementRate: number;
        }
    >;
    overall: {
        attempts: number;
        heuristicMatches: number;
        disagreementRate: number;
    };
}

export interface PatternsReport {
    schemaVersion: 1;
    builtAt: string;
    runs: string[];
    totalAttempts: number;
    totalRuns: number;
    /** Primary grid: aggregated across levers. */
    byMechanism: Record<string, Record<string, CellStats>>;
    /** Per-lever drill-down. Top-level key is lever name. */
    byLeverMechanism: Record<string, Record<string, Record<string, CellStats>>>;
    /** Lever-effectiveness view. */
    byLever: Record<string, Record<string, CellStats>>;
    /** Heuristic vs. LLM classifier agreement. */
    classifierAgreement: ClassifierAgreement;
}

// =============================================================================
// Public API
// =============================================================================

export interface MinePatternsOpts {
    rows: PatternRow[];
    /** Identifiers for the run dirs the rows came from. Recorded in the
     *  report metadata; doesn't affect aggregation. */
    runDirs?: string[];
}

export function minePatterns(opts: MinePatternsOpts): PatternsReport {
    const rows = opts.rows;
    const runIds = new Set<string>();
    for (const r of rows) runIds.add(r.runId);

    const byMechanism: Record<string, Record<string, CellStats>> = {};
    const byLeverMechanism: Record<
        string,
        Record<string, Record<string, CellStats>>
    > = {};
    const byLever: Record<string, Record<string, CellStats>> = {};

    for (const row of rows) {
        const fp = row.failurePattern || "unclassified";
        const mech = row.mechanism || "other";
        const lever = row.lever;

        accumulate(byMechanism, fp, mech, row);
        accumulateLeverMechanism(byLeverMechanism, lever, fp, mech, row);
        accumulate(byLever, fp, lever, row);
    }

    // Convert running tallies → CellStats (divide accumulators).
    finalize(byMechanism);
    for (const lever of Object.keys(byLeverMechanism)) {
        finalize(byLeverMechanism[lever]!);
    }
    finalize(byLever);

    const classifierAgreement = computeClassifierAgreement(rows);

    return {
        schemaVersion: 1,
        builtAt: new Date().toISOString(),
        runs: opts.runDirs ?? [...runIds].sort(),
        totalAttempts: rows.length,
        totalRuns: runIds.size,
        byMechanism,
        byLeverMechanism,
        byLever,
        classifierAgreement,
    };
}

/**
 * Parse the jsonl file content (one JSON object per non-empty line).
 * Tolerant of trailing newlines and blank lines. Lines that fail to
 * parse are skipped silently; mining is meant to be best-effort across
 * accumulated history rather than strict.
 */
export function parsePatternsJsonl(content: string): PatternRow[] {
    const out: PatternRow[] = [];
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
            const obj = JSON.parse(trimmed);
            if (typeof obj === "object" && obj !== null) {
                out.push(obj as PatternRow);
            }
        } catch {
            // Skip malformed line.
        }
    }
    return out;
}

// =============================================================================
// Accumulators (intermediate state mutates CellStats in place; finalize
// computes derived fields).
// =============================================================================

interface AccumCell {
    attempts: number;
    wins: number;
    scoreSum: number;
    regressionAttempts: number;
    samples: string[];
}

function getOrCreateCell<T>(
    bucket: Record<string, Record<string, T>>,
    rowKey: string,
    colKey: string,
    factory: () => T,
): T {
    if (!bucket[rowKey]) bucket[rowKey] = {};
    if (!bucket[rowKey][colKey]) bucket[rowKey][colKey] = factory();
    return bucket[rowKey][colKey];
}

function accumulate(
    grid: Record<string, Record<string, AccumCell | CellStats>>,
    rowKey: string,
    colKey: string,
    row: PatternRow,
): void {
    const cell = getOrCreateCell(grid, rowKey, colKey, () => ({
        attempts: 0,
        wins: 0,
        scoreSum: 0,
        regressionAttempts: 0,
        samples: [],
    })) as AccumCell;
    cell.attempts++;
    if (row.score > 0) cell.wins++;
    cell.scoreSum += row.score;
    if (row.regressions > 0) cell.regressionAttempts++;
    if (cell.samples.length < 3 && row.evaluationPath) {
        cell.samples.push(row.evaluationPath);
    }
}

function accumulateLeverMechanism(
    bucket: Record<string, Record<string, Record<string, CellStats>>>,
    lever: string,
    fp: string,
    mech: string,
    row: PatternRow,
): void {
    if (!bucket[lever]) bucket[lever] = {};
    accumulate(bucket[lever], fp, mech, row);
}

function finalize(
    grid: Record<string, Record<string, AccumCell | CellStats>>,
): void {
    for (const rowKey of Object.keys(grid)) {
        for (const colKey of Object.keys(grid[rowKey]!)) {
            const cell = grid[rowKey]![colKey]! as AccumCell;
            const final: CellStats = {
                attempts: cell.attempts,
                wins: cell.wins,
                winRate: cell.attempts > 0 ? cell.wins / cell.attempts : 0,
                meanScore:
                    cell.attempts > 0 ? cell.scoreSum / cell.attempts : 0,
                regressionRate:
                    cell.attempts > 0
                        ? cell.regressionAttempts / cell.attempts
                        : 0,
                samples: cell.samples,
            };
            grid[rowKey]![colKey] = final;
        }
    }
}

// =============================================================================
// Classifier agreement
// =============================================================================

function computeClassifierAgreement(rows: PatternRow[]): ClassifierAgreement {
    const perPattern: ClassifierAgreement["perPattern"] = {};
    let overallAttempts = 0;
    let overallMatches = 0;

    // We aggregate cases (not attempts) — each attempt for the same case
    // shares the same (refined, heuristic) classification, so counting
    // every attempt would over-weight large-K cases. Dedup by (runId,
    // caseId) before counting.
    const seenCases = new Set<string>();

    for (const r of rows) {
        const key = `${r.runId}\0${r.caseId}`;
        if (seenCases.has(key)) continue;
        seenCases.add(key);

        const refined = r.failurePattern || "unclassified";
        const heuristic = r.failurePatternHeuristic || "unclassified";
        const matches = refined === heuristic;
        if (!perPattern[refined]) {
            perPattern[refined] = {
                attempts: 0,
                heuristicMatches: 0,
                disagreementRate: 0,
            };
        }
        perPattern[refined].attempts++;
        if (matches) perPattern[refined].heuristicMatches++;
        overallAttempts++;
        if (matches) overallMatches++;
    }

    for (const key of Object.keys(perPattern)) {
        const entry = perPattern[key]!;
        entry.disagreementRate =
            entry.attempts > 0
                ? 1 - entry.heuristicMatches / entry.attempts
                : 0;
    }

    return {
        perPattern,
        overall: {
            attempts: overallAttempts,
            heuristicMatches: overallMatches,
            disagreementRate:
                overallAttempts > 0 ? 1 - overallMatches / overallAttempts : 0,
        },
    };
}
