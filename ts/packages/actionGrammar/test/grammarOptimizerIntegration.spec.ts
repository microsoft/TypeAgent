// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration / API-surface coverage for `optimizeGrammar` and the
 * compiler-level orchestration.
 *
 * Specifically:
 *   - `optimizeGrammar(grammar, undefined)` early-return path.
 *   - Compiler skips optimization when the grammar has parse/compile
 *     errors (the AST may be partial and optimizer invariants would
 *     not hold).
 *   - The two-pass inline + factor pipeline observably collapses
 *     wrappers exposed by factoring (re-runs the inliner after
 *     factoring).
 */

import {
    loadGrammarRules,
    loadGrammarRulesNoThrow,
} from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { optimizeGrammar } from "../src/grammarOptimizer.js";
import { Grammar, GrammarPart, GrammarRule } from "../src/grammarTypes.js";

function countRulesParts(rules: GrammarRule[]): number {
    let n = 0;
    const seen = new Set<unknown>();
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                n++;
                if (seen.has(p.alternatives)) continue;
                seen.add(p.alternatives);
                for (const r of p.alternatives) visit(r.parts);
            }
        }
    };
    for (const r of rules) visit(r.parts);
    return n;
}

describe("Grammar Optimizer - Public API entry points", () => {
    it("optimizeGrammar returns the input grammar unchanged when options is undefined", () => {
        const grammar: Grammar = {
            alternatives: [{ parts: [{ type: "string", value: ["hello"] }] }],
        };
        const result = optimizeGrammar(grammar, undefined);
        // Same object identity — early return, no copy.
        expect(result).toBe(grammar);
    });

    it("optimizeGrammar returns the input grammar unchanged when no flags are set", () => {
        const grammar: Grammar = {
            alternatives: [{ parts: [{ type: "string", value: ["hello"] }] }],
        };
        // Both flags off → both passes skipped → returns same identity.
        const result = optimizeGrammar(grammar, {});
        expect(result).toBe(grammar);
    });
});

describe("Grammar Optimizer - Compiler integration", () => {
    it("compiler skips optimization when the grammar has errors", () => {
        // Malformed grammar: <Missing> is referenced but never
        // defined.  parseAndCompileGrammar reports an error; the
        // compiler must NOT call optimizeGrammar (which could choke on
        // the partial AST) and loadGrammarRulesNoThrow returns
        // undefined.
        const errors: string[] = [];
        const result = loadGrammarRulesNoThrow(
            "t.grammar",
            `<Start> = play <Missing>;`,
            errors,
            undefined,
            {
                optimizations: {
                    inlineSingleAlternatives: true,
                    factorCommonPrefixes: true,
                },
            },
        );
        // Returned undefined and reported at least one error — no
        // exception was thrown by the optimizer running on a partial
        // grammar.
        expect(result).toBeUndefined();
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe("Grammar Optimizer - Two-pass inline+factor pipeline", () => {
    it("inline + factor produces no more RulesParts than factor alone", () => {
        // Grammar where factoring exposes single-alternative wrappers
        // that the post-factor inline pass can collapse.  At minimum,
        // the inline+factor combo must not be larger than factor-only.
        const text = `<Start> = play <A> -> 1 | sing <A> -> 2;
<A> = <B>;
<B> = hello;`;
        const factorOnly = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const both = loadGrammarRules("t.grammar", text, {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
            },
        });

        // Combo result must be at least as small (in RulesPart count)
        // as factor-only — the inline pass at the end of the pipeline
        // is observably non-destructive.
        expect(countRulesParts(both.alternatives)).toBeLessThanOrEqual(
            countRulesParts(factorOnly.alternatives),
        );

        // And matches still agree with baseline.
        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["hello", "play hello", "sing hello"]) {
            const baseMatches = matchGrammar(baseline, input).map(
                (m) => m.match,
            );
            const bothMatches = matchGrammar(both, input).map((m) => m.match);
            expect(bothMatches).toStrictEqual(baseMatches);
        }
    });
});
