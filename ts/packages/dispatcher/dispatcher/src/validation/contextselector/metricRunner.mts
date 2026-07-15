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

// Negation-scope guard (§7): production default is ON (session.ts negationGuard).
// The benchmark mirrors production; set CS_NEGATION_GUARD=0 to replay the
// pre-guard baseline for a before/after comparison.
const NEGATION_GUARD = process.env.CS_NEGATION_GUARD !== "0";

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
        negationGuard: NEGATION_GUARD,
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

// The context-BLIND collision-resolution strategies (matchCollision.ts). Each
// picks a single candidate from the collision set WITHOUT reading the
// conversation, so on a context-dependent collision it is right only when its
// fixed rule happens to land on the intended target. Modeled faithfully for the
// offline corpus:
//   first-match  — candidates[0] (the cache/grammar order).
//   priority     — the agent-priority order. No registration data offline, so a
//                  fixed alphabetical id order stands in; ANY fixed order is
//                  context-blind, which is the whole point of the comparison.
//   score-rank   — strongest grammar match, ties -> priority. A genuine collision
//                  is exactly the case where the constructions matched the SAME
//                  input, so their match heuristics tie and score-rank falls
//                  through to priority here (reported, and noted, as == priority).
//   user-clarify — never auto-resolves; always defers to a user prompt (0
//                  misroutes, but a prompt every time).
export type BaselineStrategy =
    | "first-match"
    | "score-rank"
    | "priority"
    | "user-clarify";

export const BASELINE_STRATEGIES: BaselineStrategy[] = [
    "first-match",
    "score-rank",
    "priority",
    "user-clarify",
];

// The context-blind strategies that SILENTLY auto-resolve (so contextSelector can
// be deployed "on top of" them as the abstain-fallback and its lift measured).
// user-clarify is excluded — it prompts rather than routing, so an accuracy lift
// is ill-defined; its value is prompt-avoidance, reported separately.
export const SILENT_STRATEGIES: BaselineStrategy[] = [
    "first-match",
    "score-rank",
    "priority",
];

function priorityPick(candidates: readonly string[]): string {
    // Fixed, context-blind order — alphabetical by full "schema.action" id.
    return [...candidates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
}

// What a baseline strategy would silently route to, or undefined if it defers
// (user-clarify) instead of auto-resolving.
function baselinePick(
    strategy: BaselineStrategy,
    candidates: readonly string[],
): string | undefined {
    switch (strategy) {
        case "first-match":
            return candidates[0];
        case "score-rank": // ties -> priority on a genuine collision
        case "priority":
            return priorityPick(candidates);
        case "user-clarify":
            return undefined; // defers to the user
    }
}

// One strategy's behavior on the resolvable set: how often it lands on the
// labeled target (correct), silently routes to the wrong candidate (misroute),
// or defers/abstains (no silent decision). Rates are over the resolvable fixtures.
export type StrategyAccuracy = {
    strategy: string;
    correct: number;
    wrong: number;
    deferred: number; // user-clarify defers; contextSelector abstains
    accuracy: number; // correct / resolvable
    misrouteRate: number; // wrong / resolvable
    deferRate: number; // deferred / resolvable
};

// Deploying contextSelector "on top of" a silent auto-resolver X: on a confident
// pick it resolves, otherwise it falls back to X. `deployedAccuracy` is that
// combined accuracy on the resolvable set; `lift` is the gain over X alone; and
// `noRegression` is the safety gate — CS must never make a per-target class worse
// than X did (only possible via a misroute where X was right). This is the
// "strictly additive vs X" claim, generalized past first-match.
export type DeployedLift = {
    strategy: string;
    baselineAccuracy: number; // X standalone (== StrategyAccuracy.accuracy)
    deployedAccuracy: number; // CS resolves, else X
    lift: number;
    noRegression: boolean;
};

// The full head-to-head: every context-blind baseline plus contextSelector, over
// the resolvable set, so contextSelector's lift over EACH strategy is visible
// (not just first-match).
export type StrategyComparison = {
    resolvable: number;
    contextSelector: StrategyAccuracy;
    baselines: StrategyAccuracy[];
    // contextSelector accuracy − baseline accuracy, per baseline strategy.
    liftOverBaseline: Record<string, number>;
    // contextSelector misroute − baseline misroute (negative = safer), per
    // baseline strategy.
    misrouteDeltaVsBaseline: Record<string, number>;
    // Deployed routing-lift of CS-on-top-of-X, for each silent auto-resolver X.
    deployed: DeployedLift[];
};

export type MetricsResult = {
    total: number;
    thresholds: Thresholds;
    retrieval: RetrievalMetrics;
    properties: PropertyCheck[];
    trigger: TriggerMetrics;
    resolution: ResolutionMetrics;
    ab: AbMetrics;
    strategies: StrategyComparison;
};

// All mutable counters the per-fixture loop accumulates. Per-strategy maps are
// seeded to zero for every baseline / silent strategy up front so the loop body
// never has to test for first-touch.
type MetricsTally = {
    resolvable: number;
    abstainable: number;
    triggeredOnResolvable: number;
    abstainedOnAbstainable: number;
    spuriousResolve: number;
    totalResolves: number;
    trueResolve: number;
    wrongTarget: number;
    clarifyOrLlmAvoided: number;
    // Standalone correct/wrong/deferred per baseline strategy, over resolvable.
    stratCorrect: Record<string, number>;
    stratWrong: Record<string, number>;
    stratDeferred: Record<string, number>;
    // Deployed (CS-on-top-of-X) correct tally + per-target-class base/treat for
    // the no-regression gate, per silent auto-resolver X.
    deployedCorrect: Record<string, number>;
    perClassByStrat: Record<
        string,
        Map<string, { base: number; treat: number }>
    >;
    spuriousByReason: Record<string, number>;
    abstainByReason: Record<string, number>;
};

function createTally(): MetricsTally {
    const stratCorrect: Record<string, number> = {};
    const stratWrong: Record<string, number> = {};
    const stratDeferred: Record<string, number> = {};
    const deployedCorrect: Record<string, number> = {};
    const perClassByStrat: Record<
        string,
        Map<string, { base: number; treat: number }>
    > = {};
    for (const s of BASELINE_STRATEGIES) {
        stratCorrect[s] = 0;
        stratWrong[s] = 0;
        stratDeferred[s] = 0;
    }
    for (const s of SILENT_STRATEGIES) {
        deployedCorrect[s] = 0;
        perClassByStrat[s] = new Map();
    }
    return {
        resolvable: 0,
        abstainable: 0,
        triggeredOnResolvable: 0,
        abstainedOnAbstainable: 0,
        spuriousResolve: 0,
        totalResolves: 0,
        trueResolve: 0,
        wrongTarget: 0,
        clarifyOrLlmAvoided: 0,
        stratCorrect,
        stratWrong,
        stratDeferred,
        deployedCorrect,
        perClassByStrat,
        spuriousByReason: {},
        abstainByReason: {},
    };
}

// Tally every context-blind baseline for one resolvable fixture, plus the
// deployed CS-on-top-of-X projection (per-target-class base/treat) used by the
// no-regression gate. `csResolves`/`csResolvedCorrect` describe contextSelector's
// decision on this fixture.
function tallyBaselines(
    tally: MetricsTally,
    fixture: Fixture,
    target: string,
    cls: string,
    csResolves: boolean,
    csResolvedCorrect: boolean,
): void {
    for (const s of BASELINE_STRATEGIES) {
        const pick = baselinePick(s, fixture.candidates);
        const xCorrect = pick !== undefined && pick === target;
        if (pick === undefined) {
            tally.stratDeferred[s]++;
        } else if (xCorrect) {
            tally.stratCorrect[s]++;
        } else {
            tally.stratWrong[s]++;
        }
        // Deployed: CS resolves -> its pick; else fall back to X. Only silent
        // auto-resolvers are projected (seeded in perClassByStrat).
        if (!(s in tally.perClassByStrat)) {
            continue;
        }
        const deployed = csResolves ? csResolvedCorrect : xCorrect;
        if (deployed) {
            tally.deployedCorrect[s]++;
        }
        const pc = tally.perClassByStrat[s].get(cls) ?? { base: 0, treat: 0 };
        if (xCorrect) pc.base++;
        if (deployed) pc.treat++;
        tally.perClassByStrat[s].set(cls, pc);
    }
}

// Accumulate one fixture whose label is "resolve": bump the resolvable count,
// fan out across the baselines, and record contextSelector's own hit/miss.
function tallyResolvable(
    tally: MetricsTally,
    fixture: Fixture,
    decision: Decision,
    target: string,
): void {
    tally.resolvable++;
    const cls = target.split(".")[0];
    const csResolvedCorrect =
        decision.kind === "resolve" && decision.target === target;
    tallyBaselines(
        tally,
        fixture,
        target,
        cls,
        decision.kind === "resolve",
        csResolvedCorrect,
    );
    if (decision.kind === "resolve") {
        tally.triggeredOnResolvable++;
        if (csResolvedCorrect) tally.trueResolve++;
        else tally.wrongTarget++;
    }
}

// Accumulate one fixture whose label is "abstain": bump the abstainable count
// and record whether contextSelector correctly abstained or spuriously resolved.
function tallyAbstainable(
    tally: MetricsTally,
    decision: Decision,
    reason: string,
): void {
    tally.abstainable++;
    tally.abstainByReason[reason] = (tally.abstainByReason[reason] ?? 0) + 1;
    if (decision.kind === "resolve") {
        tally.spuriousResolve++;
        tally.spuriousByReason[reason] =
            (tally.spuriousByReason[reason] ?? 0) + 1;
    } else {
        tally.abstainedOnAbstainable++;
    }
}

// One strategy's StrategyAccuracy over the resolvable set (`r` = max(1,
// resolvable)).
function makeAccuracy(
    name: string,
    correct: number,
    wrong: number,
    deferred: number,
    r: number,
): StrategyAccuracy {
    return {
        strategy: name,
        correct,
        wrong,
        deferred,
        accuracy: correct / r,
        misrouteRate: wrong / r,
        deferRate: deferred / r,
    };
}

// Deployed routing-lift of CS-on-top-of-X, for each silent auto-resolver.
function buildDeployedLifts(tally: MetricsTally, r: number): DeployedLift[] {
    return SILENT_STRATEGIES.map((s) => {
        const baselineAccuracy = tally.stratCorrect[s] / r;
        const deployedAccuracy = tally.deployedCorrect[s] / r;
        return {
            strategy: s,
            baselineAccuracy,
            deployedAccuracy,
            lift: deployedAccuracy - baselineAccuracy,
            noRegression: [...tally.perClassByStrat[s].values()].every(
                (c) => c.treat >= c.base,
            ),
        };
    });
}

// The head-to-head StrategyComparison: contextSelector's lift and misroute delta
// over each baseline, plus the deployed lifts.
function buildStrategyComparison(
    tally: MetricsTally,
    deployed: DeployedLift[],
    csAccuracy: StrategyAccuracy,
    baselines: StrategyAccuracy[],
): StrategyComparison {
    const liftOverBaseline: Record<string, number> = {};
    const misrouteDeltaVsBaseline: Record<string, number> = {};
    for (const b of baselines) {
        liftOverBaseline[b.strategy] = csAccuracy.accuracy - b.accuracy;
        misrouteDeltaVsBaseline[b.strategy] =
            csAccuracy.misrouteRate - b.misrouteRate;
    }
    return {
        resolvable: tally.resolvable,
        contextSelector: csAccuracy,
        baselines,
        liftOverBaseline,
        misrouteDeltaVsBaseline,
        deployed,
    };
}

export function runMetrics(
    roster: Roster,
    fixtures: Fixture[],
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
): MetricsResult {
    const tally = createTally();

    for (const fixture of fixtures) {
        const decision = decide(roster, fixture, thresholds);
        if (decision.kind === "resolve") {
            tally.totalResolves++;
            tally.clarifyOrLlmAvoided++;
        }
        if (fixture.label.kind === "resolve") {
            tallyResolvable(tally, fixture, decision, fixture.label.target);
        } else {
            tallyAbstainable(tally, decision, fixture.label.reason);
        }
    }

    const total = fixtures.length;
    const r = Math.max(1, tally.resolvable);
    const ab = Math.max(1, tally.abstainable);

    const deployed = buildDeployedLifts(tally, r);
    // Legacy first-match A/B view is just the first-match deployed entry.
    const firstMatchDeployed = deployed.find(
        (d) => d.strategy === "first-match",
    )!;

    // contextSelector standalone on the resolvable set: resolve->target = correct,
    // resolve->other = misroute, abstain = deferred (missed, not wrong).
    const csAbstainedOnResolvable =
        tally.resolvable - tally.triggeredOnResolvable;
    const csAccuracy = makeAccuracy(
        "contextSelector",
        tally.trueResolve,
        tally.wrongTarget,
        csAbstainedOnResolvable,
        r,
    );
    const baselines = BASELINE_STRATEGIES.map((s) =>
        makeAccuracy(
            s,
            tally.stratCorrect[s],
            tally.stratWrong[s],
            tally.stratDeferred[s],
            r,
        ),
    );

    return {
        total,
        thresholds,
        retrieval: measureRetrieval(roster, fixtures, thresholds),
        properties: retrievalPropertyChecks(thresholds),
        trigger: {
            resolvable: tally.resolvable,
            abstainable: tally.abstainable,
            triggeredOnResolvable: tally.triggeredOnResolvable,
            yield: tally.triggeredOnResolvable / r,
            abstainedOnAbstainable: tally.abstainedOnAbstainable,
            abstentionCorrectness: tally.abstainedOnAbstainable / ab,
            spuriousResolve: tally.spuriousResolve,
            spuriousResolveRate: tally.spuriousResolve / ab,
            triggerPrecision:
                tally.totalResolves > 0
                    ? tally.triggeredOnResolvable / tally.totalResolves
                    : 1,
            spuriousByReason: tally.spuriousByReason,
            abstainByReason: tally.abstainByReason,
        },
        resolution: {
            resolves: tally.triggeredOnResolvable,
            trueResolve: tally.trueResolve,
            wrongTarget: tally.wrongTarget,
            targetAccuracy:
                tally.triggeredOnResolvable > 0
                    ? tally.trueResolve / tally.triggeredOnResolvable
                    : 1,
            wrongTargetCount: tally.wrongTarget,
            wrr:
                (tally.wrongTarget + tally.spuriousResolve) /
                Math.max(1, total),
        },
        ab: {
            baselineAccuracy: firstMatchDeployed.baselineAccuracy,
            treatmentAccuracy: firstMatchDeployed.deployedAccuracy,
            routingAccuracyLift: firstMatchDeployed.lift,
            noRegression: firstMatchDeployed.noRegression,
            clarifyOrLlmAvoided: tally.clarifyOrLlmAvoided,
        },
        strategies: buildStrategyComparison(
            tally,
            deployed,
            csAccuracy,
            baselines,
        ),
    };
}
