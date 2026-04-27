// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { grammarFromJson } from "../src/grammarDeserializer.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { validateTailRulesParts } from "../src/grammarOptimizer.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
} from "../src/grammarTypes.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    const visited = new WeakSet<GrammarRule[]>();
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                out.push(p);
                if (!visited.has(p.alternatives)) {
                    visited.add(p.alternatives);
                    for (const r of p.alternatives) visit(r.parts);
                }
            }
        }
    };
    for (const r of rules) visit(r.parts);
    return out;
}

const PLAYER_SCHEMA = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;

describe("Grammar Optimizer - tail RulesPart factoring (opt-in)", () => {
    // Without the opt-in, the cross-scope-ref bailout still fires and
    // no tail RulesPart is emitted - matcher results stay correct.
    it("does not emit tail wrappers without the tailFactoring flag", () => {
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: { factorCommonPrefixes: true },
        });
        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
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
        const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA);
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });

        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);
        for (const tp of tailParts) {
            expect(tp.variable).toBeUndefined();
            expect(tp.optional).toBeFalsy();
            expect(tp.repeat).toBeFalsy();
            expect(tp.alternatives.length).toBeGreaterThanOrEqual(2);
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

    // Force a cross-scope-ref scenario: every member's value-expr
    // references a prefix-bound canonical (`prefix`).  Without
    // tailFactoring this fork bails out (cross-scope-ref); with
    // tailFactoring we emit a tail wrapper and the matcher must
    // backtrack correctly between sibling tail alts when the live
    // alternative consumes input but eventually fails.
    it("backtracks across tail siblings when prefix is referenced", () => {
        const text = `<Start> = pre $(prefix:string) a $(v:string) -> { branch: "a", prefix, v }
       | pre $(prefix:string) b $(v:string) -> { branch: "b", prefix, v };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);
        for (const input of ["pre hello a world", "pre hello b world"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Round-trip serialization: a tail-factored grammar must survive
    // grammarToJson → grammarFromJson without losing the tailCall
    // flag, and the deserialized form must match identically to the
    // baseline.
    it("round-trips tail RulesPart through grammarToJson / grammarFromJson", () => {
        const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA);
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const json = grammarToJson(optimized);
        const reloaded = grammarFromJson(json);

        const reloadedTailParts = findAllRulesParts(
            reloaded.alternatives,
        ).filter((rp) => rp.tailCall);
        expect(reloadedTailParts.length).toBeGreaterThanOrEqual(1);

        for (const input of [
            "play hello by alice",
            "play the world by bob",
            "play hello from album unity",
        ]) {
            expect(match(reloaded, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Behavior-equivalence sweep: a representative set of inputs must
    // match identically against the optimized (tail-factored) and
    // unoptimized grammars.  Pins observable transparency of the
    // optimization for the playerSchema shape.
    it("baseline-equivalence sweep over representative inputs", () => {
        const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA);
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const inputs = [
            "play foo by bar",
            "play the foo by bar",
            "play foo from album bar",
            "play the foo from album bar",
            // Negative inputs - both should reject.
            "play",
            "play foo",
            "play foo by",
            "stop foo by bar",
            "playby",
            "play foo by bar from album baz",
        ];
        for (const input of inputs) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Strengthened from a `tailParts.length >= 1` smoke check to
    // assert the exact factored shape: three input alternatives
    // sharing a `a $(p:string)` prefix collapse into a SINGLE tail
    // wrapper whose prefix is the shared parts and whose suffix
    // RulesPart has one member per original alt.  A regression that
    // failed to factor (or that emitted multiple wrappers per fork)
    // would change either count.
    it("collapses three prefix-sharing alts into a single tail wrapper", () => {
        const text = `<Start> = a $(p:string) b $(q:string) -> { v: "ab", p, q }
       | a $(p:string) c $(q:string) -> { v: "ac", p, q }
       | a $(p:string) d $(q:string) -> { v: "ad", p, q };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        // Top-level: one wrapper rule (was three before factoring).
        expect(optimized.alternatives.length).toBe(1);
        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
        );
        // Exactly one tail wrapper at this fork.
        expect(tailParts.length).toBe(1);
        // The single tail wrapper holds all three original alternatives.
        expect(tailParts[0].alternatives.length).toBe(3);
        // The wrapper rule itself ends in the tail RulesPart (last
        // part), per `RulesPart.tailCall` contract.
        const wrapper = optimized.alternatives[0];
        expect(wrapper.parts[wrapper.parts.length - 1]).toBe(tailParts[0]);
        expect(wrapper.parts.length).toBeGreaterThan(1); // prefix exists
        // Validator should accept the factored AST.
        expect(() =>
            validateTailRulesParts(optimized.alternatives),
        ).not.toThrow();

        for (const input of [
            "a x b y",
            "a x c y",
            "a x d y",
            "a x e y", // negative
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});

describe("validateTailRulesParts", () => {
    function buildBadGrammar(
        mutate: (rule: GrammarRule, tail: RulesPart) => void,
    ): Grammar {
        const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        // Find any tail RulesPart and its parent rule, then apply the
        // caller's mutation.
        const findTail = (
            rules: GrammarRule[],
        ): { rule: GrammarRule; part: RulesPart } | undefined => {
            const visited = new WeakSet<GrammarRule[]>();
            const recur = (
                rs: GrammarRule[],
            ): { rule: GrammarRule; part: RulesPart } | undefined => {
                if (visited.has(rs)) return undefined;
                visited.add(rs);
                for (const r of rs) {
                    for (const p of r.parts) {
                        if (p.type !== "rules") continue;
                        if (p.tailCall) return { rule: r, part: p };
                        const inner = recur(p.alternatives);
                        if (inner) return inner;
                    }
                }
                return undefined;
            };
            return recur(rules);
        };
        const found = findTail(baseline.alternatives);
        if (!found) throw new Error("test setup: no tail RulesPart found");
        mutate(found.rule, found.part);
        return baseline;
    }

    it("accepts a well-formed tail-factored grammar", () => {
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        expect(() =>
            validateTailRulesParts(optimized.alternatives),
        ).not.toThrow();
    });

    it("rejects single-member tail RulesPart", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.alternatives = [tail.alternatives[0]];
        });
        expect(() => validateTailRulesParts(bad.alternatives)).toThrow(
            /effective member count >= 2/,
        );
    });

    it("rejects tail RulesPart with variable", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.variable = "x";
        });
        expect(() => validateTailRulesParts(bad.alternatives)).toThrow(
            /repeat\/optional\/variable/,
        );
    });

    it("rejects tail RulesPart not at the end of parent's parts", () => {
        const bad = buildBadGrammar((rule, _tail) => {
            // Append a sentinel string part so the tail is no longer
            // last.
            rule.parts.push({ type: "string", value: ["xyz"] });
        });
        expect(() => validateTailRulesParts(bad.alternatives)).toThrow(
            /must be the last part/,
        );
    });

    it("rejects tail RulesPart when parent has its own value", () => {
        const bad = buildBadGrammar((rule, _tail) => {
            rule.value = { type: "literal", value: "fixed" };
        });
        expect(() => validateTailRulesParts(bad.alternatives)).toThrow(
            /no value of its own/,
        );
    });

    it("rejects tail RulesPart with mismatched member spacingMode", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.alternatives = tail.alternatives.map((m, i) =>
                i === 0 ? { ...m, spacingMode: "required" as const } : m,
            );
        });
        expect(() => validateTailRulesParts(bad.alternatives)).toThrow(
            /spacingMode must match/,
        );
    });

    // grammarFromJsonValidated should surface the validation error
    // at load time rather than at match time.
    it("grammarFromJsonValidated catches a malformed tail in cached JSON", () => {
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const json = grammarToJson(optimized);
        // Mutate the JSON to break the >=2 invariant.
        for (const ruleSet of json.rules) {
            for (const rule of ruleSet) {
                for (const p of rule.parts) {
                    if (p.type === "rules" && p.tailCall) {
                        // Force the referenced rules array to have
                        // length 1 by replacing the index target with
                        // a single-rule array.
                        json.rules[p.index] = [json.rules[p.index][0]];
                    }
                }
            }
        }
        // Permissive (validate: false) load still works (cached path),
        // but the default load throws.
        expect(() => grammarFromJson(json, { validate: false })).not.toThrow();
        expect(() => grammarFromJson(json)).toThrow(
            /effective member count >= 2/,
        );
    });
});

describe("Grammar Optimizer - tailFactoring + NFA compatibility", () => {
    // The NFA compiler refuses tail RulesParts.  Verify that a
    // tail-factored grammar fed to the NFA path produces a clear
    // error rather than silent miscompilation.  Loaded lazily so
    // tests above don't pull in the NFA module unnecessarily.
    it("NFA compile of a tail-factored grammar throws a descriptive error", async () => {
        const { compileGrammarToNFA } = await import("../src/nfaCompiler.js");
        const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        expect(() => compileGrammarToNFA(optimized)).toThrow(
            /tail RulesParts are not supported by the NFA compiler/,
        );
    });
});

describe("Grammar Optimizer - tail-call spacing regression", () => {
    // Regression: fuzz-found bug 178.
    // A grammar with [spacing=none] on the top-level rule has
    // alternatives starting with $(n:number).  After prefix-factoring
    // with tailFactoring, the factored rule's first number part is
    // shared and the suffix alternatives are in a tail-call RulesPart.
    // The matcher's leadingSpacingMode must respect the wrapper rule's
    // spacing=none for the suffix's first part; otherwise the number
    // regex consumes a leading space and produces a spurious match.
    it("preserves spacing=none across tail-call boundary (fuzz #178)", () => {
        const text = `<Start> = <R0>;
<R0> [spacing=none] = $(n10:number) $(n11:number) d -> n11 | $(v12:string) $(v13:string) $(v14:string) $(n15:number) | [spacing=auto]$(v16:string) $(v17:string) <R3> $(n18:number) -> v17 | $(n19:number) $(n20:number) -> [n19, n20];
<R1> = $(v9:string) -> \`hello \${v9}\` | <R2> | <R3> | <R2>;
<R2> = [spacing=none]e $(v8:string) | [spacing=none]<R3>;
<R3> = d $(v0:string) $(n1:number) $(n2:number) -> n2 | d $(v3:string) $(v4:string) -> { actionName: "act", parameters: { v3, v4 } } | a | [spacing=none]$(n5:number) $(v6:string) $(n7:number);`;
        const opts = {
            startValueRequired: false,
            enableValueExpressions: true,
        };
        const baseline = loadGrammarRules("t.grammar", text, opts);
        const optimized = loadGrammarRules("t.grammar", text, {
            ...opts,
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        // "21 22" must NOT match: spacing=none forbids the space
        // between the two numbers.
        expect(match(optimized, "21 22")).toStrictEqual(
            match(baseline, "21 22"),
        );
        expect(match(optimized, "21 22")).toStrictEqual([]);
    });

    // Minimal reproducer: two number-leading alternatives with
    // spacing=none that share a common prefix and get tail-factored.
    it("spacing=none blocks separator in minimal tail-factored grammar", () => {
        const text = `<Start> = <R>;
<R> [spacing=none] = $(a:number) $(b:number) -> [a, b]
                   | $(a:number) d -> a;`;
        const opts = {
            startValueRequired: false,
            enableValueExpressions: true,
        };
        const baseline = loadGrammarRules("t.grammar", text, opts);
        const optimized = loadGrammarRules("t.grammar", text, {
            ...opts,
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        // With spacing=none, "1 2" should not match (space disallowed).
        expect(match(optimized, "1 2")).toStrictEqual(match(baseline, "1 2"));
        expect(match(optimized, "1 2")).toStrictEqual([]);
        // "12" should match the first alt (two single-digit numbers
        // directly adjacent).
        expect(match(optimized, "12")).toStrictEqual(match(baseline, "12"));
        // "1d" should match the second alt.
        expect(match(optimized, "1d")).toStrictEqual(match(baseline, "1d"));
        expect(match(optimized, "1d")).toStrictEqual([1]);
    });
});

describe("leadingSpacingMode propagation through tail-call entries", () => {
    // Mixed spacing modes: outer rule enforces spacing=required while
    // the inner rule uses spacing=none. After tail-factoring, the
    // boundary between outer and inner content must use the outer mode,
    // while boundaries within the tail alternatives use the inner mode.
    it("parent required, tail-factored child none: outer boundary enforced", () => {
        const text = `<R> [spacing=none] = $(a:number) $(b:number) -> [a, b]
                       | $(a:number) d -> a;
<Start> [spacing=required] = do $(r:<R>) -> r;`;
        const opts = {
            startValueRequired: false,
            enableValueExpressions: true,
        };
        const baseline = loadGrammarRules("t.grammar", text, opts);
        const optimized = loadGrammarRules("t.grammar", text, {
            ...opts,
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);

        // Space between "do" and first number: Start's required mode.
        // No space between numbers/literals: R's none mode.
        expect(match(optimized, "do 12")).toStrictEqual(
            match(baseline, "do 12"),
        );
        expect(match(optimized, "do 1d")).toStrictEqual(
            match(baseline, "do 1d"),
        );
        // Space within R's none-mode region is forbidden.
        expect(match(optimized, "do 1 2")).toStrictEqual(
            match(baseline, "do 1 2"),
        );
        expect(match(optimized, "do 1 2")).toStrictEqual([]);
        // Missing space before R: Start's required mode rejects.
        expect(match(optimized, "do12")).toStrictEqual(match(baseline, "do12"));
        expect(match(optimized, "do12")).toStrictEqual([]);
    });

    // Reverse: parent optional, tail-factored child required.
    // The boundary before the child's first part uses the parent's
    // optional mode, but internal boundaries use the child's required.
    it("parent optional, tail-factored child required: inner boundary enforced", () => {
        const text = `<R> [spacing=required] = $(a:number) $(b:number) -> [a, b]
                       | $(a:number) d -> a;
<Start> [spacing=optional] = do $(r:<R>) -> r;`;
        const opts = {
            startValueRequired: false,
            enableValueExpressions: true,
        };
        const baseline = loadGrammarRules("t.grammar", text, opts);
        const optimized = loadGrammarRules("t.grammar", text, {
            ...opts,
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        });
        const tailParts = findAllRulesParts(optimized.alternatives).filter(
            (rp) => rp.tailCall,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);

        // No space before R: Start's optional allows adjacency.
        expect(match(optimized, "do1 2")).toStrictEqual(
            match(baseline, "do1 2"),
        );
        // With space before R: also fine.
        expect(match(optimized, "do 1 2")).toStrictEqual(
            match(baseline, "do 1 2"),
        );
        // No space within R: R's required mode rejects.
        expect(match(optimized, "do12")).toStrictEqual(match(baseline, "do12"));
        expect(match(optimized, "do12")).toStrictEqual([]);
    });

    // Directly exercise the latent bug scenario: a single-part
    // tail-call wrapper (no prefix before the tailCall RulesPart).
    // This shape is valid per validateTailRulesParts but cannot be
    // produced by the current optimizer. Constructed via JSON.
    //
    // Grammar:
    //   Start [required]: "do" $(x:<Wrapper>) "end" -> x
    //   Wrapper [none]: [tailCall: ("bar" -> "b") | ("baz" -> "z")]
    //
    // Without the leadingSpacingMode fix, the old tailCallEntry
    // flag would use the wrapper's "none" mode for the leading
    // separator, incorrectly allowing "dobar end" to match.
    it("single-part tail-call wrapper propagates ancestor leadingSpacingMode", () => {
        const json: any = {
            rules: [
                // Start rules
                [
                    {
                        parts: [
                            { type: "string", value: ["do"] },
                            { type: "rules", index: 1, variable: "x" },
                            { type: "string", value: ["end"] },
                        ],
                        value: { type: "variable", name: "x" },
                        spacingMode: "required",
                    },
                ],
                // Wrapper: single-part, just the tailCall RulesPart
                [
                    {
                        parts: [{ type: "rules", index: 2, tailCall: true }],
                        spacingMode: "none",
                    },
                ],
                // Tail members
                [
                    {
                        parts: [{ type: "string", value: ["bar"] }],
                        value: { type: "literal", value: "b" },
                        spacingMode: "none",
                    },
                    {
                        parts: [{ type: "string", value: ["baz"] }],
                        value: { type: "literal", value: "z" },
                        spacingMode: "none",
                    },
                ],
            ],
        };
        const grammar = grammarFromJson(json);

        // Start's required mode governs the boundary before and after.
        expect(match(grammar, "do bar end")).toStrictEqual(["b"]);
        expect(match(grammar, "do baz end")).toStrictEqual(["z"]);

        // The wrapper's none mode must NOT leak to the leading
        // boundary. Without the fix, these would incorrectly match.
        expect(match(grammar, "dobar end")).toStrictEqual([]);
        expect(match(grammar, "dobaz end")).toStrictEqual([]);
        expect(match(grammar, "do barend")).toStrictEqual([]);
    });
});
