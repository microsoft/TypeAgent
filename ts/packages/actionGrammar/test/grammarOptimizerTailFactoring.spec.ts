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
                if (!visited.has(p.rules)) {
                    visited.add(p.rules);
                    for (const r of p.rules) visit(r.parts);
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
        const tailParts = findAllRulesParts(optimized.rules).filter(
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

        const tailParts = findAllRulesParts(optimized.rules).filter(
            (rp) => rp.tailCall,
        );
        expect(tailParts.length).toBeGreaterThanOrEqual(1);
        for (const tp of tailParts) {
            expect(tp.variable).toBeUndefined();
            expect(tp.optional).toBeFalsy();
            expect(tp.repeat).toBeFalsy();
            expect(tp.rules.length).toBeGreaterThanOrEqual(2);
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
        const tailParts = findAllRulesParts(optimized.rules).filter(
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

        const reloadedTailParts = findAllRulesParts(reloaded.rules).filter(
            (rp) => rp.tailCall,
        );
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
        expect(optimized.rules.length).toBe(1);
        const tailParts = findAllRulesParts(optimized.rules).filter(
            (rp) => rp.tailCall,
        );
        // Exactly one tail wrapper at this fork.
        expect(tailParts.length).toBe(1);
        // The single tail wrapper holds all three original alternatives.
        expect(tailParts[0].rules.length).toBe(3);
        // The wrapper rule itself ends in the tail RulesPart (last
        // part), per `RulesPart.tailCall` contract.
        const wrapper = optimized.rules[0];
        expect(wrapper.parts[wrapper.parts.length - 1]).toBe(tailParts[0]);
        expect(wrapper.parts.length).toBeGreaterThan(1); // prefix exists
        // Validator should accept the factored AST.
        expect(() => validateTailRulesParts(optimized.rules)).not.toThrow();

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
                        const inner = recur(p.rules);
                        if (inner) return inner;
                    }
                }
                return undefined;
            };
            return recur(rules);
        };
        const found = findTail(baseline.rules);
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
        expect(() => validateTailRulesParts(optimized.rules)).not.toThrow();
    });

    it("rejects single-member tail RulesPart", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.rules = [tail.rules[0]];
        });
        expect(() => validateTailRulesParts(bad.rules)).toThrow(
            /rules\.length >= 2/,
        );
    });

    it("rejects tail RulesPart with variable", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.variable = "x";
        });
        expect(() => validateTailRulesParts(bad.rules)).toThrow(
            /repeat\/optional\/variable/,
        );
    });

    it("rejects tail RulesPart not at the end of parent's parts", () => {
        const bad = buildBadGrammar((rule, _tail) => {
            // Append a sentinel string part so the tail is no longer
            // last.
            rule.parts.push({ type: "string", value: ["xyz"] });
        });
        expect(() => validateTailRulesParts(bad.rules)).toThrow(
            /must be the last part/,
        );
    });

    it("rejects tail RulesPart when parent has its own value", () => {
        const bad = buildBadGrammar((rule, _tail) => {
            rule.value = { type: "literal", value: "fixed" };
        });
        expect(() => validateTailRulesParts(bad.rules)).toThrow(
            /no value of its own/,
        );
    });

    it("rejects tail RulesPart with mismatched member spacingMode", () => {
        const bad = buildBadGrammar((_rule, tail) => {
            tail.rules = tail.rules.map((m, i) =>
                i === 0 ? { ...m, spacingMode: "required" as const } : m,
            );
        });
        expect(() => validateTailRulesParts(bad.rules)).toThrow(
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
        for (const ruleSet of json) {
            for (const rule of ruleSet) {
                for (const p of rule.parts) {
                    if (p.type === "rules" && p.tailCall) {
                        // Force the referenced rules array to have
                        // length 1 by replacing the index target with
                        // a single-rule array.
                        json[p.index] = [json[p.index][0]];
                    }
                }
            }
        }
        // Permissive (validate: false) load still works (cached path),
        // but the default load throws.
        expect(() => grammarFromJson(json, { validate: false })).not.toThrow();
        expect(() => grammarFromJson(json)).toThrow(/rules\.length >= 2/);
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
