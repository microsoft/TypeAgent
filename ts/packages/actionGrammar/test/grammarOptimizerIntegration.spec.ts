// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration / API-surface coverage for `optimizeGrammar`,
 * `inlineSingleAlternativeRules`, and `factorCommonPrefixes` —
 * exercising the public function entry points and the compiler-level
 * orchestration.
 *
 * Specifically:
 *   - `optimizeGrammar(grammar, undefined)` early-return path.
 *   - Compiler skips optimization when the grammar has parse/compile
 *     errors (the AST may be partial and optimizer invariants would
 *     not hold).
 *   - The defensive guard in the inliner that refuses to retarget a
 *     parent's `part.variable` onto a child rule with multiple
 *     variable-bearing parts (unreachable from any well-formed source
 *     grammar — exercised by direct AST construction).
 *   - The two-pass inline + factor pipeline observably collapses
 *     wrappers exposed by factoring (re-runs the inliner after
 *     factoring).
 */

import {
    loadGrammarRules,
    loadGrammarRulesNoThrow,
} from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import {
    inlineSingleAlternativeRules,
    optimizeGrammar,
} from "../src/grammarOptimizer.js";
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

    it("inlineSingleAlternativeRules refuses to retarget parent.variable onto child with multiple variable-bearing parts", () => {
        // Direct AST construction: this shape is rejected by the
        // grammar compiler (a no-value rule with two wildcards
        // violates the matcher's default-value contract), so it is
        // unreachable from real source.  But the inliner still
        // defends against it — when parent captures child via a
        // variable and child has more than one variable-bearing part,
        // the inliner can't pick which child binding should receive
        // the parent's variable name and must leave the wrapper
        // nested.
        const childRules: GrammarRule[] = [
            {
                parts: [
                    { type: "wildcard", typeName: "string", variable: "a" },
                    { type: "wildcard", typeName: "string", variable: "b" },
                ],
                // No value expression.
            },
        ];
        const parentRules: GrammarRule[] = [
            {
                parts: [
                    {
                        type: "rules",
                        alternatives: childRules,
                        variable: "captured",
                    },
                ],
            },
        ];
        const optimized = inlineSingleAlternativeRules(parentRules);
        // No inlining took place — the RulesPart is preserved and the
        // result has the same identity (no rewrite).
        expect(optimized).toBe(parentRules);
        // And the inner shape is unchanged.
        const part = optimized[0].parts[0];
        expect(part.type).toBe("rules");
        if (part.type === "rules") {
            expect(part.alternatives).toBe(childRules);
        }
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
