// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import { matchGrammar } from "../src/grammarMatcher.js";
import {
    matchGrammarCompletion,
    type GrammarCompletionResult,
} from "../src/grammarCompletion.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";
import { tokenizeRequest } from "../src/nfaMatcher.js";
import { compileNFAToDFA } from "../src/dfaCompiler.js";
import { matchDFAWithSplitting, getDFACompletions } from "../src/dfaMatcher.js";
import { computeNFACompletions } from "../src/nfaCompletion.js";
import { Grammar } from "../src/grammarTypes.js";

export const spaces =
    " \t\v\f\u00a0\ufeff\n\r\u2028\u2029\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000";
export const escapedSpaces =
    "\\ \\t\\v\\f\\u00a0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A\\u202F\\u205F\\u3000";

export type MatcherVariant = "grammar" | "nfa" | "dfa";

export type TestMatchGrammarFn = (
    grammar: Grammar,
    request: string,
) => unknown[];

export function testMatchGrammar(grammar: Grammar, request: string) {
    return matchGrammar(grammar, request)?.map((m) => m.match);
}

function testMatchGrammarNFA(grammar: Grammar, request: string): unknown[] {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const results = matchGrammarWithNFA(grammar, nfa, request);
    return results.map((m) => m.match);
}

function testMatchGrammarDFA(grammar: Grammar, request: string): unknown[] {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const dfa = compileNFAToDFA(nfa, "test.grammar");
    const tokens = tokenizeRequest(request);
    const result = matchDFAWithSplitting(dfa, tokens);
    if (!result.matched) {
        return [];
    }
    return [result.actionValue ?? request];
}

export function createTestMatchGrammar(
    variant: MatcherVariant,
): TestMatchGrammarFn {
    switch (variant) {
        case "grammar":
            return testMatchGrammar;
        case "nfa":
            return testMatchGrammarNFA;
        case "dfa":
            return testMatchGrammarDFA;
    }
}

const matcherVariants: MatcherVariant[] = ["grammar"];
// TODO: Enable "nfa" and "dfa" variants once they match grammarMatcher behavior.
// const matcherVariants: MatcherVariant[] = ["grammar", "nfa", "dfa"];

/**
 * Run a test suite with all three matcher variants (grammar, nfa, dfa).
 * The callback receives the variant name and a testMatchGrammar function
 * appropriate for that variant.
 */
export function describeForEachMatcher(
    name: string,
    fn: (testMatchGrammar: TestMatchGrammarFn, variant: MatcherVariant) => void,
): void {
    describe.each(matcherVariants)(`${name} [%s]`, (variant) => {
        fn(createTestMatchGrammar(variant), variant);
    });
}

/**
 * Assert match results, accounting for multi-result differences between
 * matchers. The grammar matcher can return multiple matches; NFA/DFA return
 * only the best match.
 *
 * For single-element expected arrays all variants are checked with toStrictEqual.
 * For multi-element expected arrays:
 *   - grammar variant: exact match with toStrictEqual
 *   - nfa/dfa variants: checks that exactly one result is returned and that
 *     it deep-equals one of the expected values.
 */
export function expectMatchResults(
    actual: unknown[],
    expected: unknown[],
    variant: MatcherVariant,
): void {
    if (variant === "grammar" || expected.length <= 1) {
        expect(actual).toStrictEqual(expected);
    } else {
        // NFA/DFA return the best match only
        expect(actual.length).toBe(1);
        expect(expected).toContainEqual(actual[0]);
    }
}

// ---------------------------------------------------------------------------
// Completion variant infrastructure
// ---------------------------------------------------------------------------

export type CompletionVariant = "grammar" | "nfa" | "dfa";

export type TestCompletionFn = (
    grammar: Grammar,
    prefix: string,
    minPrefixLength?: number,
    direction?: "forward" | "backward",
) => GrammarCompletionResult;

function testCompletionNFA(
    grammar: Grammar,
    prefix: string,
): GrammarCompletionResult {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const tokens = tokenizeRequest(prefix);
    return computeNFACompletions(nfa, tokens);
}

function testCompletionDFA(
    grammar: Grammar,
    prefix: string,
): GrammarCompletionResult {
    const nfa = compileGrammarToNFA(grammar, "test.grammar");
    const dfa = compileNFAToDFA(nfa, "test.grammar");
    const tokens = tokenizeRequest(prefix);
    const result = getDFACompletions(dfa, tokens);
    return {
        completions: result.completions ?? [],
        properties: result.properties?.map((p) => ({
            match: { actionName: p.actionName },
            propertyNames: [p.propertyPath],
        })),
        directionSensitive: false,
        openWildcard: false,
    };
}

export function createTestCompletion(
    variant: CompletionVariant,
): TestCompletionFn {
    switch (variant) {
        case "grammar":
            return withInvariantChecks(matchGrammarCompletion);
        case "nfa":
            return testCompletionNFA;
        case "dfa":
            return testCompletionDFA;
    }
}

const completionVariants: CompletionVariant[] = ["grammar"];
// TODO: Enable "nfa" and "dfa" variants once they match grammarCompletion behavior.
// const completionVariants: CompletionVariant[] = ["grammar", "nfa", "dfa"];

/**
 * Run a completion test suite with all enabled completion variants.
 * The callback receives the variant name and a completion function
 * appropriate for that variant.
 */
export function describeForEachCompletion(
    name: string,
    fn: (testCompletion: TestCompletionFn, variant: CompletionVariant) => void,
): void {
    describe.each(completionVariants)(`${name} [%s]`, (variant) => {
        fn(createTestCompletion(variant), variant);
    });
}

// ---------------------------------------------------------------------------
// Completion invariant checking (dual-direction wrapper)
// ---------------------------------------------------------------------------

/**
 * Check whether two completion results are deeply equal without throwing.
 * Uses Node's built-in deep equality so this works outside a Jest context.
 */
function completionResultsEqual(
    a: GrammarCompletionResult,
    b: GrammarCompletionResult,
): boolean {
    return isDeepStrictEqual(a, b);
}

/**
 * Assert invariants that must hold for any single completion result.
 *
 * Invariants checked:
 * 1. matchedPrefixLength ∈ [minPrefixLength ?? 0, prefix.length]
 * 2. closedSet=false ↔ properties is non-empty
 */
function assertSingleResultInvariants(
    result: GrammarCompletionResult,
    prefix: string,
    direction: string,
    minPrefixLength?: number,
): void {
    const mpl = result.matchedPrefixLength ?? 0;
    const ctx = `[${direction} prefix="${prefix}"]`;

    // 1. matchedPrefixLength bounds
    if (mpl < (minPrefixLength ?? 0)) {
        throw new Error(
            `Invariant: matchedPrefixLength (${mpl}) < minPrefixLength (${minPrefixLength ?? 0}) ${ctx}`,
        );
    }
    if (mpl > prefix.length) {
        throw new Error(
            `Invariant: matchedPrefixLength (${mpl}) > prefix.length (${prefix.length}) ${ctx}`,
        );
    }

    // 2. closedSet ↔ properties consistency
    const hasProperties = (result.properties?.length ?? 0) > 0;
    if (hasProperties && result.closedSet !== false) {
        throw new Error(
            `Invariant: properties present but closedSet=${result.closedSet} (should be false) ${ctx}`,
        );
    }
    if (result.closedSet === false && !hasProperties) {
        throw new Error(
            `Invariant: closedSet=false but properties is empty ${ctx}`,
        );
    }
}

/**
 * Assert cross-direction invariants between forward and backward results.
 *
 * On the original input we can only assert one thing:
 *
 * - #1: forward.matchedPrefixLength === backward.matchedPrefixLength →
 *       forward deep-equals backward (equal consumption → identical)
 *
 * The remaining invariants are cross-query checks on *truncated* input:
 *
 * - #2: !forward.directionSensitive →
 *       forward === completion(input[0..fwd.mpl], "backward")
 * - #3: !backward.directionSensitive →
 *       backward === completion(input[0..bwd.mpl], "forward")
 * - #4: forward.directionSensitive →
 *       completion(input[0..fwd.mpl], "backward").mpl < fwd.mpl
 *       (backward of truncated backs up)
 * - #5: fwd.mpl ≠ bwd.mpl AND backward.directionSensitive →
 *       completion(input[0..bwd.mpl], "forward").mpl ≥ bwd.mpl
 *       (forward reaches backward's position on truncated input)
 */
function assertCrossDirectionInvariants(
    forward: GrammarCompletionResult,
    backward: GrammarCompletionResult,
    prefix: string,
    minPrefixLength: number | undefined,
    grammar: Grammar,
    baseFn: TestCompletionFn,
): void {
    const fwdMpl = forward.matchedPrefixLength ?? 0;
    const bwdMpl = backward.matchedPrefixLength ?? 0;

    // #1: equal matchedPrefixLength → identical results
    //     If both directions consumed the same amount, all fields must agree.
    if (fwdMpl === bwdMpl && !completionResultsEqual(forward, backward)) {
        try {
            expect(backward).toEqual(forward);
        } catch (e) {
            const err = e as Error;
            err.message =
                `Invariant #1: forward.matchedPrefixLength === backward.matchedPrefixLength ` +
                `(${fwdMpl}) but results differ (prefix="${prefix}")\n\n${err.message}`;
            throw err;
        }
    }

    // #2: !forward.directionSensitive →
    //     forward === completion(input[0..fwd.mpl], "backward")
    //     When forward says direction doesn't matter at its position,
    //     backward on the truncated input should produce the same result.
    if (!forward.directionSensitive) {
        const truncated = prefix.substring(0, fwdMpl);
        const backwardAtFwd = baseFn(
            grammar,
            truncated,
            minPrefixLength,
            "backward",
        );
        if (!completionResultsEqual(forward, backwardAtFwd)) {
            try {
                expect(backwardAtFwd).toEqual(forward);
            } catch (e) {
                const err = e as Error;
                err.message =
                    `Invariant #2: forward.directionSensitive=false but ` +
                    `forward ≠ completion(input[0..${fwdMpl}]="${truncated}", "backward") ` +
                    `(prefix="${prefix}")\n\n${err.message}`;
                throw err;
            }
        }
    }

    // #3: !backward.directionSensitive →
    //     backward === completion(input[0..bwd.mpl], "forward")
    //     When backward says direction doesn't matter at its position,
    //     forward on the truncated input should produce the same result.
    if (!backward.directionSensitive) {
        const truncated = prefix.substring(0, bwdMpl);
        const forwardAtBwd = baseFn(
            grammar,
            truncated,
            minPrefixLength,
            "forward",
        );
        // Guard: only check when forward can reach backward's position.
        // When forwardAtBwd.mpl < bwdMpl, the forward path has a known
        // gap and can't reproduce backward's position.
        if ((forwardAtBwd.matchedPrefixLength ?? 0) >= bwdMpl || bwdMpl === 0) {
            if (!completionResultsEqual(backward, forwardAtBwd)) {
                try {
                    expect(forwardAtBwd).toEqual(backward);
                } catch (e) {
                    const err = e as Error;
                    err.message =
                        `Invariant #3: backward.directionSensitive=false but ` +
                        `backward ≠ completion(input[0..${bwdMpl}]="${truncated}", "forward") ` +
                        `(prefix="${prefix}")\n\n${err.message}`;
                    throw err;
                }
            }
        }
    }

    // #4: forward.directionSensitive →
    //     completion(input[0..fwd.mpl], "backward").mpl < fwd.mpl
    //     When forward says direction matters, backward on the truncated
    //     input should back up to a shorter position.
    if (forward.directionSensitive) {
        const truncated = prefix.substring(0, fwdMpl);
        const backwardAtFwd = baseFn(
            grammar,
            truncated,
            minPrefixLength,
            "backward",
        );
        const backwardAtFwdMpl = backwardAtFwd.matchedPrefixLength ?? 0;
        if (backwardAtFwdMpl >= fwdMpl) {
            throw new Error(
                `Invariant #4: forward.directionSensitive=true but ` +
                    `completion(input[0..${fwdMpl}]="${truncated}", "backward").matchedPrefixLength ` +
                    `(${backwardAtFwdMpl}) ≥ forward.matchedPrefixLength (${fwdMpl}) ` +
                    `(prefix="${prefix}") — backward should back up`,
            );
        }
    }

    // #5: fwdMpl ≠ bwdMpl AND backward.directionSensitive →
    //     completion(input[0..bwd.mpl], "forward").mpl ≥ bwd.mpl
    //     When backward backs up to a different position and says direction
    //     matters there, forward on the truncated input should consume at
    //     least to backward's position (confirming it's reachable).
    if (fwdMpl !== bwdMpl && backward.directionSensitive) {
        const truncated = prefix.substring(0, bwdMpl);
        const forwardAtBwd = baseFn(
            grammar,
            truncated,
            minPrefixLength,
            "forward",
        );
        const forwardAtBwdMpl = forwardAtBwd.matchedPrefixLength ?? 0;
        // Guard: skip when forward can't reach backward's position
        // at all (mpl=0).  This is a known gap — e.g. number-variable
        // at EOI where forward doesn't call updateMaxPrefixLength.
        // See completion.md § Known gaps.
        if (forwardAtBwdMpl < bwdMpl && forwardAtBwdMpl > 0) {
            throw new Error(
                `Invariant #5: backward.directionSensitive=true but ` +
                    `completion(input[0..${bwdMpl}]="${truncated}", "forward").matchedPrefixLength ` +
                    `(${forwardAtBwdMpl}) < backward.matchedPrefixLength (${bwdMpl}) ` +
                    `(prefix="${prefix}") — forward should reach backward's position`,
            );
        }
    }
}

/**
 * Wrap a completion function with automatic invariant checking.
 *
 * Every call runs both forward and backward internally, asserts
 * single-result and cross-direction invariants, then returns the
 * result for the requested direction.
 */
function withInvariantChecks(baseFn: TestCompletionFn): TestCompletionFn {
    return (
        grammar: Grammar,
        prefix: string,
        minPrefixLength?: number,
        direction?: "forward" | "backward",
    ): GrammarCompletionResult => {
        const requestedDirection = direction ?? "forward";
        const forward = baseFn(grammar, prefix, minPrefixLength, "forward");
        const backward = baseFn(grammar, prefix, minPrefixLength, "backward");

        assertSingleResultInvariants(
            forward,
            prefix,
            "forward",
            minPrefixLength,
        );
        assertSingleResultInvariants(
            backward,
            prefix,
            "backward",
            minPrefixLength,
        );

        assertCrossDirectionInvariants(
            forward,
            backward,
            prefix,
            minPrefixLength,
            grammar,
            baseFn,
        );

        return requestedDirection === "backward" ? backward : forward;
    };
}

/**
 * Assert completion metadata fields in a canonical order.
 * Only the fields present in `expected` are checked.
 */
export function expectMetadata(
    result: GrammarCompletionResult,
    expected: {
        completions?: string[];
        matchedPrefixLength?: number;
        separatorMode?:
            | "space"
            | "spacePunctuation"
            | "optional"
            | "none"
            | undefined;
        closedSet?: boolean;
        directionSensitive?: boolean;
        openWildcard?: boolean;
        properties?: unknown[];
        sortCompletions?: boolean;
    },
): void {
    if ("completions" in expected) {
        const actual = expected.sortCompletions
            ? [...result.completions].sort()
            : result.completions;
        expect(actual).toEqual(expected.completions);
    }
    if ("matchedPrefixLength" in expected) {
        expect(result.matchedPrefixLength).toBe(expected.matchedPrefixLength);
    }
    if ("separatorMode" in expected) {
        if (expected.separatorMode === undefined) {
            expect(result.separatorMode).toBeUndefined();
        } else {
            expect(result.separatorMode).toBe(expected.separatorMode);
        }
    }
    if ("closedSet" in expected) {
        expect(result.closedSet).toBe(expected.closedSet);
    }
    if ("directionSensitive" in expected) {
        expect(result.directionSensitive).toBe(expected.directionSensitive);
    }
    if ("openWildcard" in expected) {
        expect(result.openWildcard).toBe(expected.openWildcard);
    }
    if ("properties" in expected) {
        expect(result.properties).toEqual(expected.properties);
    }
}
