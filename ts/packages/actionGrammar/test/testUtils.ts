// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import { matchGrammar } from "../src/grammarMatcher.js";
import type { SeparatorMode } from "../src/grammarMatcher.js";
import {
    matchGrammarCompletion,
    type GrammarCompletionResult,
    type GrammarCompletionProperty,
} from "../src/grammarCompletion.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";
import { tokenizeRequest } from "../src/nfaMatcher.js";
import { compileNFAToDFA } from "../src/dfaCompiler.js";
import { matchDFAWithSplitting, getDFACompletions } from "../src/dfaMatcher.js";
import { computeNFACompletions } from "../src/nfaCompletion.js";
import { Grammar } from "../src/grammarTypes.js";
import type {
    DispatchModeBucket,
    GrammarRule,
    RulesPart,
} from "../src/grammarTypes.js";

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
        groups: [
            {
                completions: result.completions ?? [],
                separatorMode: "space",
            },
        ],
        properties: result.properties?.map((p) => ({
            match: { actionName: p.actionName },
            propertyNames: [p.propertyPath],
            separatorMode: "autoSpacePunctuation" as const,
        })),
        directionSensitive: false,
        afterWildcard: "none",
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
//
// Invariant index (see individual assertion functions for details):
//
//  Single-result (assertSingleResultInvariants):
//   #1  matchedPrefixLength ∈ [minPrefixLength ?? 0, prefix.length]
//   #2  closedSet=false ↔ properties is non-empty
//
//  Truncated-forward (assertTruncatedForwardInvariant):
//   #3  matchedPrefixLength < prefix.length
//       → result == completion(input[0..matchedPrefixLength], "forward")
//
//  Cross-direction (assertCrossDirectionInvariants):
//   #4  equal matchedPrefixLength → identical results
//   #5  !forward.directionSensitive → forward == backward on truncated
//   #6  !backward.directionSensitive → backward == forward on truncated
//   #7  forward.directionSensitive → backward backs up on truncated
//   #8  divergent matchedPrefixLength + backward.directionSensitive
//       → forward reaches backward's position on truncated
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
 * Sort completions within each group and sort groups by separatorMode.
 * Both completion order and group order are not significant.
 */
function normalizeGroups<
    T extends { completions: string[]; separatorMode: string },
>(groups: T[]): T[] {
    return groups
        .map((g) => ({ ...g, completions: [...g.completions].sort() }))
        .sort((a, b) => a.separatorMode.localeCompare(b.separatorMode));
}

/**
 * Return a copy of a completion result with normalized groups.
 * Completion order is not significant — normalize before comparing.
 */
function normalizeCompletionResult(r: GrammarCompletionResult) {
    return {
        ...r,
        groups: normalizeGroups(r.groups),
    };
}

/**
 * Assert invariants that must hold for any single completion result.
 *
 * Invariants checked:
 * - #1: matchedPrefixLength ∈ [minPrefixLength ?? 0, prefix.length]
 * - #2: closedSet=false ↔ properties is non-empty
 */
function assertSingleResultInvariants(
    result: GrammarCompletionResult,
    prefix: string,
    direction: "forward" | "backward",
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
    const hasCompletions = result.groups.some((g) => g.completions.length > 0);
    if (hasProperties && result.closedSet !== false) {
        throw new Error(
            `Invariant: properties present but closedSet=${result.closedSet} (should be false) ${ctx}`,
        );
    }
    // closedSet=false is valid when:
    //   (a) properties are present (wildcard slots — agent can provide values), or
    //   (b) completions are present (separator conflict filtering dropped
    //       some candidates — re-fetch with different separator state
    //       would yield more completions).
    if (result.closedSet === false && !hasProperties && !hasCompletions) {
        throw new Error(
            `Invariant: closedSet=false but both properties and completions are empty ${ctx}`,
        );
    }
}

/**
 * Assert that truncating input to a result's matchedPrefixLength and
 * re-running forward produces the same result.
 *
 * - #3: result.matchedPrefixLength < prefix.length →
 *       result === completion(input[0..matchedPrefixLength], "forward")
 *
 * Stripping unconsumed trailing input should not change the answer.
 * For forward results this is a straightforward idempotency check.
 * For backward results we guard on forward actually reaching the
 * same position (otherwise a known forward gap would cause a false
 * failure).
 */
function assertTruncatedForwardInvariant(
    result: GrammarCompletionResult,
    prefix: string,
    direction: "forward" | "backward",
    minPrefixLength: number | undefined,
    grammar: Grammar,
    baseFn: TestCompletionFn,
): void {
    const mpl = result.matchedPrefixLength ?? 0;
    if (mpl >= prefix.length) {
        return;
    }

    const truncated = prefix.substring(0, mpl);
    const forwardOnTruncated = baseFn(
        grammar,
        truncated,
        minPrefixLength,
        "forward",
    );

    // For backward results, skip when forward can't reach the same
    // position (known gap — see completion.md § Known gaps).
    if (
        direction === "backward" &&
        (forwardOnTruncated.matchedPrefixLength ?? 0) < mpl
    ) {
        return;
    }

    const sortedResult = normalizeCompletionResult(result);
    const sortedTruncated = normalizeCompletionResult(forwardOnTruncated);
    if (!completionResultsEqual(sortedResult, sortedTruncated)) {
        try {
            expect(sortedTruncated).toEqual(sortedResult);
        } catch (e) {
            const err = e as Error;
            err.message =
                `Invariant #3: ${direction} result ≠ completion(input[0..${mpl}]="${truncated}", "forward") ` +
                `when matchedPrefixLength (${mpl}) < prefix.length (${prefix.length}) ` +
                `(prefix="${prefix}")\n\n${err.message}`;
            throw err;
        }
    }
}

/**
 * Assert cross-direction invariants between forward and backward results.
 *
 * On the original input we can only assert one thing:
 *
 * - #4: forward.matchedPrefixLength === backward.matchedPrefixLength →
 *       forward deep-equals backward (equal consumption → identical)
 *
 * The remaining invariants are cross-query checks on *truncated* input:
 *
 * - #5: !forward.directionSensitive →
 *       forward === completion(input[0..forward.matchedPrefixLength], "backward")
 * - #6: !backward.directionSensitive →
 *       backward === completion(input[0..backward.matchedPrefixLength], "forward")
 * - #7: forward.directionSensitive →
 *       completion(input[0..forward.matchedPrefixLength], "backward").matchedPrefixLength
 *       < forward.matchedPrefixLength  (backward backs up on truncated)
 * - #8: forward.matchedPrefixLength ≠ backward.matchedPrefixLength
 *       AND backward.directionSensitive →
 *       completion(input[0..backward.matchedPrefixLength], "forward").matchedPrefixLength
 *       ≥ backward.matchedPrefixLength  (forward reaches backward's position)
 */
function assertCrossDirectionInvariants(
    forward: GrammarCompletionResult,
    backward: GrammarCompletionResult,
    prefix: string,
    grammar: Grammar,
    baseFn: TestCompletionFn,
): void {
    const fwdMpl = forward.matchedPrefixLength ?? 0;
    const bwdMpl = backward.matchedPrefixLength ?? 0;

    // Normalize once — completion order is not significant.
    const sortedForward = normalizeCompletionResult(forward);
    const sortedBackward = normalizeCompletionResult(backward);

    // #4: equal matchedPrefixLength → identical results
    //     If both directions consumed the same amount, all fields must agree.
    if (
        fwdMpl === bwdMpl &&
        !completionResultsEqual(sortedForward, sortedBackward)
    ) {
        try {
            expect(sortedBackward).toEqual(sortedForward);
        } catch (e) {
            const err = e as Error;
            err.message =
                `Invariant #4: forward.matchedPrefixLength === backward.matchedPrefixLength ` +
                `(${fwdMpl}) but results differ (prefix="${prefix}")\n\n${err.message}`;
            throw err;
        }
    }

    // #5: !forward.directionSensitive →
    //     forward === completion(input[0..fwd.mpl], "backward")
    //     When forward says direction doesn't matter at its position,
    //     backward on the truncated input should produce the same result.
    //     The cross-query is unconstrained (no minPrefixLength) because
    //     directionSensitive answers "would backward at input[0..P]
    //     differ from forward?" — a property of position P itself,
    //     independent of any caller-imposed floor.
    if (!forward.directionSensitive) {
        const truncated = prefix.substring(0, fwdMpl);
        const backwardAtFwd = baseFn(grammar, truncated, undefined, "backward");
        const sortedBwd5 = normalizeCompletionResult(backwardAtFwd);
        if (!completionResultsEqual(sortedForward, sortedBwd5)) {
            try {
                expect(sortedBwd5).toEqual(sortedForward);
            } catch (e) {
                const err = e as Error;
                err.message =
                    `Invariant #5: forward.directionSensitive=false but ` +
                    `forward ≠ completion(input[0..${fwdMpl}]="${truncated}", "backward") ` +
                    `(prefix="${prefix}")\n\n${err.message}`;
                throw err;
            }
        }
    }

    // #6: !backward.directionSensitive →
    //     backward === completion(input[0..bwd.mpl], "forward")
    //     When backward says direction doesn't matter at its position,
    //     forward on the truncated input should produce the same result.
    if (!backward.directionSensitive) {
        const truncated = prefix.substring(0, bwdMpl);
        const forwardAtBwd = baseFn(grammar, truncated, undefined, "forward");
        // Guard: only check when forward can reach backward's position.
        // When forwardAtBwd.mpl < bwdMpl, the forward path has a known
        // gap and can't reproduce backward's position.
        if ((forwardAtBwd.matchedPrefixLength ?? 0) >= bwdMpl || bwdMpl === 0) {
            const sortedFwd6 = normalizeCompletionResult(forwardAtBwd);
            if (!completionResultsEqual(sortedBackward, sortedFwd6)) {
                try {
                    expect(sortedFwd6).toEqual(sortedBackward);
                } catch (e) {
                    const err = e as Error;
                    err.message =
                        `Invariant #6: backward.directionSensitive=false but ` +
                        `backward ≠ completion(input[0..${bwdMpl}]="${truncated}", "forward") ` +
                        `(prefix="${prefix}")\n\n${err.message}`;
                    throw err;
                }
            }
        }
    }

    // #7: forward.directionSensitive →
    //     completion(input[0..fwd.mpl], "backward").mpl < fwd.mpl
    //     When forward says direction matters, backward on the truncated
    //     input should back up to a strictly shorter position.
    if (forward.directionSensitive) {
        const truncated = prefix.substring(0, fwdMpl);
        const backwardAtFwd = baseFn(grammar, truncated, undefined, "backward");
        const backwardAtFwdMpl = backwardAtFwd.matchedPrefixLength ?? 0;
        if (backwardAtFwdMpl >= fwdMpl) {
            throw new Error(
                `Invariant #7: forward.directionSensitive=true but ` +
                    `completion(input[0..${fwdMpl}]="${truncated}", "backward").matchedPrefixLength ` +
                    `(${backwardAtFwdMpl}) ≥ forward.matchedPrefixLength (${fwdMpl}) ` +
                    `(prefix="${prefix}") — backward should back up`,
            );
        }
    }

    // #8: fwdMpl ≠ bwdMpl AND backward.directionSensitive →
    //     completion(input[0..bwd.mpl], "forward").mpl ≥ bwd.mpl
    //     When backward backs up to a different position and says direction
    //     matters there, forward on the truncated input should consume at
    //     least to backward's position (confirming it's reachable).
    if (fwdMpl !== bwdMpl && backward.directionSensitive) {
        const truncated = prefix.substring(0, bwdMpl);
        const forwardAtBwd = baseFn(grammar, truncated, undefined, "forward");
        const forwardAtBwdMpl = forwardAtBwd.matchedPrefixLength ?? 0;
        // Guard: skip when forward can't reach backward's position
        // at all (mpl=0).  This is a known gap — e.g. number-variable
        // at EOI where forward doesn't call updateMaxPrefixLength.
        // See completion.md § Known gaps.
        if (forwardAtBwdMpl < bwdMpl && forwardAtBwdMpl > 0) {
            throw new Error(
                `Invariant #8: backward.directionSensitive=true but ` +
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

        assertTruncatedForwardInvariant(
            forward,
            prefix,
            "forward",
            minPrefixLength,
            grammar,
            baseFn,
        );
        assertTruncatedForwardInvariant(
            backward,
            prefix,
            "backward",
            minPrefixLength,
            grammar,
            baseFn,
        );

        assertCrossDirectionInvariants(
            forward,
            backward,
            prefix,
            grammar,
            baseFn,
        );

        return requestedDirection === "backward" ? backward : forward;
    };
}

/**
 * Assert completion metadata fields in a canonical order.
 * Only the fields present in `expected` are checked.
 *
 * Supports two formats:
 *   - Flat (backward-compatible): { completions, separatorMode, ... }
 *     When the result has exactly one group, `completions` and
 *     `separatorMode` are checked against that single group.
 *   - Grouped: { groups: [{ completions, separatorMode }, ...], ... }
 *     Each group is checked individually.
 */
export function expectMetadata(
    result: GrammarCompletionResult,
    expected: {
        completions?: string[];
        groups?: { completions: string[]; separatorMode: string }[];
        matchedPrefixLength?: number;
        separatorMode?: SeparatorMode | undefined;
        closedSet?: boolean;
        directionSensitive?: boolean;
        afterWildcard?: string;
        properties?: Partial<GrammarCompletionProperty>[];
    },
): void {
    if ("groups" in expected && "completions" in expected) {
        throw new Error(
            "expectMetadata: 'groups' and 'completions' are mutually exclusive",
        );
    }

    // Convert flat format to grouped, then use a common check path.
    let expectedGroups:
        | { completions: string[]; separatorMode?: string }[]
        | undefined;
    if ("groups" in expected && expected.groups !== undefined) {
        expectedGroups = expected.groups;
    } else if ("completions" in expected) {
        expectedGroups =
            expected.completions.length === 0
                ? []
                : [
                      {
                          completions: expected.completions,
                          ...("separatorMode" in expected &&
                          expected.separatorMode !== undefined
                              ? { separatorMode: expected.separatorMode }
                              : {}),
                      },
                  ];
    }

    // Common check path for groups.
    if (expectedGroups !== undefined) {
        const checkSeparatorMode = expectedGroups.some(
            (g) => g.separatorMode !== undefined,
        );
        const normalizedActual = normalizeGroups(result.groups);
        const normalizedExpected = normalizeGroups(
            expectedGroups.map((g) => ({
                ...g,
                separatorMode: g.separatorMode ?? "space",
            })),
        );
        if (checkSeparatorMode) {
            expect(normalizedActual).toEqual(normalizedExpected);
        } else {
            expect(normalizedActual.map((g) => g.completions)).toEqual(
                normalizedExpected.map((g) => g.completions),
            );
        }
    }
    if ("matchedPrefixLength" in expected) {
        expect(result.matchedPrefixLength).toBe(expected.matchedPrefixLength);
    }
    if ("closedSet" in expected) {
        expect(result.closedSet).toBe(expected.closedSet);
    }
    if ("directionSensitive" in expected) {
        expect(result.directionSensitive).toBe(expected.directionSensitive);
    }
    if ("afterWildcard" in expected) {
        expect(result.afterWildcard).toBe(expected.afterWildcard);
    }
    if ("properties" in expected) {
        // Sort properties by propertyNames so order is not significant.
        const sortProps = <T extends { propertyNames?: string[] }>(
            arr: T[],
        ): T[] =>
            [...arr].sort((a, b) =>
                [...(a.propertyNames ?? [])]
                    .sort()
                    .join(",")
                    .localeCompare(
                        [...(b.propertyNames ?? [])].sort().join(","),
                    ),
            );

        // When the expected property objects omit separatorMode, strip it
        // from actuals so existing tests don't break.  Tests that want to
        // assert separatorMode include it explicitly.
        const checkSeparatorMode = (expected.properties ?? []).some(
            (p) => "separatorMode" in p,
        );
        if (checkSeparatorMode) {
            expect(sortProps(result.properties ?? [])).toEqual(
                sortProps(expected.properties ?? []),
            );
        } else {
            const stripped = (result.properties ?? []).map(
                ({ separatorMode: _, ...rest }) => rest,
            );
            expect(sortProps(stripped)).toEqual(
                sortProps(expected.properties ?? []),
            );
        }
    }
}

/**
 * Collect every `RulesPart` reachable from `rules`, deduplicating
 * traversal of identity-shared `alternatives` arrays *and*
 * dispatch-bucket arrays.  Without bucket dedup, parts whose
 * `dispatch` table maps multiple tokens to the same bucket array
 * would have their `RulesPart`s counted once per token; tests that
 * assert exact counts on dispatched grammars need the dedup.
 *
 * Each `RulesPart` is itself emitted exactly once even if it appears
 * via multiple bucket references (since `p.alternatives` identity is
 * the same).  Use `findAllRulesPartsInGrammar` when the optimizer's
 * dispatch pass may have hoisted the top-level alternation onto
 * `grammar.dispatch` (leaving `grammar.alternatives` empty / trimmed).
 */
export function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    collectRulesPartsInto(rules, undefined, out, new Set<GrammarRule[]>());
    return out;
}

/**
 * Like `findAllRulesParts` but also walks the grammar-level dispatch
 * buckets - needed when the optimizer's dispatch pass hoists the
 * top-level alternation onto `grammar.dispatch`, leaving
 * `grammar.alternatives` (the fallback subset) empty or trimmed.
 *
 * Uses a single shared `visited` set across `grammar.alternatives`
 * and every top-level dispatch bucket so a `RulesPart` reachable from
 * multiple top-level entries is still emitted exactly once.
 */
export function findAllRulesPartsInGrammar(grammar: Grammar): RulesPart[] {
    const out: RulesPart[] = [];
    collectRulesPartsInto(
        grammar.alternatives,
        grammar.dispatch,
        out,
        new Set<GrammarRule[]>(),
    );
    return out;
}

function collectRulesPartsInto(
    rules: GrammarRule[],
    dispatch: DispatchModeBucket[] | undefined,
    out: RulesPart[],
    visited: Set<GrammarRule[]>,
): void {
    const walkBucket = (bucket: GrammarRule[]) => {
        if (visited.has(bucket)) return;
        visited.add(bucket);
        for (const r of bucket) {
            for (const p of r.parts) {
                if (p.type !== "rules") continue;
                out.push(p);
                walkBucket(p.alternatives);
                if (p.dispatch !== undefined) {
                    for (const m of p.dispatch) {
                        for (const b of m.tokenMap.values()) walkBucket(b);
                    }
                }
            }
        }
    };
    walkBucket(rules);
    if (dispatch !== undefined) {
        for (const m of dispatch) {
            for (const b of m.tokenMap.values()) walkBucket(b);
        }
    }
}
