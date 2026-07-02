// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The decision rule (§10): given the scorer's per-candidate numbers, decide
// whether to resolve to the top candidate or abstain. Biased toward abstaining —
// a wrong silent reroute is worse than a missed opportunity. All comparisons run
// on quantized scores over a total ordering so the same conversation state always
// yields the same decision (§12).

import { CandidateScore } from "./scorer.js";

export type DecisionConfig = {
    // Evidence gate: minimum distinct distinguishing tokens the winner must
    // match (default 2).
    minUniqueTokens: number;
    // Evidence gate: minimum winner score (matched mass).
    minMass: number;
    // Clear-winner margin: winner must beat the runner-up by at least this.
    margin: number;
};

// The count-based (TF-IDF) strategy's abstain reasons. A non-lexical strategy
// (embedding) supplies its own reason string — hence `ContextSelectorDecision`
// types `reason` as the wider `string`.
export type AbstainReason =
    | "coverage"
    | "no-candidates"
    | "no-signal"
    | "min-unique-tokens"
    | "min-mass"
    | "margin";

export type ContextSelectorDecision =
    | {
          kind: "resolve";
          winner: CandidateScore;
          runnerUp: CandidateScore | undefined;
          ranked: CandidateScore[];
      }
    | {
          kind: "abstain";
          // See AbstainReason for the count-based strategy's values; any strategy
          // may supply its own. Surfaced in telemetry as `abstain:<reason>`.
          reason: string;
          ranked: CandidateScore[];
      };

// Fixed-precision quantization so float summation order can't flip a borderline
// threshold/margin comparison (§12).
const QUANTUM = 1e6;
export function quantize(x: number): number {
    return Math.round(x * QUANTUM) / QUANTUM;
}

// Total ordering (§12): quantized score desc, then schemaName asc, then
// actionName asc. No reliance on Map/insertion order.
export function rankScores(scores: CandidateScore[]): CandidateScore[] {
    return [...scores].sort((a, b) => {
        const qa = quantize(a.score);
        const qb = quantize(b.score);
        if (qa !== qb) {
            return qb - qa;
        }
        if (a.schemaName !== b.schemaName) {
            return a.schemaName < b.schemaName ? -1 : 1;
        }
        return a.actionName < b.actionName
            ? -1
            : a.actionName > b.actionName
              ? 1
              : 0;
    });
}

// The four checks, in order (§10). `covered` is the coverage guard result
// (every colliding candidate has a non-empty keyword vector), computed by the
// caller since it needs the keyword sets. History-only (check 2) is guaranteed
// upstream by the signal source, so it is not re-checked here.
export function decide(
    scores: CandidateScore[],
    covered: boolean,
    config: DecisionConfig,
): ContextSelectorDecision {
    const ranked = rankScores(scores);
    if (!covered) {
        return { kind: "abstain", reason: "coverage", ranked };
    }
    if (ranked.length === 0) {
        return { kind: "abstain", reason: "no-candidates", ranked };
    }
    const winner = ranked[0];
    const runnerUp = ranked.length > 1 ? ranked[1] : undefined;

    const winnerScore = quantize(winner.score);
    const winnerUnique = winner.uniqueTokenCount ?? 0;
    if (winnerUnique === 0 || winnerScore <= 0) {
        return { kind: "abstain", reason: "no-signal", ranked };
    }
    if (winnerUnique < config.minUniqueTokens) {
        return { kind: "abstain", reason: "min-unique-tokens", ranked };
    }
    if (winnerScore < quantize(config.minMass)) {
        return { kind: "abstain", reason: "min-mass", ranked };
    }
    const runnerUpScore = runnerUp ? quantize(runnerUp.score) : 0;
    if (winnerScore - runnerUpScore < quantize(config.margin)) {
        return { kind: "abstain", reason: "margin", ranked };
    }
    return { kind: "resolve", winner, runnerUp, ranked };
}
