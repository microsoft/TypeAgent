// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Verifies the optimizer preserves the compiler's shared-rules-array
 * invariant: when two `RulesPart`s reference the same named rule, they
 * must share the same `GrammarRule[]` array identity after optimization.
 *
 * `grammarSerializer.ts` keys its dedup map on that identity
 * (`rulesToIndex.get(p.rules)`) so losing it would inflate
 * serialized `.ag.json` size proportionally to the reference count.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { GrammarPart, GrammarRule, RulesPart } from "../src/grammarTypes.js";

function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    const seen = new Set<unknown>();
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type !== "rules") continue;
            out.push(p);
            if (seen.has(p.rules)) continue;
            seen.add(p.rules);
            for (const r of p.rules) visit(r.parts);
        }
    };
    for (const r of rules) visit(r.parts);
    return out;
}

function match(grammar: ReturnType<typeof loadGrammarRules>, s: string) {
    return matchGrammar(grammar, s).map((m) => m.match);
}

describe("Grammar Optimizer - Shared rule identity preservation", () => {
    // Grammar with a named rule referenced from three different sites.
    const text = `<Start> = <Use1> | <Use2> | <Use3>;
<Use1> = sing $(name:<Common>);
<Use2> = play $(name:<Common>);
<Use3> = hum $(name:<Common>);
<Common> = the song | a track | that tune;`;

    function commonRulesArrays(
        grammar: ReturnType<typeof loadGrammarRules>,
    ): GrammarRule[][] {
        const rps = findAllRulesParts(grammar.rules);
        // Find every RulesPart whose body matches the <Common> shape.
        return rps
            .filter((p) =>
                p.rules.every(
                    (r) =>
                        r.parts.length === 1 &&
                        r.parts[0].type === "string" &&
                        ["the song", "a track", "that tune"].some(
                            (s) => (r.parts[0] as any).value.join(" ") === s,
                        ),
                ),
            )
            .map((p) => p.rules);
    }

    it("baseline compiler produces a single shared <Common> array", () => {
        const baseline = loadGrammarRules("t.grammar", text);
        const arrays = commonRulesArrays(baseline);
        expect(arrays.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < arrays.length; i++) {
            expect(arrays[i]).toBe(arrays[0]);
        }
    });

    for (const [name, opts] of [
        ["inline only", { inlineSingleAlternatives: true }],
        ["factor only", { factorCommonPrefixes: true }],
        [
            "both",
            {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
            },
        ],
    ] as const) {
        it(`preserves shared <Common> array identity (${name})`, () => {
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: opts,
            });
            const arrays = commonRulesArrays(optimized);
            expect(arrays.length).toBeGreaterThanOrEqual(3);
            for (let i = 1; i < arrays.length; i++) {
                expect(arrays[i]).toBe(arrays[0]);
            }
        });

        it(`serialized output dedupes <Common> rule (${name})`, () => {
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: opts,
            });
            const baseJson = grammarToJson(baseline);
            const optJson = grammarToJson(optimized);
            // The body of <Common> should appear in exactly one
            // GrammarRulesJson entry on both sides.
            const countCommonEntries = (json: typeof baseJson) =>
                json.filter(
                    (entry) =>
                        Array.isArray(entry) &&
                        entry.length === 3 &&
                        entry.every(
                            (rule: any) =>
                                rule.parts?.length === 1 &&
                                rule.parts[0].type === "string",
                        ),
                ).length;
            expect(countCommonEntries(baseJson)).toBe(1);
            expect(countCommonEntries(optJson)).toBe(1);
        });

        it(`match results unchanged (${name})`, () => {
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: opts,
            });
            for (const input of [
                "sing the song",
                "play a track",
                "hum that tune",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    }
});

describe("Grammar Optimizer - Shared single-alternative rule is not inlined", () => {
    // <Inner> has a single alternative AND is referenced from multiple
    // call sites.  Inlining it would duplicate "the song" at every call
    // site in the serialized JSON; the optimizer must refuse based on
    // the input reference count.
    const text = `<Start> = <Use1> | <Use2> | <Use3>;
<Use1> = sing $(x:<Inner>) -> x;
<Use2> = play $(x:<Inner>) -> x;
<Use3> = hum $(x:<Inner>) -> x;
<Inner> = the song -> "song";`;

    function innerRulesArrays(
        grammar: ReturnType<typeof loadGrammarRules>,
    ): GrammarRule[][] {
        return findAllRulesParts(grammar.rules)
            .filter(
                (p) =>
                    p.rules.length === 1 &&
                    p.rules[0].parts.length === 1 &&
                    p.rules[0].parts[0].type === "string" &&
                    (p.rules[0].parts[0] as any).value.join(" ") === "the song",
            )
            .map((p) => p.rules);
    }

    it("inliner preserves shared <Inner> array identity", () => {
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        const arrays = innerRulesArrays(optimized);
        expect(arrays.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < arrays.length; i++) {
            expect(arrays[i]).toBe(arrays[0]);
        }
    });

    it("serialized output dedupes shared single-alt <Inner> rule", () => {
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        const json = grammarToJson(optimized);
        // Exactly one GrammarRulesJson entry should hold the "the song"
        // body (the shared <Inner>).
        const entries = json.filter(
            (entry) =>
                Array.isArray(entry) &&
                entry.length === 1 &&
                entry[0].parts?.length === 1 &&
                entry[0].parts[0].type === "string" &&
                (entry[0].parts[0] as any).value.join(" ") === "the song",
        );
        expect(entries.length).toBe(1);
    });

    it("still inlines a single-alternative rule referenced only once", () => {
        const single = `<Start> = sing $(x:<Inner>) -> x;
<Inner> = the song -> "song";`;
        const baseline = loadGrammarRules("t.grammar", single);
        const optimized = loadGrammarRules("t.grammar", single, {
            optimizations: { inlineSingleAlternatives: true },
        });
        // The single reference should be inlined → fewer RulesParts.
        const baseCount = findAllRulesParts(baseline.rules).length;
        const optCount = findAllRulesParts(optimized.rules).length;
        expect(optCount).toBeLessThan(baseCount);
    });

    it("match results unchanged for shared single-alt <Inner>", () => {
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { inlineSingleAlternatives: true },
        });
        for (const input of [
            "sing the song",
            "play the song",
            "hum the song",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
