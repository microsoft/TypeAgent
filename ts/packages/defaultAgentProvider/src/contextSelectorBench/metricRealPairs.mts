// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Real-agent comparison slice: instead of the synthetic vampire family, this
// pits actual committed agents against each other on genuinely confusable pairs
// (music player vs local player, powershell vs taskflow, code-debug vs Visual
// Studio, timer vs windows-clock, …). Each pair is driven with an EVEN MIXTURE
// of two conversation tiers so we can see how the metrics move with ambiguity:
//
//   CLEAR  — the conversation is obviously about one agent (strong, recent
//            discriminating keywords). Ground truth: resolve to that agent.
//            Exercises yield + resolution correctness.
//   VAGUE  — the conversation is ambiguous: spoken in the SHARED vocabulary the
//            two agents both answer to, or mentioning both equally, or a single
//            faint hint. Ground truth: abstain (don't guess). Exercises
//            abstention correctness + the spurious-resolve rate.
//
// Uses each agent's REAL committed keyword vector through the production index.

import { Roster, TopicalAction, discriminating } from "./metricRoster.mjs";
import {
    Fixture,
    RetrievalOracle,
    makePrng,
    sample,
    shared,
    turnFrom,
} from "./metricCorpus.mjs";

// Curated confusable pairs by schema name + a human label. Chosen for real
// keyword overlap (shared >= 6) AND enough discriminating signal on both sides
// (>= 6) so both the CLEAR and VAGUE tiers are constructible. `excel`/`word` are
// not in this repo (they live in a submodule), so powershell and the dev-tool
// agents (code, visualStudio, markdown) stand in for the "office apps" idea.
const PAIR_SPECS: { a: string; b: string; label: string }[] = [
    { a: "player", b: "localPlayer", label: "player vs playerLocal (music)" },
    {
        a: "powershell",
        b: "taskflow",
        label: "powershell vs taskflow (automation flows)",
    },
    {
        a: "browser.webFlows",
        b: "powershell",
        label: "browser web-flows vs powershell (flows)",
    },
    {
        a: "code.code-debug",
        b: "visualStudio",
        label: "code-debug vs visualStudio (debugging)",
    },
    { a: "timer", b: "windowsClock", label: "timer vs windowsClock (time)" },
    { a: "calendar", b: "timer", label: "calendar vs timer (scheduling)" },
    {
        a: "desktop.desktop-taskbar",
        b: "settings",
        label: "desktop-taskbar vs settings (system config)",
    },
    { a: "chat", b: "photo", label: "chat vs photo (images)" },
    { a: "image", b: "photo", label: "image vs photo (pictures)" },
    {
        a: "browser.external",
        b: "utility",
        label: "browser vs utility (web fetch)",
    },
    {
        a: "code.code-extension",
        b: "github-cli",
        label: "code-extensions vs github-cli (dev tooling)",
    },
];

export type RealPair = {
    label: string;
    aId: string;
    bId: string;
    discA: string[];
    discB: string[];
    shared: string[];
};

// Resolve each spec to its richest committed action per schema and keep only the
// pairs with enough shared + discriminating signal to build both tiers.
export function realPairs(
    roster: Roster,
    opts: { minShared?: number; minDiscriminating?: number } = {},
): RealPair[] {
    const minShared = opts.minShared ?? 6;
    const minDisc = opts.minDiscriminating ?? 6;
    const best = new Map<string, TopicalAction>();
    for (const a of roster.actions) {
        const cur = best.get(a.schemaName);
        if (cur === undefined || a.keywords.size > cur.keywords.size) {
            best.set(a.schemaName, a);
        }
    }
    const out: RealPair[] = [];
    for (const spec of PAIR_SPECS) {
        const a = best.get(spec.a);
        const b = best.get(spec.b);
        if (a === undefined || b === undefined) {
            continue;
        }
        const discA = discriminating(a.keywords, b.keywords);
        const discB = discriminating(b.keywords, a.keywords);
        const sh = shared(a, b);
        if (
            sh.length < minShared ||
            discA.length < minDisc ||
            discB.length < minDisc
        ) {
            continue;
        }
        out.push({
            label: spec.label,
            aId: `${a.schemaName}.${a.actionName}`,
            bId: `${b.schemaName}.${b.actionName}`,
            discA,
            discB,
            shared: sh,
        });
    }
    return out;
}

export type RealCorpusOptions = {
    seed?: number;
    // Independent seeded samples of each tier per pair (keeps clear:vague even).
    repeats?: number;
    // On-topic turns in a CLEAR prelude.
    clearLen?: number;
};

// Build the even clear/vague corpus. Each fixture is tagged `tier` so the runner
// can report the two regimes separately.
export function generateRealFixtures(
    pairs: RealPair[],
    opts: RealCorpusOptions = {},
): Fixture[] {
    const rng = makePrng(opts.seed ?? 424242);
    const repeats = opts.repeats ?? 3;
    const clearLen = opts.clearLen ?? 4;
    const fixtures: Fixture[] = [];
    let n = 0;
    const id = (tag: string) => `${tag}-${n++}`;

    const onTopic = (tokens: string[], turns: number): string[] => {
        const out: string[] = [];
        for (let i = 0; i < turns; i++) {
            out.push(turnFrom(sample(rng, tokens, 3)));
        }
        return out;
    };

    // A REALISTIC clear conversation: mostly the shared domain vocabulary with a
    // few discriminating "tells" (e.g. "play the album" is shared, "on spotify"
    // is the tell). `tells` distinct discriminating tokens sit in the newest
    // turns; the rest is shared filler. Fewer tells => thinner evidence, so the
    // gate — not the author — decides whether an obviously-on-topic-but-lexically-
    // subtle conversation clears the bar.
    const clearPrelude = (
        disc: string[],
        sharedVocab: string[],
        tells: number,
        turns: number,
    ): string[] => {
        const tokens = sample(rng, disc, tells);
        const out: string[] = [];
        for (let i = 0; i < turns - tells; i++) {
            out.push(turnFrom(sample(rng, sharedVocab, 2)));
        }
        for (const t of tokens) {
            out.push(turnFrom([t, ...sample(rng, sharedVocab, 1)]));
        }
        return out;
    };

    for (const pair of pairs) {
        const order = (target: string, targetFirst: boolean): string[] =>
            targetFirst
                ? [target, target === pair.aId ? pair.bId : pair.aId]
                : [target === pair.aId ? pair.bId : pair.aId, target];
        const oracle = (topicIsA: boolean): RetrievalOracle => ({
            topic: topicIsA ? pair.aId : pair.bId,
            topicTokens: topicIsA ? pair.discA : pair.discB,
            distractorTokens: topicIsA ? pair.discB : pair.discA,
            unrelatedTokens: [],
        });

        for (let r = 0; r < repeats; r++) {
            // ---- CLEAR: obviously one agent, but with a realistic tells
            // gradient (3 strong / 2 clear / 1 subtle). Topic alternates by
            // repeat so both agents appear. ----
            const topicIsA = r % 2 === 0;
            const disc = topicIsA ? pair.discA : pair.discB;
            const tid = topicIsA ? pair.aId : pair.bId;
            for (const tells of [3, 2, 1]) {
                fixtures.push({
                    id: id(`real-clear-${topicIsA ? "a" : "b"}-t${tells}`),
                    prelude: clearPrelude(disc, pair.shared, tells, clearLen),
                    collisionInput: pair.label,
                    candidates: order(tid, n % 2 === 0),
                    label: { kind: "resolve", target: tid },
                    retrieval: oracle(topicIsA),
                    tier: "clear",
                });
            }

            // ---- VAGUE: shared-only (either agent), a second shared sample,
            // and both-agents-balanced. Ground truth: abstain. ----
            fixtures.push({
                id: id("real-vague-shared"),
                prelude: onTopic(pair.shared, clearLen),
                collisionInput: pair.label,
                candidates: order(pair.aId, n % 2 === 0),
                label: { kind: "abstain", reason: "no-signal" },
                tier: "vague",
            });
            fixtures.push({
                id: id("real-vague-shared2"),
                prelude: onTopic(pair.shared, clearLen),
                collisionInput: pair.label,
                candidates: order(pair.bId, n % 2 === 0),
                label: { kind: "abstain", reason: "no-signal" },
                tier: "vague",
            });
            // Both agents mentioned in balanced, recency-matched measure.
            const sa = sample(rng, pair.discA, 2);
            const sb = sample(rng, pair.discB, 2);
            fixtures.push({
                id: id("real-vague-balanced"),
                prelude: [
                    turnFrom([sa[0]]),
                    turnFrom([sb[0]]),
                    turnFrom([sa[1]]),
                    turnFrom([sb[1]]),
                ],
                collisionInput: pair.label,
                candidates: order(pair.aId, n % 2 === 0),
                label: { kind: "abstain", reason: "tie" },
                tier: "vague",
            });
        }
    }

    return fixtures;
}
