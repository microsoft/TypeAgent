// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Trigger-DISCIPLINE benchmark for the contextSelector collision tier (design
// §9-11): 50 action-collision scenarios where the tier SHOULD trigger (resolve to
// the contextually-correct agent) and 50 where it SHOULD NOT (abstain and defer).
// Each case runs the REAL pipeline end to end — RingBufferSignalSource decay +
// TfIdfScorer + the shipped decision gate (minUniqueTokens=2, minMass=1.0,
// margin=0.5) — over a two-candidate grammar collision built from disjoint,
// themed agent vocabularies. The trigger set confirms we fire (and pick right)
// on clear conversational evidence; the no-trigger set confirms we stay out on
// ties, unrelated chatter, thin/stale signal, missing keyword coverage, and empty
// history. Deterministic, offline, no LLM.

import { RingBufferSignalSource } from "../src/context/contextSelector/conversationSignal.js";
import { TfIdfStrategy } from "../src/context/contextSelector/strategy.js";
import { ScorerCandidate } from "../src/context/contextSelector/scorer.js";
import { DecisionConfig } from "../src/context/contextSelector/decision.js";

// Shipped production defaults (session.ts + conversationSignal.ts).
const THRESHOLDS: DecisionConfig = {
    minUniqueTokens: 2,
    minMass: 1.0,
    margin: 0.5,
};
const strategy = new TfIdfStrategy();

// Ten agents with strictly DISJOINT topical vocabularies, so every keyword is
// discriminating (candidate-local IDF = 1) — a clean collision where only the
// conversation can break the tie.
const VOCAB: Record<string, string[]> = {
    excel: ["spreadsheet", "formula", "pivot", "workbook", "macro"],
    list: ["grocery", "checklist", "errand", "todo", "pantry"],
    calendar: ["meeting", "appointment", "agenda", "reminder", "invitee"],
    email: ["inbox", "attachment", "recipient", "signature", "mailbox"],
    player: ["playlist", "album", "artist", "chorus", "melody"],
    browser: ["bookmark", "homepage", "extension", "incognito", "webpage"],
    weather: ["forecast", "humidity", "sunrise", "precipitation", "drizzle"],
    maps: ["route", "destination", "traffic", "navigation", "landmark"],
    notes: ["notebook", "memo", "annotation", "outline", "snippet"],
    finance: ["portfolio", "dividend", "invoice", "ledger", "budget"],
};
const AGENTS = Object.keys(VOCAB);

function candidate(agent: string, keywords?: string[]): ScorerCandidate {
    return {
        schemaName: agent,
        actionName: "run",
        keywords: new Set(keywords ?? VOCAB[agent]),
    };
}

function contextVector(prelude: string[], negationGuard = true) {
    const s = new RingBufferSignalSource(() => ({
        windowTurns: 20,
        decay: 0.9,
        negationGuard,
    }));
    for (const turn of prelude) {
        s.recordRequest(turn);
    }
    return s.getContextVector();
}

function decide(prelude: string[], candidates: ScorerCandidate[]) {
    return strategy.evaluate(contextVector(prelude), candidates, THRESHOLDS)
        .decision;
}

// ---------------------------------------------------------------------------
// Trigger set — 50 collisions that MUST resolve to the on-topic agent.
// ---------------------------------------------------------------------------
type TriggerCase = {
    id: string;
    prelude: string[];
    candidates: ScorerCandidate[];
    target: string; // expected winning schema
};

function buildTriggerCases(): TriggerCase[] {
    const cases: TriggerCase[] = [];
    for (let i = 0; i < AGENTS.length; i++) {
        const winner = AGENTS[i];
        // Pair each winner against five different distractor agents.
        for (let j = 1; j <= 5; j++) {
            const loser = AGENTS[(i + j) % AGENTS.length];
            // 2-3 distinct on-topic tokens in the most-recent turn — decayed mass
            // 1.8-2.4, all discriminating, well clear of the gate and the margin.
            const k = 2 + (j % 2); // 2 or 3 tokens
            const topic = VOCAB[winner].slice(0, k);
            cases.push({
                id: `trigger-${winner}-vs-${loser}-${k}tok`,
                prelude: [`work on the ${topic.join(" ")}`],
                candidates: [candidate(winner), candidate(loser)],
                target: winner,
            });
        }
    }
    return cases;
}

const TRIGGER_CASES = buildTriggerCases();

// ---------------------------------------------------------------------------
// No-trigger set — 50 collisions that MUST abstain (defer to today's routing).
// ---------------------------------------------------------------------------
type NoTriggerCase = {
    id: string;
    prelude: string[];
    candidates: ScorerCandidate[];
    bucket: string;
};

const GLUE = "just do that"; // all stopwords/generic-verbs — contributes nothing

function buildNoTriggerCases(): NoTriggerCase[] {
    const cases: NoTriggerCase[] = [];

    // Balanced tie: both candidates get equal discriminating mass -> margin fails.
    for (let i = 0; i < 10; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 3) % AGENTS.length];
        cases.push({
            id: `notrigger-tie-${a}-${b}`,
            prelude: [
                `${VOCAB[a].slice(0, 2).join(" ")} ${VOCAB[b].slice(0, 2).join(" ")}`,
            ],
            candidates: [candidate(a), candidate(b)],
            bucket: "tie",
        });
    }

    // No signal: the conversation is about a THIRD agent, unrelated to either
    // candidate -> nothing matches -> abstain (no-signal).
    for (let i = 0; i < 10; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 1) % AGENTS.length];
        const third = AGENTS[(i + 5) % AGENTS.length];
        cases.push({
            id: `notrigger-nosignal-${a}-${b}`,
            prelude: [`talk about the ${VOCAB[third].slice(0, 3).join(" ")}`],
            candidates: [candidate(a), candidate(b)],
            bucket: "no-signal",
        });
    }

    // Thin signal: a single on-topic token -> below minUniqueTokens (2).
    for (let i = 0; i < 10; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 2) % AGENTS.length];
        cases.push({
            id: `notrigger-thin-${a}-${b}`,
            prelude: [`the ${VOCAB[a][0]}`],
            candidates: [candidate(a), candidate(b)],
            bucket: "thin",
        });
    }

    // Stale signal: two on-topic tokens, but pushed far enough back by glue that
    // the decayed mass falls below minMass (1.0).
    for (let i = 0; i < 8; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 4) % AGENTS.length];
        const prelude = [`${VOCAB[a].slice(0, 2).join(" ")}`];
        for (let p = 0; p < 8; p++) {
            prelude.push(GLUE);
        }
        cases.push({
            id: `notrigger-stale-${a}-${b}`,
            prelude,
            candidates: [candidate(a), candidate(b)],
            bucket: "stale",
        });
    }

    // Coverage gap: one candidate has no keyword vector at all -> abstain.
    for (let i = 0; i < 6; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 6) % AGENTS.length];
        cases.push({
            id: `notrigger-coverage-${a}-${b}`,
            prelude: [`work on the ${VOCAB[a].slice(0, 3).join(" ")}`],
            candidates: [candidate(a), candidate(b, [])],
            bucket: "coverage",
        });
    }

    // Empty history: no conversation at all -> no signal.
    for (let i = 0; i < 6; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 7) % AGENTS.length];
        cases.push({
            id: `notrigger-empty-${a}-${b}`,
            prelude: [],
            candidates: [candidate(a), candidate(b)],
            bucket: "empty",
        });
    }

    return cases;
}

const NO_TRIGGER_CASES = buildNoTriggerCases();

// ---------------------------------------------------------------------------
// Multi-turn variants: the evidence (or the ambiguity) is spread ACROSS several
// conversational turns rather than packed into one, exercising the ring-buffer's
// cross-turn decay accumulation on the decision path.
// ---------------------------------------------------------------------------

// 25 collisions that build enough on-topic evidence over multiple turns (with an
// interleaved glue turn) to resolve to the winner.
function buildMultiTurnTriggerCases(): TriggerCase[] {
    const cases: TriggerCase[] = [];
    for (let i = 0; i < AGENTS.length && cases.length < 25; i++) {
        const winner = AGENTS[i];
        for (let j = 1; j <= 3 && cases.length < 25; j++) {
            const loser = AGENTS[(i + j) % AGENTS.length];
            const t = VOCAB[winner];
            // Three distinct on-topic tokens spread over three turns (a glue turn
            // interleaved) — decayed mass ~2.4, all discriminating.
            cases.push({
                id: `mt-trigger-${winner}-vs-${loser}`,
                prelude: [
                    `let's open the ${t[0]}`,
                    GLUE,
                    `now check the ${t[1]}`,
                    `and the ${t[2]}`,
                ],
                candidates: [candidate(winner), candidate(loser)],
                target: winner,
            });
        }
    }
    return cases;
}

// 25 multi-turn collisions that must still abstain: evidence alternates evenly
// between the two candidates (tie), the conversation is about a third agent
// across turns (no-signal), or the on-topic turn decays behind later glue (stale).
function buildMultiTurnNoTriggerCases(): NoTriggerCase[] {
    const cases: NoTriggerCase[] = [];

    // Alternating tie: turns alternate A and B tokens, so neither pulls clear.
    for (let i = 0; i < 10; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 3) % AGENTS.length];
        cases.push({
            id: `mt-notrigger-tie-${a}-${b}`,
            prelude: [
                `the ${VOCAB[a][0]}`,
                `the ${VOCAB[b][0]}`,
                `the ${VOCAB[a][1]}`,
                `the ${VOCAB[b][1]}`,
            ],
            candidates: [candidate(a), candidate(b)],
            bucket: "tie-multiturn",
        });
    }

    // No signal across turns: every turn is about a third, uninvolved agent.
    for (let i = 0; i < 8; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 1) % AGENTS.length];
        const third = AGENTS[(i + 5) % AGENTS.length];
        cases.push({
            id: `mt-notrigger-nosignal-${a}-${b}`,
            prelude: [
                `the ${VOCAB[third][0]}`,
                `the ${VOCAB[third][1]}`,
                `the ${VOCAB[third][2]}`,
            ],
            candidates: [candidate(a), candidate(b)],
            bucket: "no-signal-multiturn",
        });
    }

    // Stale across turns: on-topic first turn, then a run of glue turns decays it
    // below minMass.
    for (let i = 0; i < 7; i++) {
        const a = AGENTS[i];
        const b = AGENTS[(i + 4) % AGENTS.length];
        const prelude = [`the ${VOCAB[a][0]} ${VOCAB[a][1]}`];
        for (let p = 0; p < 8; p++) {
            prelude.push(GLUE);
        }
        cases.push({
            id: `mt-notrigger-stale-${a}-${b}`,
            prelude,
            candidates: [candidate(a), candidate(b)],
            bucket: "stale-multiturn",
        });
    }

    return cases;
}

const MT_TRIGGER_CASES = buildMultiTurnTriggerCases();
const MT_NO_TRIGGER_CASES = buildMultiTurnNoTriggerCases();

describe("contextSelector/trigger — resolves when the collision has clear context (50)", () => {
    it("has exactly 50 unique trigger cases", () => {
        expect(TRIGGER_CASES).toHaveLength(50);
        expect(new Set(TRIGGER_CASES.map((c) => c.id)).size).toBe(50);
    });

    it.each(TRIGGER_CASES.map((c) => [c.id, c] as const))(
        "triggers and routes correctly for %s",
        (_id, c) => {
            const decision = decide(c.prelude, c.candidates);
            expect(decision.kind).toBe("resolve");
            if (decision.kind === "resolve") {
                expect(decision.winner.schemaName).toBe(c.target);
            }
        },
    );

    it("reports the aggregate trigger rate", () => {
        const resolved = TRIGGER_CASES.filter((c) => {
            const d = decide(c.prelude, c.candidates);
            return d.kind === "resolve" && d.winner.schemaName === c.target;
        }).length;
        // eslint-disable-next-line no-console
        console.log(
            `trigger rate (resolved correctly when expected): ${((resolved / TRIGGER_CASES.length) * 100).toFixed(1)}% (${resolved}/${TRIGGER_CASES.length})`,
        );
        expect(resolved).toBe(TRIGGER_CASES.length);
    });
});

describe("contextSelector/trigger — abstains when it should not trigger (50)", () => {
    it("has exactly 50 unique no-trigger cases", () => {
        expect(NO_TRIGGER_CASES).toHaveLength(50);
        expect(new Set(NO_TRIGGER_CASES.map((c) => c.id)).size).toBe(50);
    });

    it.each(NO_TRIGGER_CASES.map((c) => [c.id, c] as const))(
        "abstains for %s",
        (_id, c) => {
            const decision = decide(c.prelude, c.candidates);
            expect(decision.kind).toBe("abstain");
        },
    );

    it("reports the aggregate abstain rate by bucket", () => {
        const byBucket = new Map<
            string,
            { abstained: number; total: number }
        >();
        for (const c of NO_TRIGGER_CASES) {
            const d = decide(c.prelude, c.candidates);
            const b = byBucket.get(c.bucket) ?? { abstained: 0, total: 0 };
            b.total++;
            if (d.kind === "abstain") {
                b.abstained++;
            }
            byBucket.set(c.bucket, b);
        }
        const abstained = NO_TRIGGER_CASES.filter(
            (c) => decide(c.prelude, c.candidates).kind === "abstain",
        ).length;
        const perBucket = [...byBucket.entries()]
            .map(([k, v]) => `${k} ${v.abstained}/${v.total}`)
            .join(", ");
        // eslint-disable-next-line no-console
        console.log(
            `abstain rate (stayed out when expected): ${((abstained / NO_TRIGGER_CASES.length) * 100).toFixed(1)}% (${abstained}/${NO_TRIGGER_CASES.length}) — ${perBucket}`,
        );
        expect(abstained).toBe(NO_TRIGGER_CASES.length);
    });
});

describe("contextSelector/trigger — resolves on evidence built over multiple turns (25)", () => {
    it("has exactly 25 unique multi-turn trigger cases", () => {
        expect(MT_TRIGGER_CASES).toHaveLength(25);
        expect(new Set(MT_TRIGGER_CASES.map((c) => c.id)).size).toBe(25);
    });

    it.each(MT_TRIGGER_CASES.map((c) => [c.id, c] as const))(
        "triggers and routes correctly for %s",
        (_id, c) => {
            const decision = decide(c.prelude, c.candidates);
            expect(decision.kind).toBe("resolve");
            if (decision.kind === "resolve") {
                expect(decision.winner.schemaName).toBe(c.target);
            }
        },
    );

    it("reports the multi-turn trigger rate", () => {
        const resolved = MT_TRIGGER_CASES.filter((c) => {
            const d = decide(c.prelude, c.candidates);
            return d.kind === "resolve" && d.winner.schemaName === c.target;
        }).length;
        // eslint-disable-next-line no-console
        console.log(
            `multi-turn trigger rate: ${((resolved / MT_TRIGGER_CASES.length) * 100).toFixed(1)}% (${resolved}/${MT_TRIGGER_CASES.length})`,
        );
        expect(resolved).toBe(MT_TRIGGER_CASES.length);
    });
});

describe("contextSelector/trigger — abstains on multi-turn ambiguity (25)", () => {
    it("has exactly 25 unique multi-turn no-trigger cases", () => {
        expect(MT_NO_TRIGGER_CASES).toHaveLength(25);
        expect(new Set(MT_NO_TRIGGER_CASES.map((c) => c.id)).size).toBe(25);
    });

    it.each(MT_NO_TRIGGER_CASES.map((c) => [c.id, c] as const))(
        "abstains for %s",
        (_id, c) => {
            const decision = decide(c.prelude, c.candidates);
            expect(decision.kind).toBe("abstain");
        },
    );

    it("reports the multi-turn abstain rate by bucket", () => {
        const byBucket = new Map<
            string,
            { abstained: number; total: number }
        >();
        for (const c of MT_NO_TRIGGER_CASES) {
            const d = decide(c.prelude, c.candidates);
            const b = byBucket.get(c.bucket) ?? { abstained: 0, total: 0 };
            b.total++;
            if (d.kind === "abstain") {
                b.abstained++;
            }
            byBucket.set(c.bucket, b);
        }
        const abstained = MT_NO_TRIGGER_CASES.filter(
            (c) => decide(c.prelude, c.candidates).kind === "abstain",
        ).length;
        const perBucket = [...byBucket.entries()]
            .map(([k, v]) => `${k} ${v.abstained}/${v.total}`)
            .join(", ");
        // eslint-disable-next-line no-console
        console.log(
            `multi-turn abstain rate: ${((abstained / MT_NO_TRIGGER_CASES.length) * 100).toFixed(1)}% (${abstained}/${MT_NO_TRIGGER_CASES.length}) — ${perBucket}`,
        );
        expect(abstained).toBe(MT_NO_TRIGGER_CASES.length);
    });
});
