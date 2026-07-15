// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic, self-labeling conversation corpus for the contextSelector
// metric benchmark (benchmarking doc B-5). Generalizes the earlier
// list+vampire fixtures across the WHOLE committed roster: it manufactures
// collisions from real overlapping-agent pairs and composes preludes from each
// agent's REAL discriminating keywords, so every fixture carries its own label
// with no human annotation. A seeded PRNG keeps generation reproducible
// (Gate B). Composition rules and their target decisions:
//
//   resolve   prelude on-topic for the target  -> resolve to the target
//   tie       balanced, recency-matched A vs B -> abstain (margin)
//   no-signal prelude from an unrelated third  -> abstain (no-signal)
//   stale     one on-topic turn, then padding  -> abstain (min-mass)
//   coverage  target vs a keyword-less agent   -> abstain (coverage)

import { Roster, TopicalAction, discriminating } from "./metricRoster.mjs";

export type FixtureLabel =
    | { kind: "resolve"; target: string }
    | {
          kind: "abstain";
          reason: "tie" | "no-signal" | "stale" | "coverage";
      };

// Retrieval oracle attached to a fixture: the token sets the context vector
// SHOULD (topic) and should NOT (distractor / unrelated) concentrate mass on.
// Used by the context-retrieval metric, which scores the signal source in
// isolation from the decision rule.
export type RetrievalOracle = {
    topic: string; // schema the prelude is about
    topicTokens: string[]; // discriminating tokens of the topic
    distractorTokens: string[]; // discriminating tokens of the other candidate
    unrelatedTokens: string[]; // tokens of an unrelated third agent
};

export type Fixture = {
    id: string;
    prelude: string[];
    collisionInput: string;
    // candidates[0] is what first-match (the baseline) would pick.
    candidates: string[];
    label: FixtureLabel;
    // Present on fixtures with a single clear intended topic (resolve / stale).
    retrieval?: RetrievalOracle;
    // Conversation difficulty tier, for the real-agent clear-vs-vague split:
    // "clear" = obviously one agent; "vague" = ambiguous / shared vocabulary.
    tier?: "clear" | "vague";
};

// Intersection of two keyword vectors — the SHARED vocabulary two agents both
// answer to, which cancels in scoring (candidate-local IDF) and so is the raw
// material for genuinely ambiguous "vague" conversations.
export function shared(a: TopicalAction, b: TopicalAction): string[] {
    const out: string[] = [];
    for (const t of a.keywords) {
        if (b.keywords.has(t)) {
            out.push(t);
        }
    }
    return out.sort();
}

// Mulberry32 — tiny deterministic PRNG (matches the earlier benchmark).
export function makePrng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function sample(
    rng: () => number,
    pool: readonly string[],
    n: number,
): string[] {
    const copy = [...pool];
    const out: string[] = [];
    for (let i = 0; i < n && copy.length > 0; i++) {
        out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    }
    return out;
}

// One conversation turn from a set of canonical keywords: glue them with pure
// stopwords ("the", "and") so ONLY the keywords survive tokenization — keeping
// each turn's contribution to the context vector exactly its keywords.
export function turnFrom(tokens: string[]): string {
    if (tokens.length === 0) {
        return "and the";
    }
    return "the " + tokens.join(" and the ");
}

// The richest committed action per schema — that schema's topical representative
// (most discriminating signal to manufacture a collision from).
function representatives(roster: Roster): TopicalAction[] {
    const best = new Map<string, TopicalAction>();
    for (const a of roster.actions) {
        const cur = best.get(a.schemaName);
        if (cur === undefined || a.keywords.size > cur.keywords.size) {
            best.set(a.schemaName, a);
        }
    }
    return [...best.values()].sort((x, y) =>
        x.schemaName < y.schemaName ? -1 : 1,
    );
}

export type Pair = {
    a: TopicalAction;
    b: TopicalAction;
    discA: string[]; // A's tokens B lacks
    discB: string[]; // B's tokens A lacks
    third: TopicalAction | undefined; // unrelated agent, disjoint from A and B
};

// Select diverse collision pairs across DISTINCT schemas with enough mutual
// discriminating signal (each side has >= minDiscriminating tokens the other
// lacks — otherwise there is nothing for context to resolve on). Deterministic:
// pair each schema with the next `window` schemas in the sorted ring, cap total.
export function selectPairs(
    roster: Roster,
    opts: { minDiscriminating?: number; window?: number; cap?: number } = {},
): Pair[] {
    const minDisc = opts.minDiscriminating ?? 6;
    const window = opts.window ?? 3;
    const cap = opts.cap ?? 60;
    const reps = representatives(roster);
    const pairs: Pair[] = [];

    const disjointThird = (a: TopicalAction, b: TopicalAction) => {
        for (const c of reps) {
            if (
                c.schemaName === a.schemaName ||
                c.schemaName === b.schemaName
            ) {
                continue;
            }
            let overlaps = false;
            for (const t of c.keywords) {
                if (a.keywords.has(t) || b.keywords.has(t)) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) {
                return c;
            }
        }
        return undefined;
    };

    for (let i = 0; i < reps.length && pairs.length < cap; i++) {
        for (let w = 1; w <= window && pairs.length < cap; w++) {
            const j = (i + w) % reps.length;
            if (j === i) {
                continue;
            }
            const a = reps[i];
            const b = reps[j];
            const discA = discriminating(a.keywords, b.keywords);
            const discB = discriminating(b.keywords, a.keywords);
            if (discA.length < minDisc || discB.length < minDisc) {
                continue;
            }
            pairs.push({ a, b, discA, discB, third: disjointThird(a, b) });
        }
    }
    return pairs;
}

const ID = (tag: string, n: number) => `${tag}-${n}`;

export type GenOptions = {
    seed?: number;
    // On-topic turns in a resolve prelude (also the tie/stale building block).
    preludeLen?: number;
    // Padding turns after the lone on-topic turn in a stale prelude — enough
    // that its decayed mass falls under minMass at the default decay/window.
    stalePadding?: number;
    // Tokens per on-topic turn.
    tokensPerTurn?: number;
};

export function generateFixtures(
    roster: Roster,
    pairs: Pair[],
    opts: GenOptions = {},
): Fixture[] {
    const rng = makePrng(opts.seed ?? 20260708);
    const preludeLen = opts.preludeLen ?? 4;
    const stalePadding = opts.stalePadding ?? 12;
    const tpt = opts.tokensPerTurn ?? 3;
    const fixtures: Fixture[] = [];
    let n = 0;

    const onTopicPrelude = (tokens: string[], turns: number): string[] => {
        const out: string[] = [];
        for (let i = 0; i < turns; i++) {
            out.push(turnFrom(sample(rng, tokens, tpt)));
        }
        return out;
    };

    for (const pair of pairs) {
        const { a, b, discA, discB, third } = pair;
        const aId = `${a.schemaName}.${a.actionName}`;
        const bId = `${b.schemaName}.${b.actionName}`;
        const collisionInput = `handle the ${a.actionName} request`;
        const oracle = (topic: string): RetrievalOracle => ({
            topic,
            topicTokens: topic === a.schemaName ? discA : discB,
            distractorTokens: topic === a.schemaName ? discB : discA,
            unrelatedTokens: third ? [...third.keywords] : [],
        });

        // Alternate first-match position so the A/B lift over first-match is
        // actually measurable (half the time first-match is already right).
        const order = (target: string, targetFirst: boolean): string[] =>
            targetFirst
                ? [target, target === aId ? bId : aId]
                : [target === aId ? bId : aId, target];

        // RESOLVE -> A and RESOLVE -> B. Each prelude leads with one unrelated
        // third-agent turn (oldest, lowest-weight) so retrieval must overcome a
        // distractor rather than see a trivially pure on-topic history.
        const noise = third
            ? [turnFrom(sample(rng, [...third.keywords], tpt))]
            : [];
        for (const [topic, disc, tid] of [
            [a.schemaName, discA, aId],
            [b.schemaName, discB, bId],
        ] as const) {
            fixtures.push({
                id: ID(`resolve-${topic}`, n++),
                prelude: [...noise, ...onTopicPrelude(disc, preludeLen)],
                collisionInput,
                candidates: order(tid, n % 2 === 0),
                label: { kind: "resolve", target: tid },
                retrieval: oracle(topic),
            });
        }

        // TIE — alternating single-token A/B turns: both clear the evidence gate
        // but the mass margin stays under threshold.
        const tieA = sample(rng, discA, 2);
        const tieB = sample(rng, discB, 2);
        if (tieA.length === 2 && tieB.length === 2) {
            fixtures.push({
                id: ID("tie", n++),
                // oldest -> newest: A, B, A, B (recency-balanced).
                prelude: [
                    turnFrom([tieA[0]]),
                    turnFrom([tieB[0]]),
                    turnFrom([tieA[1]]),
                    turnFrom([tieB[1]]),
                ],
                collisionInput,
                candidates: order(aId, n % 2 === 0),
                label: { kind: "abstain", reason: "tie" },
            });
        }

        // NO-SIGNAL — prelude drawn from an unrelated third agent; neither
        // candidate matches.
        if (third) {
            fixtures.push({
                id: ID("nosignal", n++),
                prelude: onTopicPrelude([...third.keywords], preludeLen),
                collisionInput,
                candidates: order(aId, n % 2 === 0),
                label: { kind: "abstain", reason: "no-signal" },
            });

            // STALE — one on-topic A turn, then heavy unrelated padding so its
            // decayed weight falls under minMass. (No retrieval oracle: here the
            // topic is SUPPOSED to have decayed away, so it must not count
            // against topical concentration — the decay itself is pinned by the
            // property checks and the min-mass abstain in Metric 2.)
            fixtures.push({
                id: ID("stale", n++),
                prelude: [
                    turnFrom(sample(rng, discA, tpt)),
                    ...onTopicPrelude([...third.keywords], stalePadding),
                ],
                collisionInput,
                candidates: order(aId, n % 2 === 0),
                label: { kind: "abstain", reason: "stale" },
            });
        }

        // COVERAGE — A vs a keyword-less ghost agent (uncovered candidate).
        fixtures.push({
            id: ID("coverage", n++),
            prelude: onTopicPrelude(discA, preludeLen),
            collisionInput,
            candidates:
                n % 2 === 0
                    ? [aId, `ghost.${a.actionName}`]
                    : [`ghost.${a.actionName}`, aId],
            label: { kind: "abstain", reason: "coverage" },
        });
    }

    return fixtures;
}
