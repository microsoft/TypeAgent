// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart, GrammarRule, RulesPart } from "../src/grammarTypes.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
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

describe("Grammar Optimizer - tail RulesPart factoring (opt-in)", () => {
    // Without the opt-in, the cross-scope-ref bailout still fires and
    // no tail RulesPart is emitted — matcher results stay correct.
    it("does not emit tail wrappers without the tailFactoring flag", () => {
        const text = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const tailParts = findAllRulesParts(optimized.rules).filter(
            (rp) => rp.tail,
        );
        expect(tailParts).toHaveLength(0);
    });

    // The motivating case: shared `play <Inner> by <ArtistName>` /
    // `play <Inner> from album <AlbumName>` prefix factoring previously
    // bailed via cross-scope-ref because each member's value references
    // the prefix-bound `trackName`.  With tailFactoring enabled, we
    // emit a tail RulesPart and the matcher still returns the same
    // results.
    it("emits a tail wrapper for the playerSchema-shaped grammar", () => {
        const text = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });

        const tailParts = findAllRulesParts(optimized.rules).filter(
            (rp) => rp.tail,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);
        for (const tp of tailParts) {
            expect(tp.variable).toBeUndefined();
            expect(tp.optional).toBeFalsy();
            expect(tp.repeat).toBeFalsy();
        }

        for (const input of [
            "play hello by alice",
            "play the world by bob",
            "play hello from album unity",
            "play the world from album greatest",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
        expect(match(optimized, "play hello by alice")).toStrictEqual([
            { kind: "by", trackName: "hello", artist: "alice" },
        ]);
        expect(match(optimized, "play hello from album unity")).toStrictEqual([
            { kind: "from", trackName: "hello", albumName: "unity" },
        ]);
    });

    // Backtracking discipline: when one branch consumes input that
    // doesn't validate, the matcher must restore valueIds so a sibling
    // alt can rebind the same canonical without bleed-through.
    it("backtracks correctly across tail siblings", () => {
        const text = `<Start> = <X>;
<Tail> = a $(v:string) -> { branch: "a", v }
       | b $(v:string) -> { branch: "b", v };
<X> = pre $(prefix:string) <Tail>;`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        // With distinct member binding names but no prefix reference,
        // the cross-scope check would not need tail; this test pins
        // matcher behavior under tail-factoring stays sane regardless.
        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["pre hello a world", "pre hello b world"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
