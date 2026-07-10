// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The three-metric engine for the contextSelector benchmark. Runs the labeled
// corpus through the REAL pipeline (real committed keyword vectors + real
// ring-buffer decay + real TF-IDF strategy + real decision rule) and measures,
// as three SEPARATE quantities the user asked for:
//
//   1. Context retrieval  — is the signal source appropriately retrieving the
//      conversation's topic? (topical concentration of the context vector +
//      pinned contract property checks: decay, windowing, history-only,
//      surface-form canonicalization, glue rejection).
//   2. Trigger discipline — do we resolve only WHEN we should, and abstain
//      otherwise (and vice versa)? (yield / abstention-correctness / spurious-
//      resolve / trigger precision over the resolve-vs-abstain axis).
//   3. Resolution correctness — WHEN we resolve, do we pick the right target?
//      (target accuracy | resolved, wrong-target count, WRR).
//
// Deterministic, no LLM, no dispatcher boot.

import {
    RingBufferSignalSource,
    ContextVector,
} from "../../context/contextSelector/conversationSignal.js";
import { TfIdfStrategy } from "../../context/contextSelector/strategy.js";
import { ScorerCandidate } from "../../context/contextSelector/scorer.js";
import { DecisionConfig } from "../../context/contextSelector/decision.js";
import { Roster } from "./metricRoster.mjs";
import { Fixture } from "./metricCorpus.mjs";

export type Thresholds = DecisionConfig & {
    decay: number;
    windowTurns: number;
};

// Shipped production defaults (session.ts + conversationSignal.ts).
export const DEFAULT_THRESHOLDS: Thresholds = {
    minUniqueTokens: 2,
    minMass: 1.0,
    margin: 0.5,
    decay: 0.9,
    windowTurns: 20,
};

type Decision =
    | { kind: "resolve"; target: string }
    | { kind: "abstain"; reason: string };

function splitId(id: string): { schemaName: string; actionName: string } {
    const dot = id.lastIndexOf(".");
    return { schemaName: id.slice(0, dot), actionName: id.slice(dot + 1) };
}

function contextFor(prelude: string[], thresholds: Thresholds): ContextVector {
    const signal = new RingBufferSignalSource(() => ({
        windowTurns: thresholds.windowTurns,
        decay: thresholds.decay,
    }));
    for (const turn of prelude) {
        signal.recordRequest(turn);
    }
    return signal.getContextVector();
}

function mass(ctx: ContextVector, tokens: readonly string[]): number {
    let m = 0;
    for (const t of tokens) {
        m += ctx.get(t) ?? 0;
    }
    return m;
}

const strategy = new TfIdfStrategy();

function decide(
    roster: Roster,
    fixture: Fixture,
    thresholds: Thresholds,
): Decision {
    const ctx = contextFor(fixture.prelude, thresholds);
    const candidates: ScorerCandidate[] = fixture.candidates.map((cid) => {
        const { schemaName, actionName } = splitId(cid);
        return {
            schemaName,
            actionName,
            keywords: roster.index.effective(schemaName, actionName),
        };
    });
    const { decision } = strategy.evaluate(ctx, candidates, thresholds);
    return decision.kind === "resolve"
        ? {
              kind: "resolve",
              target: `${decision.winner.schemaName}.${decision.winner.actionName}`,
          }
        : { kind: "abstain", reason: decision.reason };
}

// ---------------------------------------------------------------------------
// Metric 1 — Context retrieval fidelity
// ---------------------------------------------------------------------------

export type RetrievalMetrics = {
    n: number;
    // Fraction of the on-topic mass over all three token banks — how cleanly the
    // context vector concentrates on the conversation's real topic (1.0 = all
    // discriminating mass is the intended topic's).
    meanTopicShare: number;
    // Fixtures where the intended topic carried strictly the most mass.
    topicMaxRate: number;
    // Mean (topic mass − strongest competing bank's mass): the retrieval margin.
    meanSeparation: number;
    // Fixtures where the intended topic outweighs the distractor candidate.
    beatsDistractorRate: number;
};

function measureRetrieval(
    roster: Roster,
    fixtures: Fixture[],
    thresholds: Thresholds,
): RetrievalMetrics {
    let n = 0;
    let shareSum = 0;
    let topicMax = 0;
    let sepSum = 0;
    let beatsDistractor = 0;
    for (const fixture of fixtures) {
        const o = fixture.retrieval;
        if (o === undefined) {
            continue;
        }
        const ctx = contextFor(fixture.prelude, thresholds);
        const topic = mass(ctx, o.topicTokens);
        const distractor = mass(ctx, o.distractorTokens);
        const unrelated = mass(ctx, o.unrelatedTokens);
        const total = topic + distractor + unrelated;
        n++;
        shareSum += total > 0 ? topic / total : 0;
        const competitor = Math.max(distractor, unrelated);
        if (topic > distractor && topic > unrelated) {
            topicMax++;
        }
        if (topic > distractor) {
            beatsDistractor++;
        }
        sepSum += topic - competitor;
    }
    const d = Math.max(1, n);
    return {
        n,
        meanTopicShare: shareSum / d,
        topicMaxRate: topicMax / d,
        meanSeparation: sepSum / d,
        beatsDistractorRate: beatsDistractor / d,
    };
}

// Pinned retrieval-contract property checks — pass/fail, deterministic. These
// verify the signal source itself (tokenize + decay + window) does its job.
export type PropertyCheck = { name: string; pass: boolean; detail: string };

export function retrievalPropertyChecks(
    thresholds: Thresholds,
): PropertyCheck[] {
    const checks: PropertyCheck[] = [];
    const signal = () =>
        new RingBufferSignalSource(() => ({
            windowTurns: thresholds.windowTurns,
            decay: thresholds.decay,
        }));

    // Recency decay: a token in the newer turn outweighs one in an older turn.
    {
        const s = signal();
        s.recordRequest("the grocery for the day");
        s.recordRequest("the checklist for the day");
        const v = s.getContextVector();
        const older = v.get("grocery") ?? 0; // age 2
        const newer = v.get("checklist") ?? 0; // age 1
        checks.push({
            name: "recency-decay",
            pass: newer > older && older > 0,
            detail: `newer=${newer.toFixed(3)} > older=${older.toFixed(3)}`,
        });
    }

    // Windowing: a token only present outside the look-back window is dropped.
    {
        const s = signal();
        s.recordRequest("the grocery for the day");
        for (let i = 0; i < thresholds.windowTurns; i++) {
            s.recordRequest("the checklist for the day");
        }
        const v = s.getContextVector();
        checks.push({
            name: "windowing",
            pass:
                (v.get("grocery") ?? 0) === 0 && (v.get("checklist") ?? 0) > 0,
            detail: `grocery evicted after ${thresholds.windowTurns} turns`,
        });
    }

    // History-only: an unrecorded (would-be current) turn contributes nothing.
    {
        const s = signal();
        s.recordRequest("the grocery for the day");
        const v = s.getContextVector();
        checks.push({
            name: "history-only",
            pass: (v.get("vampire") ?? 0) === 0,
            detail: "unrecorded token absent from context vector",
        });
    }

    // Surface-form canonicalization: plain-"-s" plurals and casing recover the
    // canonical committed tokens. (The stemmer deliberately has no "-ies"->"-y"
    // rule and plain tokenize does not split camelCase in prose — so those forms
    // are intentionally out of scope here.)
    {
        const s = signal();
        s.recordRequest("Vampires COFFINS items lists");
        const v = s.getContextVector();
        const want = ["vampire", "coffin", "item", "list"];
        const missing = want.filter((t) => (v.get(t) ?? 0) === 0);
        checks.push({
            name: "surface-form",
            pass: missing.length === 0,
            detail:
                missing.length === 0
                    ? "vampire/coffin/item/list recovered from plural/cased forms"
                    : `missing: ${missing.join(",")}`,
        });
    }

    // Glue rejection: a pure stopword / generic-verb turn yields no signal.
    {
        const s = signal();
        s.recordRequest("please could you do this for me and the");
        const v = s.getContextVector();
        checks.push({
            name: "glue-rejection",
            pass: v.size === 0,
            detail: `context vector size ${v.size} (expected 0)`,
        });
    }

    return checks;
}

// ---------------------------------------------------------------------------
// Metric 2 — Trigger discipline  &  Metric 3 — Resolution correctness
// ---------------------------------------------------------------------------

export type TriggerMetrics = {
    resolvable: number;
    abstainable: number;
    // resolvable that we resolved (any target) — trigger recall / yield.
    triggeredOnResolvable: number;
    yield: number;
    // abstainable that we abstained — the "vice versa" (true-negative rate).
    abstainedOnAbstainable: number;
    abstentionCorrectness: number;
    // abstainable that we (wrongly) resolved — false trigger.
    spuriousResolve: number;
    spuriousResolveRate: number;
    // of ALL triggers, the fraction fired on a resolvable fixture.
    triggerPrecision: number;
    spuriousByReason: Record<string, number>;
    abstainByReason: Record<string, number>;
};

export type ResolutionMetrics = {
    resolves: number; // total resolves on resolvable fixtures
    trueResolve: number; // resolved to the labeled target
    wrongTarget: number; // resolved to the other candidate
    targetAccuracy: number; // trueResolve / resolves
    wrongTargetCount: number;
    wrr: number; // (wrongTarget + spuriousResolve) / total
};

// A/B against first-match, to show the tier is strictly additive (never worse).
export type AbMetrics = {
    baselineAccuracy: number; // first-match == target on resolvable
    treatmentAccuracy: number; // route == target on resolvable
    routingAccuracyLift: number;
    noRegression: boolean;
    clarifyOrLlmAvoided: number; // deterministic resolves a clarify would surface
};

export type MetricsResult = {
    total: number;
    thresholds: Thresholds;
    retrieval: RetrievalMetrics;
    properties: PropertyCheck[];
    trigger: TriggerMetrics;
    resolution: ResolutionMetrics;
    ab: AbMetrics;
};

export function runMetrics(
    roster: Roster,
    fixtures: Fixture[],
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
): MetricsResult {
    let resolvable = 0;
    let abstainable = 0;
    let triggeredOnResolvable = 0;
    let abstainedOnAbstainable = 0;
    let spuriousResolve = 0;
    let totalResolves = 0;
    let trueResolve = 0;
    let wrongTarget = 0;
    let baselineCorrect = 0;
    let treatmentCorrect = 0;
    let clarifyOrLlmAvoided = 0;
    const spuriousByReason: Record<string, number> = {};
    const abstainByReason: Record<string, number> = {};
    // Per-resolve-class routing for the no-regression gate.
    const perClass = new Map<string, { base: number; treat: number }>();

    for (const fixture of fixtures) {
        const decision = decide(roster, fixture, thresholds);
        const firstMatch = fixture.candidates[0];
        const route =
            decision.kind === "resolve" ? decision.target : firstMatch;
        if (decision.kind === "resolve") {
            totalResolves++;
            clarifyOrLlmAvoided++;
        }

        if (fixture.label.kind === "resolve") {
            resolvable++;
            const target = fixture.label.target;
            const baseCorrect = firstMatch === target;
            const treatCorrect = route === target;
            if (baseCorrect) baselineCorrect++;
            if (treatCorrect) treatmentCorrect++;
            const cls = target.split(".")[0];
            const pc = perClass.get(cls) ?? { base: 0, treat: 0 };
            if (baseCorrect) pc.base++;
            if (treatCorrect) pc.treat++;
            perClass.set(cls, pc);

            if (decision.kind === "resolve") {
                triggeredOnResolvable++;
                if (decision.target === target) trueResolve++;
                else wrongTarget++;
            }
        } else {
            abstainable++;
            abstainByReason[fixture.label.reason] =
                (abstainByReason[fixture.label.reason] ?? 0) + 1;
            if (decision.kind === "resolve") {
                spuriousResolve++;
                spuriousByReason[fixture.label.reason] =
                    (spuriousByReason[fixture.label.reason] ?? 0) + 1;
            } else {
                abstainedOnAbstainable++;
            }
        }
    }

    const total = fixtures.length;
    const r = Math.max(1, resolvable);
    const ab = Math.max(1, abstainable);
    const noRegression = [...perClass.values()].every((c) => c.treat >= c.base);

    return {
        total,
        thresholds,
        retrieval: measureRetrieval(roster, fixtures, thresholds),
        properties: retrievalPropertyChecks(thresholds),
        trigger: {
            resolvable,
            abstainable,
            triggeredOnResolvable,
            yield: triggeredOnResolvable / r,
            abstainedOnAbstainable,
            abstentionCorrectness: abstainedOnAbstainable / ab,
            spuriousResolve,
            spuriousResolveRate: spuriousResolve / ab,
            triggerPrecision:
                totalResolves > 0 ? triggeredOnResolvable / totalResolves : 1,
            spuriousByReason,
            abstainByReason,
        },
        resolution: {
            resolves: triggeredOnResolvable,
            trueResolve,
            wrongTarget,
            targetAccuracy:
                triggeredOnResolvable > 0
                    ? trueResolve / triggeredOnResolvable
                    : 1,
            wrongTargetCount: wrongTarget,
            wrr: (wrongTarget + spuriousResolve) / Math.max(1, total),
        },
        ab: {
            baselineAccuracy: baselineCorrect / r,
            treatmentAccuracy: treatmentCorrect / r,
            routingAccuracyLift: (treatmentCorrect - baselineCorrect) / r,
            noRegression,
            clarifyOrLlmAvoided,
        },
    };
}
