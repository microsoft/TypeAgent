// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Property-based equivalence fuzzer for the grammar optimizer.
 *
 * Generates random structurally-valid grammars + matching/non-matching
 * inputs and asserts that `matchGrammar` returns the same multi-set of
 * matches whether or not the optimizer is enabled.
 *
 * Targets the kind of α-rename / scope / value-substitution bugs that
 * fixture-based tests are most likely to miss.  Seed is fixed so
 * failures are reproducible; bump `SEED` to widen exploration.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { recommendedOptimizations } from "../src/grammarOptimizer.js";

const SEED = 0xc0ffee;
const GRAMMAR_COUNT = 40;
const INPUTS_PER_GRAMMAR = 6;
const WORDS = ["a", "b", "c", "d", "e"];
const MAX_RULES = 4;
const MAX_ALTS = 4;
const MAX_PARTS = 4;

// Mulberry32 — small, deterministic PRNG.
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(rng: () => number, xs: T[]): T {
    return xs[Math.floor(rng() * xs.length)];
}

function intInRange(rng: () => number, lo: number, hi: number): number {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Build a random grammar.  Rules form a DAG (rule `i` may reference
 * rules `> i`), so there are no cycles and every rule terminates in
 * literal words.  No value expressions — keeps the fuzzer focused on
 * structural rewrites; value-handling has dedicated coverage in
 * grammarOptimizerValueExpressions.spec.ts.
 */
function buildRandomGrammar(rng: () => number): {
    text: string;
    matchingInputs: string[];
} {
    const ruleCount = intInRange(rng, 1, MAX_RULES);
    const ruleName = (i: number) => `R${i}`;
    const lines: string[] = [];
    // Pre-generate one matching input per rule by picking the first
    // alternative's expansion for each.  We'll join from <Start>.
    const firstAltText: string[] = new Array(ruleCount);
    const firstAltMatch: string[][] = new Array(ruleCount);

    // Generate rules in reverse so that when rule i is built, rules
    // > i already exist (allowing forward-only references and a
    // pre-computed `firstAltMatch` for any reference site).
    for (let i = ruleCount - 1; i >= 0; i--) {
        const altCount = intInRange(rng, 1, MAX_ALTS);
        const altTexts: string[] = [];
        let firstMatch: string[] | undefined;
        for (let a = 0; a < altCount; a++) {
            const partCount = intInRange(rng, 1, MAX_PARTS);
            const partTexts: string[] = [];
            const partMatch: string[] = [];
            for (let p = 0; p < partCount; p++) {
                // Always allow literals; allow rule refs only when
                // there's a forward rule available.
                const canRef = i + 1 < ruleCount;
                const useRef = canRef && rng() < 0.35;
                if (useRef) {
                    const target = intInRange(rng, i + 1, ruleCount - 1);
                    partTexts.push(`<${ruleName(target)}>`);
                    partMatch.push(...firstAltMatch[target]);
                } else {
                    const w = pick(rng, WORDS);
                    partTexts.push(w);
                    partMatch.push(w);
                }
            }
            altTexts.push(partTexts.join(" "));
            if (a === 0) firstMatch = partMatch;
        }
        firstAltText[i] = altTexts.join(" | ");
        firstAltMatch[i] = firstMatch!;
        lines.push(`<${ruleName(i)}> = ${altTexts.join(" | ")};`);
    }
    // Reverse so <R0> is defined first (cosmetic).
    lines.reverse();
    // Anchor the start symbol to <R0>.
    const text = `<Start> = <R0>;\n${lines.join("\n")}`;

    // Matching input: the first-alternative expansion of <R0>.
    const matching = firstAltMatch[0].join(" ");
    // A definitely-non-matching input (uses a token outside WORDS).
    const nonMatching = "zzz";
    // A truncated input.
    const truncated = firstAltMatch[0].slice(0, -1).join(" ") || "x";
    return {
        text,
        matchingInputs: [matching, nonMatching, truncated],
    };
}

function matchKeys(
    grammar: ReturnType<typeof loadGrammarRules>,
    input: string,
): string[] | { error: string } {
    try {
        return matchGrammar(grammar, input)
            .map((m) => JSON.stringify(m.match))
            .sort();
    } catch (e) {
        return { error: (e as Error).message };
    }
}

describe("Grammar Optimizer - Random equivalence fuzz", () => {
    const rng = makeRng(SEED);
    for (let g = 0; g < GRAMMAR_COUNT; g++) {
        const { text, matchingInputs } = buildRandomGrammar(rng);
        // Generate a few extra random inputs to widen coverage.
        const extraInputs: string[] = [];
        for (let i = 0; i < INPUTS_PER_GRAMMAR - matchingInputs.length; i++) {
            const len = intInRange(rng, 1, 5);
            const tokens: string[] = [];
            for (let t = 0; t < len; t++) tokens.push(pick(rng, WORDS));
            extraInputs.push(tokens.join(" "));
        }
        const inputs = [...matchingInputs, ...extraInputs];

        // Compile both flavors once; reuse across inputs.  Generated
        // grammars don't carry value expressions, so disable the
        // start-value requirement.
        let baseline: ReturnType<typeof loadGrammarRules>;
        let optimized: ReturnType<typeof loadGrammarRules>;
        const loadOpts = { startValueRequired: false } as const;
        try {
            baseline = loadGrammarRules("fuzz.grammar", text, loadOpts);
            optimized = loadGrammarRules("fuzz.grammar", text, {
                ...loadOpts,
                optimizations: recommendedOptimizations,
            });
        } catch (e) {
            it(`grammar #${g} compiles`, () => {
                throw new Error(
                    `Generated grammar failed to compile: ${(e as Error).message}\n${text}`,
                );
            });
            continue;
        }

        for (const input of inputs) {
            it(`grammar #${g} matches '${input}' identically`, () => {
                const baseResult = matchKeys(baseline, input);
                const optResult = matchKeys(optimized, input);
                // If both throw, consider that consistent (the
                // baseline grammar itself is the bug, not the
                // optimizer).  If only one throws, fail loudly.
                if (
                    typeof baseResult === "object" &&
                    !Array.isArray(baseResult) &&
                    "error" in baseResult
                ) {
                    expect(optResult).toMatchObject({
                        error: expect.any(String),
                    });
                    return;
                }
                expect(optResult).toStrictEqual(baseResult);
            });
        }
    }
});
