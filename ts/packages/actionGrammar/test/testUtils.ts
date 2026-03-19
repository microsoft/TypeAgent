// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    matchGrammar,
    matchGrammarCompletion,
    type GrammarCompletionResult,
} from "../src/grammarMatcher.js";
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
            return matchGrammarCompletion;
        case "nfa":
            return testCompletionNFA;
        case "dfa":
            return testCompletionDFA;
    }
}

const completionVariants: CompletionVariant[] = ["grammar"];
// TODO: Enable "nfa" and "dfa" variants once they match grammarMatcher completion behavior.
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
