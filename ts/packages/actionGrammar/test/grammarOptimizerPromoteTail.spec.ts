// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the `promoteTailRulesParts` optimizer pass.  Each rule
 * whose last part is a `RulesPart` (and meets the structural
 * contract) is converted in place to a tail call: the wrapper
 * variable is dropped and `tailCall: true` is set.  When the parent
 * carries a `value` expression that references the wrapper variable,
 * the expression is folded into each member's `value` (substitution
 * mode); otherwise no member rewrite is needed (forwarding mode).
 *
 * The pass is observably equivalent to the unoptimized grammar -
 * tests below pin both behavioral parity with the baseline and the
 * structural shape (`tailCall: true`, no wrapper variable).
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { findAllRulesParts } from "./testUtils.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

describe("Grammar Optimizer - promoteTailRulesParts", () => {
    describe("forwarding mode (parent.value === undefined)", () => {
        // Single-part rule whose only part is a trailing nested
        // alternation, no parent value.  The implicit-default rule
        // forwards the RulesPart's captured value; promoting to
        // tail flows it up directly via the tail-entry mechanism.
        it("promotes single-part trailing RulesPart", () => {
            const text = `<Inner> = a -> 1 | b -> 2;
<Start> = <Inner>;`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            expect(match(optimized, "a")).toStrictEqual(match(baseline, "a"));
            expect(match(optimized, "b")).toStrictEqual(match(baseline, "b"));
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            // Exactly one promotion site: the single trailing
            // <Inner> reference in <Start>.  Asserting the exact
            // count (rather than `>= 1`) catches a regression that
            // accidentally promotes inside <Inner>'s own member
            // rules or emits multiple wrappers per fork.
            expect(tailParts).toHaveLength(1);
            for (const tp of tailParts) {
                expect(tp.variable).toBeUndefined();
                expect(tp.repeat).toBeFalsy();
                expect(tp.optional).toBeFalsy();
            }
            // Top-level: still a single <Start> rule whose last
            // part is the promoted tail RulesPart.
            expect(optimized.alternatives).toHaveLength(1);
            const startRule = optimized.alternatives[0];
            expect(startRule.parts[startRule.parts.length - 1]).toBe(
                tailParts[0],
            );
        });

        // Multi-part rule where the trailing RulesPart is the sole
        // implicit-default contributor (preceding parts are unbound
        // string literals).  Promotable.
        it("promotes when trailing RulesPart is the sole contributor", () => {
            const text = `<Inner> = a -> 1 | b -> 2;
<Start> = play $(v:<Inner>);`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            for (const input of ["play a", "play b"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            // Exactly one promotion: the trailing <Inner> reference
            // in <Start>.  <Inner>'s own alts are leaf StringParts
            // and have no trailing RulesPart to promote.
            expect(tailParts).toHaveLength(1);
        });

        // Multi-part rule with TWO implicit-default contributors
        // before the trailing RulesPart (a wildcard capture and a
        // bound trailing rule).  The matcher's implicit-default
        // rule throws "multiple values for default" at finalize time
        // for such shapes; promoting would mask that throw via
        // tail-entry, so the pass must bail out.  Wrapped under a
        // start rule that doesn't capture `<Mid>`'s value, so the
        // compiler doesn't reject the multi-contributor shape up
        // front (only the matcher would, on a successful match
        // attempt).
        it("does not promote when a prefix part also contributes to implicit default", () => {
            const text = `<Inner> = a -> 1 | b -> 2;
<Mid> = $(prefix:string) $(v:<Inner>);
<Start> = run <Mid> -> "ok";`;
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            // <Mid>'s trailing <Inner> reference must not be
            // promoted (multi-contributor bailout).  <Start>'s own
            // trailing <Mid> reference is also not promoted: it
            // has no value, only one alternative, so fails the
            // effective-member-count >= 2 check.
            expect(tailParts).toHaveLength(0);
        });
    });

    describe("substitution mode (parent.value references wrapper var)", () => {
        // Parent's value expression references `v` (the wrapper
        // variable).  Promoting requires folding each member's
        // effective value into the parent's value expression.
        it("substitutes member values into parent.value", () => {
            const text = `<Inner> = a -> 1 | b -> 2;
<Start> = play $(v:<Inner>) -> { kind: "play", v };`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            for (const input of ["play a", "play b"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            // Exactly one promotion site: the trailing <Inner>
            // reference in <Start>.
            expect(tailParts).toHaveLength(1);
            // Wrapper variable has been dropped.
            for (const tp of tailParts) {
                expect(tp.variable).toBeUndefined();
            }
        });

        // Parent.value references a *different* binding (one of the
        // prefix parts), not the wrapper variable.  Substitution
        // would silently drop parent.value's actual computation, so
        // the pass must bail out.
        it("does not promote when parent.value does not reference the wrapper var", () => {
            const text = `<Inner> = a -> 1 | b -> 2;
<Start> = $(prefix:string) $(v:<Inner>) -> { prefix };`;
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            expect(tailParts).toHaveLength(0);
        });

        // Multi-member dispatched parent (created by another pass)
        // promoted in substitution mode: members live in the
        // dispatch buckets and must be rewritten in place.
        it("substitutes through dispatched buckets", () => {
            const text = `<Inner> = alpha -> 1 | beta -> 2;
<Start> = run $(v:<Inner>) -> { ran: v };`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: {
                    dispatchifyAlternations: true,
                    promoteTailRulesParts: true,
                },
            });
            for (const input of ["run alpha", "run beta"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });

    describe("variable name collisions", () => {
        // Member rules bind the same top-level name (`p`) that the
        // parent's prefix also binds and that `parent.value`
        // references.  After promotion the member runs with the
        // parent's `valueIds` chain visible, and member's own
        // bindings cons onto that chain - so a substituted reference
        // to `p` that *meant* the outer prefix would resolve to the
        // member's `p` instead.  α-renaming each member's top-level
        // bindings to opaque names (`__opt_inline_<n>`) before
        // substitution avoids the collision.
        it("does not let member bindings shadow prefix-bound vars referenced from parent.value", () => {
            const text = `<Inner> = x $(p:string) -> p | y $(p:string) -> p;
<Start> = pre $(p:string) end $(v:<Inner>) -> { outer: p, inner: v };`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            for (const input of [
                "pre alpha end x beta",
                "pre alpha end y beta",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
            // Sanity: the outer should be `alpha`, the inner
            // `beta`, NOT both `beta`.
            expect(match(optimized, "pre alpha end x beta")).toStrictEqual([
                { outer: "alpha", inner: "beta" },
            ]);
        });
    });

    describe("contract guards", () => {
        // Single-rule "alternation" - effective member count == 1,
        // doesn't satisfy the tail-contract `>= 2`.
        it("does not promote single-member RulesPart", () => {
            const text = `<Inner> = a -> 1;
<Start> = play $(v:<Inner>);`;
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { promoteTailRulesParts: true },
            });
            const tailParts = findAllRulesParts(optimized.alternatives).filter(
                (rp) => rp.tailCall,
            );
            expect(tailParts).toHaveLength(0);
        });
    });
});
