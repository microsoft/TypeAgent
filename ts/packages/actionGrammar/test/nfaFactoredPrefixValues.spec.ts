// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Regression coverage: grammars where every top-level alternative
// shares a common optional prefix used to fail to compile to an NFA
// once `factorCommonPrefixes` hoisted the shared prefix out, leaving a
// value-less multi-term rule. See nfaCompiler.ts (implicit value
// derivation) and grammarOptimizer.ts (`factorCommonPrefixes`).
//
// Note: `factorCommonPrefixes`'s own output already stamps an
// explicit `value` on the factored top-level rule, so grammar-source
// tests below don't reach the new implicit-derivation code path. The
// hand-built-AST test further down is what directly exercises
// `findSingleValueBearingPart`'s forwarding logic.
//
// NFA's rejection of tailCall RulesParts (still unsupported) is
// already covered by grammarOptimizerTailFactoring.spec.ts ("NFA
// compile of a tail-factored grammar throws a descriptive error") -
// not duplicated here.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import { recommendedOptimizations } from "../src/grammarOptimizer.js";
import {
    Grammar,
    createStringPart,
    createRulesPart,
    createPhraseSetPart,
} from "../src/grammarTypes.js";
import { describeForEachMatcher } from "./testUtils.js";

describe("NFA compilation of factored shared-prefix grammars", () => {
    // Every alternative shares a common optional prefix rule <P>.
    const agr = `
<Start> = <a> | <b>;
<a> = <P> foo -> { actionName: "A" };
<b> = <P> bar -> { actionName: "B" };
<P> = (please)?;
`;

    describeForEachMatcher(
        "compiles and matches correctly with recommendedOptimizations",
        (testMatchGrammar) => {
            it("matches each branch, with and without the shared prefix", () => {
                const grammar = loadGrammarRules("factored-prefix.agr", agr, {
                    optimizations: recommendedOptimizations,
                });

                expect(testMatchGrammar(grammar, "foo")).toStrictEqual([
                    { actionName: "A" },
                ]);
                expect(testMatchGrammar(grammar, "please foo")).toStrictEqual([
                    { actionName: "A" },
                ]);
                expect(testMatchGrammar(grammar, "bar")).toStrictEqual([
                    { actionName: "B" },
                ]);
                expect(testMatchGrammar(grammar, "please bar")).toStrictEqual([
                    { actionName: "B" },
                ]);

                // Unrelated input must still fail.
                expect(testMatchGrammar(grammar, "baz")).toStrictEqual([]);
            });
        },
    );

    it("forwards the single variable-bearing part's value for a value-less multi-term rule", () => {
        // Hand-built AST mirroring the actual bug shape: a value-less
        // 2-part rule (value-less optional prefix + a variable-bearing
        // nested RulesPart), with no top-level `value`. The grammar-source
        // tests above don't exercise this path because
        // `factorCommonPrefixes` and explicit `->` expressions both
        // already stamp `rule.value`, so this is the only test that
        // directly reaches `findSingleValueBearingPart`'s forwarding case.
        const prefixPart = createRulesPart(
            [{ parts: [createStringPart(["please"])] }],
            { optional: true },
        );
        const nestedPart = createRulesPart(
            [
                {
                    parts: [createStringPart(["foo"])],
                    value: { type: "literal", value: "A" },
                },
                {
                    parts: [createStringPart(["bar"])],
                    value: { type: "literal", value: "B" },
                },
            ],
            { variable: "chosen" },
        );
        const grammar: Grammar = {
            alternatives: [{ parts: [prefixPart, nestedPart] }],
        };

        const nfa = compileGrammarToNFA(grammar, "hand-built-factored");

        expect(matchNFA(nfa, ["foo"], true).actionValue).toBe("A");
        expect(matchNFA(nfa, ["please", "bar"], true).actionValue).toBe("B");
    });

    it("throws a clear error when the implicit value is genuinely ambiguous", () => {
        // Raw AST (bypasses the loader's own validation) with two
        // variable-bearing parts and no top-level value.
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        createStringPart(["foo"], "x"),
                        createStringPart(["bar"], "y"),
                    ],
                },
            ],
        };
        expect(() => compileGrammarToNFA(grammar, "ambiguous")).toThrow(
            /implicit value is ambiguous/,
        );
    });

    it("throws an accurate error (not 'Multi-term') for a single-part rule with no variable and no value", () => {
        // Raw AST with exactly one part, that part carrying no variable
        // and no top-level `value`. String-literal single-part rules are
        // auto-normalized (isSingleLiteralRule) to stamp a matched-text
        // value, so this uses an unbound phraseSet part instead - a
        // shape normalizeRule does not special-case. Before
        // deriveEffectiveValue was consolidated to call `deriveValue`
        // uniformly, a rule this shape short-circuited to `rule.value`
        // (undefined) without throwing. It now throws like any other
        // value-less rule - guard here that the message accurately
        // reflects a 1-term rule instead of the multi-term wording.
        const grammar: Grammar = {
            alternatives: [{ parts: [createPhraseSetPart("Polite")] }],
        };
        let message = "";
        try {
            compileGrammarToNFA(grammar, "single-part-none");
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).toMatch(/has 1 term but no value expression/);
        expect(message).not.toMatch(/Multi-term/);
    });

    it("throws an accurate error for a zero-part rule with no value", () => {
        const grammar: Grammar = {
            alternatives: [{ parts: [] }],
        };
        expect(() => compileGrammarToNFA(grammar, "empty-rule")).toThrow(
            /has 0 terms but no value expression/,
        );
    });
});
