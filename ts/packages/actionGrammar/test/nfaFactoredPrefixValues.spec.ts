// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Regression coverage: grammars where every top-level alternative
// shares a common optional prefix used to fail to compile to an NFA
// once `factorCommonPrefixes` hoisted the shared prefix out, leaving a
// value-less multi-term rule. See nfaCompiler.ts (implicit value
// derivation) and grammarOptimizer.ts (`nfaSafeOptimizations`).
//
// Note: `factorCommonPrefixes`'s own output already stamps an
// explicit `value` on the factored top-level rule, so grammar-source
// tests below don't reach the new implicit-derivation code path. The
// hand-built-AST test further down is what directly exercises
// `findSingleValueBearingPart`'s forwarding logic.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import {
    recommendedOptimizations,
    nfaSafeOptimizations,
} from "../src/grammarOptimizer.js";
import {
    Grammar,
    createStringPart,
    createRulesPart,
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
        "compiles and matches correctly with nfaSafeOptimizations",
        (testMatchGrammar) => {
            it("matches each branch, with and without the shared prefix", () => {
                const grammar = loadGrammarRules("factored-prefix.agr", agr, {
                    optimizations: nfaSafeOptimizations,
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

    it("still refuses tailCall RulesParts from recommendedOptimizations", () => {
        // tailFactoring/promoteTailRulesParts still aren't NFA-compatible.
        const grammar = loadGrammarRules("factored-prefix.agr", agr, {
            optimizations: recommendedOptimizations,
        });

        expect(() =>
            compileGrammarToNFA(grammar, "factored-prefix-tail"),
        ).toThrow(/tail/i);
    });

    it("evaluates an explicit -> value expression through a manually-factored shape", () => {
        const agr2 = `
<Start> = <a> | <b>;
<a> = (please)? $(w:<Choice>) -> w;
<Choice> = <foo> | <bar>;
<foo> = foo -> { actionName: "A" };
<bar> = bar -> { actionName: "B" };
<b> = never_matches -> { actionName: "unused" };
`;
        const grammar = loadGrammarRules("manual-factored.agr", agr2, {});
        const nfa = compileGrammarToNFA(grammar, "manual-factored");

        expect(matchNFA(nfa, ["foo"], true).actionValue).toEqual({
            actionName: "A",
        });
        expect(matchNFA(nfa, ["please", "bar"], true).actionValue).toEqual({
            actionName: "B",
        });
    });

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
});
