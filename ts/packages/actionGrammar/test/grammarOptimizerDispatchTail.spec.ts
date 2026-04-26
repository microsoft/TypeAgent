// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for `DispatchPart` carrying `tailCall: true`.  The tail
 * factorer emits `RulesPart.tailCall` wrappers around shared
 * prefixes; the dispatch pass now propagates that flag onto the
 * synthesized `DispatchPart`, so the matcher routes through
 * `enterTailAlternation` (no parent frame, inherits `valueIds`)
 * instead of the normal alternation entry.
 *
 * Coverage:
 *   - Tail factoring + dispatch combine to produce a tail dispatch.
 *   - Match results are identical to a baseline (factoring on,
 *     dispatch off), including for grammars whose member value
 *     expressions reference prefix-bound canonicals (the whole
 *     point of tail entry).
 *   - JSON round-trip preserves `tailCall` on dispatch.
 *   - `validateTailRulesParts` rejects DispatchParts that violate
 *     each clause of the contract.
 */

import { grammarFromJson } from "../src/grammarDeserializer.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { validateTailRulesParts } from "../src/grammarOptimizer.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import {
    DispatchPart,
    Grammar,
    GrammarPart,
    GrammarRule,
} from "../src/grammarTypes.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request)
        .map((m) => JSON.stringify(m.match))
        .sort();
}

function findAllDispatchParts(rules: GrammarRule[]): DispatchPart[] {
    const out: DispatchPart[] = [];
    const visited = new WeakSet<GrammarRule[]>();
    const visitParts = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "dispatch") {
                out.push(p);
                for (const bucket of p.tokenMap.values()) {
                    if (!visited.has(bucket)) {
                        visited.add(bucket);
                        for (const r of bucket) visitParts(r.parts);
                    }
                }
                if (p.fallback !== undefined && !visited.has(p.fallback)) {
                    visited.add(p.fallback);
                    for (const r of p.fallback) visitParts(r.parts);
                }
            } else if (p.type === "rules") {
                if (!visited.has(p.rules)) {
                    visited.add(p.rules);
                    for (const r of p.rules) visitParts(r.parts);
                }
            }
        }
    };
    for (const r of rules) visitParts(r.parts);
    return out;
}

// Motivating shape: shared `play <Inner> ...` prefix on two
// alternatives whose suffixes start with distinct first tokens
// (`by` / `from`).  Tail factoring lifts the suffix into a tail
// RulesPart; dispatchifyAlternations then converts that tail into a
// tail DispatchPart bucketed on `by` / `from`.  Each suffix's
// value expression references the prefix-bound `trackName` - this
// only resolves correctly under tail entry (which inherits
// `valueIds`).
const PLAYER_SCHEMA = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;

describe("Grammar Optimizer - DispatchPart with tailCall", () => {
    describe("optimizer integration", () => {
        it("emits a tail DispatchPart for the player-shaped grammar", () => {
            const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                    dispatchifyAlternations: true,
                },
            });
            const tailDispatches = findAllDispatchParts(optimized.rules).filter(
                (dp) => dp.tailCall,
            );
            expect(tailDispatches.length).toBeGreaterThanOrEqual(1);
            for (const dp of tailDispatches) {
                expect(dp.variable).toBeUndefined();
                expect(dp.optional).toBeFalsy();
                expect(dp.repeat).toBeFalsy();
                const effective =
                    Array.from(dp.tokenMap.values()).reduce(
                        (n, b) => n + b.length,
                        0,
                    ) + (dp.fallback?.length ?? 0);
                expect(effective).toBeGreaterThanOrEqual(2);
            }
            // The `by` / `from` suffix split should produce a
            // dispatch with both keys present.
            const keys = new Set<string>();
            for (const dp of tailDispatches) {
                for (const k of dp.tokenMap.keys()) keys.add(k);
            }
            expect(keys.has("by")).toBe(true);
            expect(keys.has("from")).toBe(true);
        });

        it("matches identically to the no-dispatch baseline (tailCall preserves valueIds)", () => {
            const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                },
            });
            const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                    dispatchifyAlternations: true,
                },
            });
            for (const input of [
                "play song by artist",
                "play the song by artist",
                "play song from album myalbum",
                "play the song from album myalbum",
                "play song",
                "noise",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });

        it("matches identically to the fully-unoptimized baseline", () => {
            const baseline = loadGrammarRules("t.grammar", PLAYER_SCHEMA);
            const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                    dispatchifyAlternations: true,
                },
            });
            for (const input of [
                "play song by artist",
                "play the song by artist",
                "play song from album myalbum",
                "play the song from album myalbum",
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });

    describe("JSON round-trip", () => {
        it("preserves tailCall on dispatch", () => {
            const optimized = loadGrammarRules("t.grammar", PLAYER_SCHEMA, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                    dispatchifyAlternations: true,
                },
            });
            const roundTripped = grammarFromJson(grammarToJson(optimized));
            const tailDispatches = findAllDispatchParts(
                roundTripped.rules,
            ).filter((dp) => dp.tailCall);
            expect(tailDispatches.length).toBeGreaterThanOrEqual(1);
            for (const input of [
                "play song by artist",
                "play the song from album x",
            ]) {
                expect(match(roundTripped, input)).toStrictEqual(
                    match(optimized, input),
                );
            }
        });
    });

    describe("validateTailRulesParts rejects contract violations", () => {
        // Build a minimal grammar with a single hand-constructed
        // tail DispatchPart.  Each test mutates one clause and
        // asserts the validator throws with a recognizable message.

        function buildBaseline(): Grammar {
            const memberA: GrammarRule = {
                parts: [{ type: "string", value: ["alpha"] }],
                value: { type: "literal", value: "a" },
            };
            const memberB: GrammarRule = {
                parts: [{ type: "string", value: ["beta"] }],
                value: { type: "literal", value: "b" },
            };
            const dispatch: DispatchPart = {
                type: "dispatch",
                tokenMap: new Map([
                    ["alpha", [memberA]],
                    ["beta", [memberB]],
                ]),
                tailCall: true,
            };
            const rule: GrammarRule = { parts: [dispatch] };
            return { rules: [rule] };
        }

        it("accepts a well-formed tail DispatchPart", () => {
            expect(() =>
                validateTailRulesParts(buildBaseline().rules),
            ).not.toThrow();
        });

        it("rejects when not the last part of the parent rule", () => {
            const g = buildBaseline();
            g.rules[0].parts.push({ type: "string", value: ["trailer"] });
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /must be the last part/,
            );
        });

        it("rejects when the parent rule has its own value", () => {
            const g = buildBaseline();
            g.rules[0].value = { type: "literal", value: "x" };
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /no value of its own/,
            );
        });

        it("rejects when repeat is set", () => {
            const g = buildBaseline();
            (g.rules[0].parts[0] as DispatchPart).repeat = true;
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when optional is set", () => {
            const g = buildBaseline();
            (g.rules[0].parts[0] as DispatchPart).optional = true;
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when variable is set", () => {
            const g = buildBaseline();
            (g.rules[0].parts[0] as DispatchPart).variable = "x";
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when effective member count < 2", () => {
            const g = buildBaseline();
            const dp = g.rules[0].parts[0] as DispatchPart;
            // Drop one of the two buckets, leaving a single member.
            dp.tokenMap = new Map([["alpha", dp.tokenMap.get("alpha")!]]);
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /effective member count >= 2/,
            );
        });

        it("rejects when a member's spacingMode disagrees with the parent's", () => {
            const g = buildBaseline();
            const dp = g.rules[0].parts[0] as DispatchPart;
            dp.tokenMap.get("alpha")![0].spacingMode = "required";
            expect(() => validateTailRulesParts(g.rules)).toThrow(
                /spacingMode must match/,
            );
        });
    });
});
