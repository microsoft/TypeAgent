// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart, GrammarRule, RulesPart } from "../src/grammarTypes.js";

function findFirstRulesPart(rules: GrammarRule[]): RulesPart | undefined {
    const visit = (parts: GrammarPart[]): RulesPart | undefined => {
        for (const p of parts) {
            if (p.type === "rules") return p;
        }
        for (const p of parts) {
            if (p.type === "rules") {
                for (const r of p.rules) {
                    const inner = visit(r.parts);
                    if (inner) return inner;
                }
            }
        }
        return undefined;
    };
    for (const r of rules) {
        const found = visit(r.parts);
        if (found) return found;
    }
    return undefined;
}

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

describe("Grammar Optimizer - Common prefix factoring", () => {
    it("factors a literal common prefix across alternatives", () => {
        // Three alternatives all share "play the ".
        const text = `<Start> = <Choice>;
<Choice> = play the song -> "song" | play the track -> "track" | play the album -> "album";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });

        // Match results unchanged.
        for (const input of [
            "play the song",
            "play the track",
            "play the album",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }

        // The optimized AST has fewer top-level alternatives in <Choice>.
        const optChoice = findFirstRulesPart(optimized.rules);
        const baseChoice = findFirstRulesPart(baseline.rules);
        expect(optChoice).toBeDefined();
        expect(baseChoice).toBeDefined();
        expect(optChoice!.rules.length).toBeLessThan(baseChoice!.rules.length);
    });

    it("preserves match results when alternatives use different variable names", () => {
        const text = `<Start> = <Choice>;
<Choice> = play $(a:string) -> { kind: "a", v: a }
         | play $(b:string) -> { kind: "b", v: b };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const baseRes = match(baseline, "play hello");
        const optRes = match(optimized, "play hello");
        // Should produce the same set of results (order may differ).
        expect(optRes.length).toBe(baseRes.length);
        expect(optRes).toEqual(expect.arrayContaining(baseRes));
        expect(baseRes).toEqual(expect.arrayContaining(optRes));
    });

    it("no-op when there is only one alternative", () => {
        const text = `<Start> = play the song -> "song";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        expect(JSON.stringify(optimized.rules)).toBe(
            JSON.stringify(baseline.rules),
        );
    });

    it("no-op when alternatives share no leading parts", () => {
        const text = `<Start> = <Choice>;
<Choice> = foo -> 1 | bar -> 2 | baz -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // No shared first part, factoring has nothing to do.
        const optChoice = findFirstRulesPart(optimized.rules);
        const baseChoice = findFirstRulesPart(baseline.rules);
        expect(optChoice!.rules.length).toBe(baseChoice!.rules.length);
        for (const input of ["foo", "bar", "baz"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does not touch repeat groups", () => {
        const text = `<Start> = (a x | a y)+ -> true;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // Repeat groups aren't factored — top-level RulesPart with
        // repeat=true is left as-is.  Match results must still agree.
        expect(match(optimized, "a x a y")).toStrictEqual(
            match(baseline, "a x a y"),
        );
    });

    it("factors shared sub-prefixes inside the suffix group", () => {
        // Two of the three alternatives share a longer prefix (`play song`)
        // beyond the global shared prefix (`play `).  The optimizer should
        // factor the deeper sharing as well, not just the outermost.
        const text = `<Start> = <C>;
<C> = play song $(x:string) -> { kind: "song-x", x }
    | play song $(y:string) -> { kind: "song-y", y }
    | play album $(z:string) -> { kind: "album", z };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play song hello",
            "play album world",
            "play unknown",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
        // Structural: the optimized AST should have nested factoring —
        // top-level RulesPart with one alternative whose suffix RulesPart
        // itself contains a further factored rule for `song`.
        const optChoice = findFirstRulesPart(optimized.rules);
        expect(optChoice).toBeDefined();
        // <C> reduces to a single shared-prefix wrapper.
        expect(optChoice!.rules.length).toBe(1);
        const factored = optChoice!.rules[0];
        // Find the inner RulesPart (the suffix group).
        const innerWrapper = factored.parts.find((p) => p.type === "rules");
        expect(innerWrapper).toBeDefined();
        // The inner suffix group should have collapsed `song x | song y` so
        // its rule count is 2 (one combined `song …` alt + the `album …`
        // alt) rather than 3.
        expect((innerWrapper as { rules: unknown[] }).rules.length).toBe(2);
    });

    it("factors common prefixes across top-level rules", () => {
        // Three top-level alternatives all share "play the ".
        // Top-level factoring should reduce the rule count and preserve
        // match results.
        const text = `<Start> = play the song -> "song"
         | play the track -> "track"
         | play the album -> "album";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // Factoring collapses the 3 top-level alternatives into 1
        // (a shared-prefix rule with a 3-alternative suffix RulesPart).
        expect(optimized.rules.length).toBeLessThan(baseline.rules.length);
        for (const input of [
            "play the song",
            "play the track",
            "play the album",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
    });
});
