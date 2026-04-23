// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Targeted tests for the trie-based common-prefix factoring rewrite:
 * each test exercises a specific risk category called out during the
 * design (see grammarOptimizer.ts factorRulesPart docstring).
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart, GrammarRule, RulesPart } from "../src/grammarTypes.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, s: string) {
    return matchGrammar(grammar, s).map((m) => m.match);
}

function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                out.push(p);
                for (const r of p.rules) visit(r.parts);
            }
        }
    };
    for (const r of rules) visit(r.parts);
    return out;
}

describe("Grammar Optimizer - Trie risks", () => {
    // ── Risk: cross-scope reference forces bailout, but factoring above
    //         the bailed fork still applies.
    it("bailout at one fork still allows factoring above", () => {
        // <Inner> binds `trackName`; both <Play> alternatives reference
        // it in their value expression — factoring the <Inner> RulesPart
        // would put the binding into outer scope, which the matcher
        // can't see.  The deep fork bails, but `play` should still get
        // factored at the outer level.
        const text = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello by alice",
            "play the world from album unity",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: shared RulesPart array identity must be preserved (the
    //         serializer dedupes by Map<GrammarRule[], number>).
    it("preserves shared RulesPart array identity", () => {
        // Two top-level alternatives both reference <Inner>.  After
        // factoring, every emitted RulesPart that points at <Inner>
        // should share the same `rules` array object.
        const text = `<Start> = <Cmd>;
<Inner> = a -> 1 | b -> 2;
<Cmd> = play $(x:<Inner>) -> { kind: "play", x }
      | stop $(x:<Inner>) -> { kind: "stop", x };`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const innerRulesArrays = new Set<unknown>();
        for (const rp of findAllRulesParts(optimized.rules)) {
            // Heuristic: any RulesPart with two child rules whose first
            // parts are both phraseSet/string and whose values are 1 / 2
            // is the <Inner> body.
            if (
                rp.rules.length === 2 &&
                rp.rules[0].value !== undefined &&
                rp.rules[1].value !== undefined &&
                JSON.stringify(rp.rules[0].value) ===
                    '{"type":"literal","value":1}' &&
                JSON.stringify(rp.rules[1].value) ===
                    '{"type":"literal","value":2}'
            ) {
                innerRulesArrays.add(rp.rules);
            }
        }
        // Both references to <Inner> produce edges that point at the
        // same `rules` array (Set size === 1).
        expect(innerRulesArrays.size).toBe(1);
    });

    // ── Risk: a rule whose entire path is a strict prefix of another's
    //         path becomes a terminal AND a forking node at the same
    //         trie spot.
    it("handles a rule that is a strict prefix of another (no values)", () => {
        const text = `<Start> = <X>;
<X> = play
    | play song;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play song"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: same as above, but mixed value-presence forces bailout
    //         (the shorter rule has explicit value, the longer doesn't).
    it("handles strict-prefix overlap with mixed value-presence", () => {
        const text = `<Start> = <X>;
<X> = play -> "just"
    | play song;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play song"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: deep multi-level factoring — three layers of shared
    //         prefix should all collapse.
    it("factors at multiple depths (a b c x | a b c y | a b d z)", () => {
        const text = `<Start> = <X>;
<X> = a b c x -> 1
    | a b c y -> 2
    | a b d z -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["a b c x", "a b c y", "a b d z"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: variable name collision across alternatives — the lead
    //         alternative's variable name wins; later alternatives' value
    //         expressions must be remapped.
    it("canonicalizes variable names from differently-named bindings", () => {
        const text = `<Start> = <C>;
<C> = play $(track:string) once -> { kind: "once", track }
    | play $(song:string) twice -> { kind: "twice", v: song };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play hello once", "play hello twice"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: factoring intersects with object-shorthand value.  After
    //         remapping, `{ name }` from a non-lead alternative must be
    //         expanded to `{ name: <canonical> }` so the field key
    //         doesn't change.
    it("rewrites object shorthand keys when remapping (non-lead alt)", () => {
        const text = `<Start> = <X>;
<X> = greet $(name:string) -> { name }
    | greet $(other:string) twice -> { other };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["greet alice", "greet bob twice"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: order preservation across multiple groups at the same
    //         trie level — output ordering should match the original
    //         rule order semantically (same matches).
    it("preserves match order across interleaved groups", () => {
        // Three groups: foo*, bar*, foo* again.  Trie merges the two
        // foo* rules (insertion-order at root), bar stays separate.
        const text = `<Start> = <X>;
<X> = foo a -> 1
    | bar -> 2
    | foo b -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["foo a", "foo b", "bar"]) {
            // Same multi-set of match results.
            const baseRes = match(baseline, input).map((m) =>
                JSON.stringify(m),
            );
            const optRes = match(optimized, input).map((m) =>
                JSON.stringify(m),
            );
            expect(optRes.sort()).toStrictEqual(baseRes.sort());
        }
    });

    // ── Risk: nested factoring + outer factoring composing — the inner
    //         RulesPart returned by emit() is reused as a member at the
    //         outer level, so the wrapper's variable name must not
    //         collide with the inner wrapper's.
    it("avoids wrapper-variable collisions across nested factoring", () => {
        const text = `<Start> = <X>;
<X> = play song red -> "sr"
    | play song blue -> "sb"
    | play album green -> "ag"
    | play album yellow -> "ay";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play song red",
            "play song blue",
            "play album green",
            "play album yellow",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
