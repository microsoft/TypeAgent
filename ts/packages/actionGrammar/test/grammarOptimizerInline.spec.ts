// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart, GrammarRule } from "../src/grammarTypes.js";

function countRulesParts(rules: GrammarRule[]): number {
    let n = 0;
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                n++;
                for (const r of p.rules) visit(r.parts);
            }
        }
    };
    for (const r of rules) visit(r.parts);
    return n;
}

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

describe("Grammar Optimizer - Inline single-alternative RulesPart", () => {
    it("inlines a simple pass-through wrapper rule", () => {
        const text = `<Start> = <Inner> -> true;
<Inner> = play world;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });

        // Baseline has at least one wrapping RulesPart for <Inner>.
        expect(countRulesParts(baseline.rules)).toBeGreaterThan(
            countRulesParts(optimized.rules),
        );
        expect(match(optimized, "play world")).toStrictEqual([true]);
        expect(match(baseline, "play world")).toStrictEqual(
            match(optimized, "play world"),
        );
    });

    it("preserves variable binding when inlining a wildcard child", () => {
        const text = `<Start> = play $(t:<TrackName>) -> t;
<TrackName> = $(name:string) -> name;`;
        // Note: <TrackName> has a value expression, so the inliner must
        // refuse to inline it (would lose the value).
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(match(optimized, "play hello")).toStrictEqual(["hello"]);
    });

    it("inlines single-part parent without value by hoisting child's value", () => {
        const text = `<Start> = <Wrap>;
<Wrap> = hello -> { greeting: true };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        // The child rule has a value expression and the parent is a
        // single-part wrapper with no value.  The optimizer hoists
        // child's value onto the parent and inlines child's parts.
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "hello")).toStrictEqual([{ greeting: true }]);
        expect(match(optimized, "hello")).toStrictEqual(
            match(baseline, "hello"),
        );
    });

    it("skips inlining when the part is repeated", () => {
        const text = `<Start> = (<Inner>)+ -> true;
<Inner> = a;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        // The outer (...)+ is itself a RulesPart with repeat=true and
        // cannot be flattened.  The inner <Inner> reference, however,
        // can collapse one level (it's a single-alternative wrapper).
        expect(match(optimized, "a a a")).toStrictEqual(
            match(baseline, "a a a"),
        );
    });

    it("inline + factor combined: still produces the same matches", () => {
        const text = `<Start> = play the $(t:<Thing>) -> t;
<Thing> = song -> "song" | track -> "track" | album -> "album";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
            },
        });
        for (const input of [
            "play the song",
            "play the track",
            "play the album",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("optimizations off by default leave the AST unchanged", () => {
        const text = `<Start> = <Inner>;
<Inner> = hello world -> true;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const noOpt = loadGrammarRules("t.grammar", text, {});
        expect(JSON.stringify(noOpt.rules)).toBe(
            JSON.stringify(baseline.rules),
        );
    });

    // Regression: child with auto (undefined) spacingMode must NOT be
    // inlined into a parent with an explicit mode (e.g. "required"),
    // because `undefined` is its own mode at runtime — boundaries
    // resolve per character pair — and inlining changes how the matcher
    // treats those boundaries.
    it("skips inlining when child spacingMode (auto) differs from parent (required)", () => {
        // Parent <Start> declares [spacing=required]; child <Inner>
        // inherits auto.  The two are not equivalent at e.g. digit↔Latin
        // boundaries, so the inliner must leave the wrapper in place.
        const text = `<Start> [spacing=required] = play <Inner> -> true;
<Inner> = hello world;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBe(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "play hello world")).toStrictEqual(
            match(baseline, "play hello world"),
        );
    });

    it("inlines child with value expression by substituting into parent's value", () => {
        // Parent captures <Inner> into `t` and references it in its
        // value expression.  The inliner can substitute Inner's value
        // expression for `t` and inline Inner's parts.
        const text = `<Start> = play $(t:<Inner>) -> { kind: "play", what: t };
<Inner> = $(name:string) loud -> { who: name };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "play hello loud")).toStrictEqual(
            match(baseline, "play hello loud"),
        );
        expect(match(optimized, "play hello loud")).toStrictEqual([
            { kind: "play", what: { who: "hello" } },
        ]);
    });

    it("inlines and drops child value when child value is unobservable (no part.variable, multi-part parent)", () => {
        // Child has a value expression but parent does not capture it
        // via a variable AND parent has more than one part — so the
        // matcher's single-part default-value rule never fires.  The
        // child's value is unobservable at runtime, so the inliner can
        // safely drop it and inline the child's parts.
        const text = `<Start> = play <Inner> now -> true;
<Inner> = $(name:string) loud -> { who: name };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "play hello loud now")).toStrictEqual(
            match(baseline, "play hello loud now"),
        );
        expect(match(optimized, "play hello loud now")).toStrictEqual([true]);
    });

    it("inlines single-part parent without value by hoisting child's value (with bindings)", () => {
        // Parent has a single part (the <Inner> RulesPart) and no
        // explicit value of its own — so the matcher would use
        // child.value as the parent's default.  The optimizer hoists
        // child.value onto the parent and inlines child.parts.  The
        // bindings child.value references (e.g. `name`) come along in
        // the inlined parts, so they remain in scope for the hoisted
        // expression.
        const text = `<Start> = <Inner>;
<Inner> = $(name:string) loud -> { who: name };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "hello loud")).toStrictEqual(
            match(baseline, "hello loud"),
        );
        expect(match(optimized, "hello loud")).toStrictEqual([
            { who: "hello" },
        ]);
    });

    it("inlines when child and parent share the same explicit spacingMode", () => {
        const text = `<Start> [spacing=required] = play <Inner> -> true;
<Inner> [spacing=required] = hello world;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "play hello world")).toStrictEqual(
            match(baseline, "play hello world"),
        );
    });

    it("α-renames colliding child bindings during value-substitution inline", () => {
        // Parent already has `name` as a binding; child also binds
        // `name`.  Rather than refuse, the inliner α-renames the
        // child's colliding top-level binding (and its references in
        // child.value) to a fresh opaque name before substituting.
        const text = `<Start> = $(name:string) says $(t:<Inner>) -> { speaker: name, said: t };
<Inner> = $(name:string) loud -> name;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        // Inlining proceeded (one fewer RulesPart layer).
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "alice says bob loud")).toStrictEqual(
            match(baseline, "alice says bob loud"),
        );
        expect(match(optimized, "alice says bob loud")).toStrictEqual([
            { speaker: "alice", said: "bob" },
        ]);
    });

    it("inlines and drops child value when parent value does not reference the captured variable", () => {
        // Parent binds <Inner> to `t` but never uses `t` in its value
        // expression.  The child's value is dead at runtime, so the
        // inliner can drop it and inline child.parts.
        const text = `<Start> = play $(t:<Inner>) -> { kind: "play" };
<Inner> = $(name:string) loud -> { who: name };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "play hello loud")).toStrictEqual(
            match(baseline, "play hello loud"),
        );
        expect(match(optimized, "play hello loud")).toStrictEqual([
            { kind: "play" },
        ]);
    });

    it("α-renames child bindings when dropping child value (branch 3 collision)", () => {
        // Parent has its own binding `name` and uses it in the value
        // expression.  The unbound <Inner> falls through to branch (3)
        // (drop child.value, inline child.parts).  Without renaming,
        // child's `name` binding would collide with parent's `name` and
        // the matcher's last-write-wins value resolution would shadow
        // parent's `name` with the inlined child's, giving the wrong
        // result.  With α-rename, the inlined binding gets a fresh
        // opaque name and parent's `name` resolves correctly.
        const text = `<Start> = $(name:string) says <Inner> -> { said: name };
<Inner> = $(name:string) loud -> name;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        // Inlining still proceeds.
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "alice says bob loud")).toStrictEqual(
            match(baseline, "alice says bob loud"),
        );
        expect(match(optimized, "alice says bob loud")).toStrictEqual([
            { said: "alice" },
        ]);
    });

    it("mints unique fresh names across multiple inlines into the same parent", () => {
        // Two distinct child rules are inlined into the same parent via
        // branch (1) substitution.  Each child binds `name` at the top
        // level.  The per-parent rename counter must produce distinct
        // fresh names for the two inlined bindings; otherwise the two
        // bindings would collide in the parent's parts list and the
        // value substitutions would resolve to the wrong source.
        const text = `<Start> = $(a:<X>) and $(b:<Y>) -> { x: a, y: b };
<X> = $(name:string) here -> name;
<Y> = $(name:string) there -> name;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        expect(countRulesParts(optimized.rules)).toBeLessThan(
            countRulesParts(baseline.rules),
        );
        expect(match(optimized, "alice here and bob there")).toStrictEqual(
            match(baseline, "alice here and bob there"),
        );
        expect(match(optimized, "alice here and bob there")).toStrictEqual([
            { x: "alice", y: "bob" },
        ]);
    });
});
