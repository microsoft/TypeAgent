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
import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
} from "../src/grammarTypes.js";

function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    const seen = new Set<unknown>();
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type !== "rules") continue;
            out.push(p);
            if (seen.has(p.alternatives)) continue;
            seen.add(p.alternatives);
            for (const r of p.alternatives) visit(r.parts);
        }
    };
    for (const r of rules) visit(r.parts);
    return out;
}

/**
 * Like `findAllRulesParts` but also walks the grammar-level dispatch
 * buckets - needed when the optimizer's dispatch pass hoists the
 * top-level alternation onto `grammar.dispatch`, leaving
 * `grammar.alternatives` (the fallback subset) empty or trimmed.
 */
function findAllRulesPartsInGrammar(grammar: Grammar): RulesPart[] {
    const out = findAllRulesParts(grammar.alternatives);
    if (grammar.dispatch !== undefined) {
        const seen = new Set<unknown>();
        for (const m of grammar.dispatch) {
            for (const bucket of m.tokenMap.values()) {
                if (seen.has(bucket)) continue;
                seen.add(bucket);
                for (const inner of findAllRulesParts(bucket)) out.push(inner);
            }
        }
    }
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
        const rps = findAllRulesParts(grammar.alternatives);
        // Find every RulesPart whose body matches the <Common> shape.
        return rps
            .filter((p) =>
                p.alternatives.every(
                    (r) =>
                        r.parts.length === 1 &&
                        r.parts[0].type === "string" &&
                        ["the song", "a track", "that tune"].some(
                            (s) => (r.parts[0] as any).value.join(" ") === s,
                        ),
                ),
            )
            .map((p) => p.alternatives);
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
                json.rules.filter(
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
        return findAllRulesParts(grammar.alternatives)
            .filter(
                (p) =>
                    p.alternatives.length === 1 &&
                    p.alternatives[0].parts.length === 1 &&
                    p.alternatives[0].parts[0].type === "string" &&
                    (p.alternatives[0].parts[0] as any).value.join(" ") ===
                        "the song",
            )
            .map((p) => p.alternatives);
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
        const entries = json.rules.filter(
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
        const baseCount = findAllRulesParts(baseline.alternatives).length;
        const optCount = findAllRulesParts(optimized.alternatives).length;
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
describe("Grammar Optimizer - Shared rule identity preserved through dispatch", () => {
    // <Common> has dispatch-eligible alternatives (each starts with a
    // distinct first token) and is referenced from three call sites.
    // Without the dispatch-pass memo, each call site would
    // independently produce a fresh trimmed-fallback array and a fresh
    // DispatchModeBucket[], breaking the serializer's identity dedup.
    const text = `<Start> = <Use1> | <Use2> | <Use3>;
<Use1> = sing $(name:<Common>);
<Use2> = play $(name:<Common>);
<Use3> = hum $(name:<Common>);
<Common> = alpha song -> "a" | beta track -> "b" | gamma tune -> "g";`;

    function commonRulesParts(
        grammar: ReturnType<typeof loadGrammarRules>,
    ): RulesPart[] {
        // Every RulesPart that resolved to the named <Common> rule.
        // Filtering by `name` (set by the compiler when binding a
        // `<Name>` reference) avoids accidentally including unrelated
        // RulesParts whose first alternative happens to share a token.
        // Walks `grammar.dispatch` buckets too so the helper still
        // finds <Common> references when the dispatch pass has
        // hoisted the top-level alternation.
        return findAllRulesPartsInGrammar(grammar).filter(
            (p) => p.name === "Common",
        );
    }

    it("dispatch pass preserves shared <Common> array identity", () => {
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const parts = commonRulesParts(optimized);
        expect(parts.length).toBeGreaterThanOrEqual(3);
        // After dispatch, every wrapper sharing the same input
        // <Common> body must still share `alternatives` identity (the
        // trimmed fallback subset, possibly the EMPTY_FALLBACK_RULES
        // sentinel) AND `dispatch` identity.
        for (let i = 1; i < parts.length; i++) {
            expect(parts[i].alternatives).toBe(parts[0].alternatives);
            expect(parts[i].dispatch).toBe(parts[0].dispatch);
        }
    });

    it("dispatch+inline+factor preserves shared <Common> identity", () => {
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                dispatchifyAlternations: true,
            },
        });
        const parts = commonRulesParts(optimized);
        expect(parts.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < parts.length; i++) {
            expect(parts[i].alternatives).toBe(parts[0].alternatives);
            expect(parts[i].dispatch).toBe(parts[0].dispatch);
        }
    });

    it("match results unchanged through dispatch", () => {
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        for (const input of [
            "sing alpha song",
            "play beta track",
            "hum gamma tune",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});

describe("Grammar Optimizer - Shared rule identity preserved through factoring", () => {
    // <Common> has alternatives sharing a common token prefix and an
    // explicit value expression on each member, so factorRules
    // actually rewrites the array (rather than bailing out via
    // no-value-implicit-default).  Referenced from three call sites
    // to exercise the per-input-identity factor memo.
    const text = `<Start> = <Use1> | <Use2> | <Use3>;
<Use1> = sing $(name:<Common>);
<Use2> = play $(name:<Common>);
<Use3> = hum $(name:<Common>);
<Common> = play song -> "ps" | play album -> "pa" | play list -> "pl";`;

    function commonRulesParts(
        grammar: ReturnType<typeof loadGrammarRules>,
    ): RulesPart[] {
        // Filter by RulesPart `name` to pick out exactly the
        // <Common>-bound references and avoid sweeping in unrelated
        // RulesParts (e.g. <Use2> whose first token also happens to
        // be "play").
        return findAllRulesParts(grammar.alternatives).filter(
            (p) => p.name === "Common",
        );
    }

    it("factor pass preserves shared <Common> array identity", () => {
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const parts = commonRulesParts(optimized);
        expect(parts.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < parts.length; i++) {
            expect(parts[i].alternatives).toBe(parts[0].alternatives);
        }
    });

    it("match results unchanged through factoring", () => {
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "sing play song",
            "play play album",
            "hum play list",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
