// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Regression coverage for the "shared optional prefix breaks NFA
// compilation" bug: when every top-level alternative shares a common
// optional leading rule (e.g. an optional politeness lead-in), the
// grammar optimizer's `factorCommonPrefixes` pass hoists that prefix
// out, leaving a value-less multi-term rule whose remaining value
// lives on a nested `RulesPart`. The NFA compiler used to reject this
// shape outright (`nfaCompiler.ts:619`) even though the AST-walking
// matcher evaluates it correctly.
//
// Fix: (A) the NFA compiler now derives an implicit forwarding value
// for multi-term rules with exactly one variable-bearing part, mirroring
// the matcher's own implicit-default rule; (B) `nfaSafeOptimizations`
// (recommendedOptimizations minus `tailFactoring` /
// `promoteTailRulesParts`) avoids emitting the `tailCall` RulesParts the
// NFA compiler still can't support, so the two changes work together.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import {
    recommendedOptimizations,
    nfaSafeOptimizations,
} from "../src/grammarOptimizer.js";
import { Grammar, createStringPart } from "../src/grammarTypes.js";

describe("NFA compilation of factored shared-prefix grammars", () => {
    // Minimal repro straight from the bug report: every alternative
    // shares a common optional prefix rule <P>.
    const agr = `
<Start> = <a> | <b>;
<a> = <P> foo -> { actionName: "A" };
<b> = <P> bar -> { actionName: "B" };
<P> = (please)?;
`;

    it("compiles and matches correctly with nfaSafeOptimizations", () => {
        const grammar = loadGrammarRules("factored-prefix.agr", agr, {
            optimizations: nfaSafeOptimizations,
        });

        const nfa = compileGrammarToNFA(grammar, "factored-prefix");

        expect(matchNFA(nfa, ["foo"], true).matched).toBe(true);
        expect(matchNFA(nfa, ["foo"], true).actionValue).toEqual({
            actionName: "A",
        });

        expect(matchNFA(nfa, ["please", "foo"], true).matched).toBe(true);
        expect(matchNFA(nfa, ["please", "foo"], true).actionValue).toEqual({
            actionName: "A",
        });

        expect(matchNFA(nfa, ["bar"], true).matched).toBe(true);
        expect(matchNFA(nfa, ["bar"], true).actionValue).toEqual({
            actionName: "B",
        });

        expect(matchNFA(nfa, ["please", "bar"], true).matched).toBe(true);
        expect(matchNFA(nfa, ["please", "bar"], true).actionValue).toEqual({
            actionName: "B",
        });

        // Unrelated input must still fail.
        expect(matchNFA(nfa, ["baz"], true).matched).toBe(false);
    });

    it("still refuses tailCall RulesParts from recommendedOptimizations, with a clear message", () => {
        // recommendedOptimizations enables tailFactoring /
        // promoteTailRulesParts, which the NFA compiler does not (and
        // by design cannot cheaply) support. This documents the
        // remaining, intentional limitation so a future attempt to
        // silently "fix" it here doesn't mask a real incompatibility.
        const grammar = loadGrammarRules("factored-prefix.agr", agr, {
            optimizations: recommendedOptimizations,
        });

        expect(() =>
            compileGrammarToNFA(grammar, "factored-prefix-tail"),
        ).toThrow(/tailCall RulesPart/);
    });

    it("derives an implicit value for a manually-authored factored rule", () => {
        // Same shape as above, but hand-written (bypassing the
        // optimizer) to directly exercise the NFA compiler's new
        // implicit-value derivation for multi-term, value-less rules.
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

    it("throws a clear error when the implicit value is genuinely ambiguous", () => {
        // Two variable-bearing parts with no top-level value: neither
        // the matcher nor the NFA compiler can determine which one's
        // value should be forwarded. Built as a raw AST (bypassing the
        // parser/loader's own stricter "start rule must produce a
        // value" validation) to exercise the NFA compiler's defensive
        // check in isolation - this shape should never be reachable
        // through the normal parse+optimize pipeline, but the compiler
        // must still fail loudly and clearly if it ever is.
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
