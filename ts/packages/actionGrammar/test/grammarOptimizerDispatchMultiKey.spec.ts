// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Focused tests for the multi-key dispatch classifier
 * (`firstTokenKeys` / `walkPartForKeys`) inside
 * `grammarOptimizer.ts`.  The classifier is not exported, so these
 * tests drive it through the `dispatchifyAlternations` pipeline
 * and inspect the resulting per-rule bucket placement to confirm:
 *
 *   - Optional-rule prefix: walker steps past `(<X>)?` and unions
 *     keys from both `<X>` and the following literal.
 *   - phraseSet first part: `<Polite>` contributes the phrase set's
 *     first tokens as bucket keys.
 *   - Nested RulesPart with mixed members: a non-optional inner
 *     rule whose alternatives all consume reports "consumed" with
 *     keys from each alternative.
 *   - Cycle: an identity-cycling AST (constructed manually -
 *     no source grammar produces one) terminates rather than
 *     recursing forever.  See test for the defense-in-depth
 *     rationale.
 *   - Cap exceeded: a rule that would generate more than
 *     `MAX_DISPATCH_KEYS_PER_RULE` keys drops to fallback.
 *
 * Each scenario also asserts match parity vs the unoptimized
 * baseline so a misclassification can't silently produce wrong
 * matches.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { optimizeGrammar } from "../src/grammarOptimizer.js";
import { Grammar, GrammarRule, RulesPart } from "../src/grammarTypes.js";
import {
    findDispatchPart,
    getDispatchAllTokenMap,
    match,
} from "./dispatchTestHelpers.js";

describe("Grammar Optimizer - multi-key dispatch classifier", () => {
    it("walks past optional rule prefix and unions keys", () => {
        // `(<Hello>)? add ...` should bucket under {hi, hello, add};
        // `(<Hello>)? remove ...` under {hi, hello, remove}.  After
        // bucketing: hi -> [r1, r2], hello -> [r1, r2], add -> [r1],
        // remove -> [r2].
        const text = `<Hello> = hi | hello;
                      <Start> = (<Hello>)? add stuff -> "a"
                              | (<Hello>)? remove stuff -> "r";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        const tokenMap = getDispatchAllTokenMap(dispatch!);
        const keys = Array.from(tokenMap.keys()).sort();
        expect(keys).toEqual(["add", "hello", "hi", "remove"]);
        expect(tokenMap.get("hi")).toHaveLength(2);
        expect(tokenMap.get("hello")).toHaveLength(2);
        expect(tokenMap.get("add")).toHaveLength(1);
        expect(tokenMap.get("remove")).toHaveLength(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "add stuff",
            "remove stuff",
            "hi add stuff",
            "hello remove stuff",
            "no match",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("uses phraseSet first tokens as bucket keys", () => {
        // <Polite> is a built-in phraseSet whose phrases include
        // "please", "could you", "would you", "would you please",
        // "can you", "kindly".  Both rules start with mandatory
        // <Polite>, so each gets the full set of first-tokens as
        // keys.  After bucketing, every key holds [r1, r2].
        const text = `<Start> = <Polite> add stuff -> "a"
                              | <Polite> remove stuff -> "r";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        const tokenMap = getDispatchAllTokenMap(dispatch!);
        const keys = Array.from(tokenMap.keys()).sort();
        // Polite phrases are: please, could you, would you,
        // would you please, can you, kindly.  First tokens:
        // please, could, would, can, kindly (deduped).
        expect(keys).toEqual(["can", "could", "kindly", "please", "would"]);
        for (const k of keys) expect(tokenMap.get(k)).toHaveLength(2);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "please add stuff",
            "can you remove stuff",
            "kindly add stuff",
            "no match",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("nested rules part with multiple consuming members contributes keys from each", () => {
        // <Verb> = play | stop | next; non-optional reference, all
        // alternatives consume.  Rule 1 starts with <Verb> followed
        // by literal "music", so its first-token keys are
        // {play, stop, next} (the outer rule reports "consumed"
        // after walking <Verb>, no further keys from "music").
        const text = `<Verb> = play | stop | next;
                      <Start> = <Verb> music -> "v"
                              | help -> "h";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        const tokenMap = getDispatchAllTokenMap(dispatch!);
        const keys = Array.from(tokenMap.keys()).sort();
        expect(keys).toEqual(["help", "next", "play", "stop"]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play music", "stop music", "help", "no match"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("non-optional wildcard prefix is open and rule drops to fallback", () => {
        // `$(v:string) ...` starts with a non-optional wildcard
        // capture: the classifier reports "open" (anything could
        // match) and the rule drops to fallback rather than being
        // bucketed.  The sibling literal-prefixed rule is still
        // dispatch-eligible, so a DispatchPart is emitted with
        // {sibling} as its only key.
        const text = `<Start> = $(v:string) after -> "w"
                              | sibling word -> "s";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        const tokenMap = getDispatchAllTokenMap(dispatch!);
        const keys = Array.from(tokenMap.keys()).sort();
        expect(keys).toEqual(["sibling"]);
        // The wildcard rule must be in fallback.
        expect(dispatch!.alternatives.length).toBe(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["anything after", "sibling word", "no match"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("rule whose first-token set exceeds the cap drops to fallback", () => {
        // Build a grammar where one rule's first part is an
        // inline alternation of > 64 distinct literals.  The
        // classifier walks every alternative, exceeds
        // MAX_DISPATCH_KEYS_PER_RULE (64), and bails to "open"
        // for that rule.  A second sibling rule starts with a
        // literal so the dispatch part is still emitted.
        //
        // We inspect the *top-level* dispatch on <Start>
        // explicitly (not whatever `findDispatchPart` happens to
        // return first); the inline alternation's own dispatch
        // legitimately holds all the tok* keys.
        // Generate 70 distinct word-only literals.  We cannot use
        // "tok1, tok2, ..." because `dispatchKeyForLiteral` in
        // auto-spacing mode keys on the leading word-boundary
        // script run, so every "tokN" would collapse to the single
        // key "tok" and never approach the cap.  All-letter words
        // like "aaa", "aab", ... each produce a distinct key.
        const letters = "abcdefghij"; // 10
        const bigAlts: string[] = [];
        outer: for (const a of letters) {
            for (const b of letters) {
                bigAlts.push(`a${a}${b}`);
                if (bigAlts.length >= 70) break outer;
            }
        }
        const text = `<Start> = (${bigAlts.join(" | ")}) after -> "b"
                              | sibling word -> "s";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // Top-level dispatch is hoisted to `grammar.dispatch`
        // when the start rule's body is dispatched.
        expect(optimized.dispatch).toBeDefined();
        const topMap = new Map<string, unknown>();
        for (const m of optimized.dispatch!) {
            for (const [k, v] of m.tokenMap) topMap.set(k, v);
        }
        const topKeys = Array.from(topMap.keys()).sort();
        // Sibling literal still buckets under "sibling"; none of
        // the generated alts appear at the <Start> level - the
        // over-cap rule dropped to fallback as a whole.
        expect(topKeys).toEqual(["sibling"]);
        expect(optimized.alternatives.length).toBeGreaterThanOrEqual(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            `${bigAlts[0]} after`,
            `${bigAlts[42]} after`,
            "sibling word",
            "no match",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("cycle guard terminates on identity-cycling AST (defense-in-depth)", () => {
        // The cycle guard in `firstTokenKeys` cannot be triggered
        // by any source-level grammar today: every shape that
        // would cause the walker to re-enter the same
        // `RulesPart.alternatives` array (mutual recursion through
        // optional rule references, optional self-reference,
        // nullable-recursion, ...) is rejected by the compiler's
        // epsilon-cycle detector at load time, and right-recursion
        // past mandatory input short-circuits on "consumed"
        // before the recursion is reached.
        //
        // The guard is kept as defense-in-depth against future
        // optimizer passes that might reshape the AST into an
        // identity-cycle from an acyclic source, and against
        // untrusted JSON loading paths that bypass the source
        // compiler.  This test pins the *termination* property:
        // we hand-build an identity-cycling AST that no compiler
        // would emit and assert that `optimizeGrammar` returns in
        // bounded time without recursing forever.  The exact
        // dispatch shape that results is an implementation detail
        // of the guard's "skippable" choice and is not pinned here
        // - if a future change makes the guard throw or pick a
        // different fallback, this test should still pass as long
        // as the call terminates.
        const cyclingAlts: GrammarRule[] = [];
        const recursivePart: RulesPart = {
            type: "rules",
            alternatives: cyclingAlts,
            optional: true,
        };
        cyclingAlts.push({
            parts: [recursivePart, { type: "string", value: ["alpha"] }],
            value: { type: "literal", value: "a" },
        });
        cyclingAlts.push({
            parts: [{ type: "string", value: ["beta"] }],
            value: { type: "literal", value: "b" },
        });
        const grammar: Grammar = { alternatives: cyclingAlts };
        // Contract under test: the call returns rather than
        // recursing forever.  Any concrete return value is
        // acceptable.
        expect(() =>
            optimizeGrammar(grammar, { dispatchifyAlternations: true }),
        ).not.toThrow();
    });
});
