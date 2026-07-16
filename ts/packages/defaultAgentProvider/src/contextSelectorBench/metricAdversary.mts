// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Adversarial "vampire family" — a set of CONFUSABLE synthetic test agents that
// deliberately share most of their keyword vocabulary, so the collisions they
// manufacture are HARD (the real-roster pairs are near-disjoint and therefore
// trivially separable, saturating the headline metrics). Each sibling's vector
// is `SHARED occult vocabulary` (in every sibling, so candidate-local IDF cancels
// it to zero — design §9) plus a small `UNIQUE` set that alone can discriminate.
//
// Because most of the vocabulary cancels, the decision hinges on the few unique
// tokens, and a realistic prelude spoken mostly in the SHARED occult register
// carries thin discriminating mass. That turns the benchmark's yield into a real
// measurement of where the evidence gate sits relative to the signal gradient,
// instead of a saturated 100%. This is the design's B-5.1 "sidecar-keyworded
// vampire stunt double", scaled to a whole confusable family.

import {
    KeywordFile,
    KEYWORD_FILE_SCHEMA_VERSION,
} from "agent-dispatcher/contextSelector";
import { tokenize } from "agent-dispatcher/contextSelector";
import { Roster, buildRoster } from "./metricRoster.mjs";
import {
    Fixture,
    RetrievalOracle,
    makePrng,
    sample,
    turnFrom,
} from "./metricCorpus.mjs";

// Generic occult register shared by EVERY sibling — the ambiguous vocabulary two
// occult agents both answer to ("blood and night and ritual"). Shared => df=2+
// => disc=0 => contributes nothing to either candidate's score.
const SHARED = [
    "blood",
    "night",
    "moon",
    "curse",
    "dark",
    "ancient",
    "spirit",
    "ritual",
    "shadow",
    "soul",
    "mist",
    "omen",
];

// Each sibling's DISCRIMINATING vocabulary — disjoint across the family and from
// SHARED, so it is the only thing that can point the scorer at one sibling.
const UNIQUE: Record<string, string[]> = {
    vampire: [
        "coffin",
        "fang",
        "dracula",
        "bat",
        "undead",
        "crypt",
        "thirst",
        "bite",
    ],
    werewolf: [
        "wolf",
        "pack",
        "fur",
        "claw",
        "lunar",
        "beast",
        "snarl",
        "prowl",
    ],
    necromancer: [
        "bone",
        "corpse",
        "skull",
        "grave",
        "reanimate",
        "tomb",
        "decay",
        "lich",
    ],
    wraith: [
        "haunt",
        "specter",
        "ectoplasm",
        "wail",
        "poltergeist",
        "chill",
        "apparition",
        "veil",
    ],
    witch: [
        "cauldron",
        "potion",
        "broom",
        "hex",
        "wart",
        "familiar",
        "brew",
        "coven",
    ],
    demon: [
        "brimstone",
        "pentagram",
        "infernal",
        "horn",
        "abyss",
        "torment",
        "sulfur",
        "possess",
    ],
    zombie: [
        "rot",
        "flesh",
        "horde",
        "groan",
        "shamble",
        "undying",
        "contagion",
        "brain",
    ],
    ghoul: [
        "carrion",
        "catacomb",
        "gaunt",
        "lurk",
        "scavenge",
        "mausoleum",
        "dread",
        "wither",
    ],
};

// The action every sibling collides on (mirrors the real list↔vampire pattern:
// same action name across agents, so grammarMatch would produce the collision).
const ACTION = "summon";

// Canonicalize through the SAME tokenizer the scorer uses, so a sibling's stored
// tokens are exactly the forms a conversation word tokenizes to.
function canon(words: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of words) {
        for (const t of tokenize(w)) {
            if (!seen.has(t)) {
                seen.add(t);
                out.push(t);
            }
        }
    }
    return out;
}

export type Sibling = {
    schema: string;
    shared: string[]; // canonical shared tokens
    unique: string[]; // canonical unique tokens
};

export type Adversary = {
    roster: Roster;
    siblings: Sibling[];
};

// Build the confusable family as in-memory keyword files behind the REAL
// KeywordIndex read path, so scoring is identical to production.
export function buildAdversary(): Adversary {
    const sharedCanon = canon(SHARED);
    const files = new Map<string, KeywordFile>();
    const siblings: Sibling[] = [];
    for (const [schema, uniqueWords] of Object.entries(UNIQUE).sort()) {
        const unique = canon(uniqueWords);
        const vector = [...sharedCanon, ...unique];
        files.set(schema, {
            schemaVersion: KEYWORD_FILE_SCHEMA_VERSION,
            schema,
            generatedBy: "lexical",
            generatedAt: "",
            actions: { [ACTION]: vector },
        });
        siblings.push({ schema, shared: sharedCanon, unique });
    }
    return { roster: buildRoster(files, 8), siblings };
}

// All unordered sibling pairs (each is a genuinely confusable ~60%-shared
// collision).
function siblingPairs(siblings: Sibling[]): [Sibling, Sibling][] {
    const pairs: [Sibling, Sibling][] = [];
    for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
            pairs.push([siblings[i], siblings[j]]);
        }
    }
    return pairs;
}

// Signal-strength grid for the resolve fixtures: `u` distinct unique-topic
// tokens (evidence count) aged by `p` trailing shared turns (recency). The
// scorer's evidence gate — not the fixture author — decides which of these clear
// the bar, so yield measures the gate against a real signal gradient.
const UNIQUE_COUNTS = [1, 2, 3];
const SHARED_PADDING = [0, 3, 6, 9];

export type AdversaryOptions = { seed?: number };

export function generateAdversaryFixtures(
    adversary: Adversary,
    opts: AdversaryOptions = {},
): Fixture[] {
    const rng = makePrng(opts.seed ?? 990099);
    const fixtures: Fixture[] = [];
    let n = 0;
    const id = (tag: string) => `${tag}-${n++}`;

    // A prelude of `u` unique-topic turns (oldest) followed by `p` shared turns
    // (newest) — the shared tail cancels in scoring but ages the unique evidence.
    const gradedPrelude = (
        unique: string[],
        u: number,
        p: number,
    ): string[] => {
        const chosen = sample(rng, unique, u);
        const turns = chosen.map((t) => turnFrom([t]));
        for (let i = 0; i < p; i++) {
            turns.push(turnFrom(sample(rng, adversary.siblings[0].shared, 2)));
        }
        return turns;
    };

    for (const [a, b] of siblingPairs(adversary.siblings)) {
        const aId = `${a.schema}.${ACTION}`;
        const bId = `${b.schema}.${ACTION}`;
        const order = (target: string, targetFirst: boolean): string[] =>
            targetFirst
                ? [target, target === aId ? bId : aId]
                : [target === aId ? bId : aId, target];
        const oracle = (topic: Sibling, other: Sibling): RetrievalOracle => ({
            topic: topic.schema,
            topicTokens: topic.unique,
            distractorTokens: other.unique,
            unrelatedTokens: [],
        });

        // RESOLVE grid for each topic — label is the intended topic; the gate
        // decides recall.
        for (const [topic, other] of [
            [a, b],
            [b, a],
        ] as const) {
            const tid = `${topic.schema}.${ACTION}`;
            for (const u of UNIQUE_COUNTS) {
                for (const p of SHARED_PADDING) {
                    fixtures.push({
                        id: id(`hard-resolve-${topic.schema}-u${u}-p${p}`),
                        prelude: gradedPrelude(topic.unique, u, p),
                        collisionInput: `perform the ${ACTION}`,
                        candidates: order(tid, n % 2 === 0),
                        label: { kind: "resolve", target: tid },
                    });
                }
            }

            // TRAP — topic is the dominant subject (2 unique, older) but the
            // sibling gets one salient recent mention. Correct answer is still
            // the topic; tests the scorer is not flipped by a recent distractor
            // (a wrong-target here would be a genuine safety failure).
            const tu = sample(rng, topic.unique, 2);
            const ou = sample(rng, other.unique, 1);
            fixtures.push({
                id: id(`hard-trap-${topic.schema}`),
                prelude: [
                    turnFrom([tu[0]]),
                    turnFrom([tu[1]]),
                    turnFrom([ou[0]]),
                    turnFrom(sample(rng, a.shared, 2)),
                ],
                collisionInput: `perform the ${ACTION}`,
                candidates: order(tid, n % 2 === 0),
                label: { kind: "resolve", target: tid },
                retrieval: oracle(topic, other),
            });
        }

        // TIE (shared-only) — the whole conversation is in the ambiguous occult
        // register; nothing discriminates. The signature confusable case: must
        // abstain, never guess a sibling.
        fixtures.push({
            id: id("hard-tie-shared"),
            prelude: [
                turnFrom(sample(rng, a.shared, 2)),
                turnFrom(sample(rng, a.shared, 2)),
                turnFrom(sample(rng, a.shared, 2)),
                turnFrom(sample(rng, a.shared, 2)),
            ],
            collisionInput: `perform the ${ACTION}`,
            candidates: order(aId, n % 2 === 0),
            label: { kind: "abstain", reason: "no-signal" },
        });

        // TIE (balanced unique) — both siblings equally on-topic; margin stays
        // under threshold.
        const ta = sample(rng, a.unique, 2);
        const tb = sample(rng, b.unique, 2);
        fixtures.push({
            id: id("hard-tie-balanced"),
            prelude: [
                turnFrom([ta[0]]),
                turnFrom([tb[0]]),
                turnFrom([ta[1]]),
                turnFrom([tb[1]]),
            ],
            collisionInput: `perform the ${ACTION}`,
            candidates: order(aId, n % 2 === 0),
            label: { kind: "abstain", reason: "tie" },
        });

        // COVERAGE — sibling vs a keyword-less ghost.
        fixtures.push({
            id: id("hard-coverage"),
            prelude: [
                turnFrom(sample(rng, a.unique, 2)),
                turnFrom(sample(rng, a.unique, 2)),
            ],
            collisionInput: `perform the ${ACTION}`,
            candidates:
                n % 2 === 0
                    ? [aId, `ghost.${ACTION}`]
                    : [`ghost.${ACTION}`, aId],
            label: { kind: "abstain", reason: "coverage" },
        });
    }

    return fixtures;
}
