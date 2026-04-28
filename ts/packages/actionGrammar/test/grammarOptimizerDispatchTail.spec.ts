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
import { validateTailRulesParts } from "../src/grammarOptimizer.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { Grammar, GrammarRule, RulesPart } from "../src/grammarTypes.js";
import { getDispatchEffectiveMembers } from "../src/dispatchHelpers.js";
import {
    DispatchedRulesPart,
    findAllDispatchParts,
    match,
} from "./dispatchTestHelpers.js";

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
            const tailDispatches = findAllDispatchParts(optimized).filter(
                (dp) => dp.tailCall,
            );
            expect(tailDispatches.length).toBeGreaterThanOrEqual(1);
            for (const dp of tailDispatches) {
                expect(dp.variable).toBeUndefined();
                expect(dp.optional).toBeFalsy();
                expect(dp.repeat).toBeFalsy();
                const effective = getDispatchEffectiveMembers(dp).length;
                expect(effective).toBeGreaterThanOrEqual(2);
            }
            // The `by` / `from` suffix split should produce a
            // dispatch with both keys present.
            const keys = new Set<string>();
            for (const dp of tailDispatches) {
                for (const m of dp.dispatch) {
                    for (const k of m.tokenMap.keys()) keys.add(k);
                }
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
            const tailDispatches = findAllDispatchParts(roundTripped).filter(
                (dp) => dp.tailCall,
            );
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
            const dispatch: RulesPart = {
                type: "rules",
                alternatives: [],
                dispatch: [
                    {
                        spacingMode: undefined,
                        tokenMap: new Map([
                            ["alpha", [memberA]],
                            ["beta", [memberB]],
                        ]),
                    },
                ],
                tailCall: true,
            };
            const rule: GrammarRule = { parts: [dispatch] };
            return { alternatives: [rule] };
        }

        it("accepts a well-formed tail DispatchPart", () => {
            expect(() =>
                validateTailRulesParts(buildBaseline().alternatives),
            ).not.toThrow();
        });

        it("rejects when not the last part of the parent rule", () => {
            const g = buildBaseline();
            g.alternatives[0].parts.push({
                type: "string",
                value: ["trailer"],
            });
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /must be the last part/,
            );
        });

        it("rejects when the parent rule has its own value", () => {
            const g = buildBaseline();
            g.alternatives[0].value = { type: "literal", value: "x" };
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /no value of its own/,
            );
        });

        it("rejects when repeat is set", () => {
            const g = buildBaseline();
            (g.alternatives[0].parts[0] as DispatchedRulesPart).repeat = true;
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when optional is set", () => {
            const g = buildBaseline();
            (g.alternatives[0].parts[0] as DispatchedRulesPart).optional = true;
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when variable is set", () => {
            const g = buildBaseline();
            (g.alternatives[0].parts[0] as DispatchedRulesPart).variable = "x";
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /repeat\/optional\/variable are forbidden/,
            );
        });

        it("rejects when effective member count < 2", () => {
            const g = buildBaseline();
            const dp = g.alternatives[0].parts[0] as DispatchedRulesPart;
            // Drop one of the two buckets, leaving a single member.
            const tm = dp.dispatch[0].tokenMap;
            dp.dispatch[0] = {
                spacingMode: dp.dispatch[0].spacingMode,
                tokenMap: new Map([["alpha", tm.get("alpha")!]]),
            };
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /effective member count >= 2/,
            );
        });

        it("rejects when a member's spacingMode disagrees with the parent's", () => {
            const g = buildBaseline();
            const dp = g.alternatives[0].parts[0] as DispatchedRulesPart;
            dp.dispatch[0].tokenMap.get("alpha")![0].spacingMode = "required";
            expect(() => validateTailRulesParts(g.alternatives)).toThrow(
                /spacingMode must match/,
            );
        });
    });

    describe("matcher: tail dispatch with single-rule effective list", () => {
        // Regression for a crash in tryNextBacktrack ("Cannot read
        // properties of undefined (reading 'parts')").  The non-tail
        // entry helper `enterRulesAlternation` had a `rules.length
        // > 1` guard around `pushAlternation`; the tail entry helper
        // `enterTailAlternation` was missing it.  When a tail
        // DispatchPart's effective hits+fallback list (the slice
        // built from the peeked bucket plus fallback in
        // `enterDispatchPart`) reduces to a single rule, the tail
        // entry pushed an alternation cursor frame at cursor=1 and
        // the first backtrack read `rules[1]` (undefined).
        //
        // Validation accepts the dispatch (it requires effective
        // member count >= 2 across ALL buckets + fallback, not per
        // bucket), but at runtime peek lands in one bucket whose
        // sole rule, with no fallback, becomes the only effective
        // member.

        // Three suffixes after a shared `head` prefix, each with a
        // distinct first token.  Tail factoring lifts the
        // alternation into tail position; dispatch produces three
        // single-rule buckets ({a:[r1], b:[r2], c:[r3]}, no
        // fallback).  Inputs land in any of the single-rule buckets.
        const TAIL_SINGLE_BUCKET_GRAMMAR = `<Start> = head a alpha -> "a"
                              | head b beta gamma -> "b"
                              | head c -> "c";`;

        it("matches single-bucket inputs without crashing (regression)", () => {
            const optimized = loadGrammarRules(
                "t.grammar",
                TAIL_SINGLE_BUCKET_GRAMMAR,
                {
                    optimizations: {
                        factorCommonPrefixes: true,
                        tailFactoring: true,
                        dispatchifyAlternations: true,
                    },
                },
            );
            // Confirm the dispatch is tail-call and every bucket
            // has exactly one rule with no fallback - the shape
            // that triggered the original crash.
            const tailDispatches = findAllDispatchParts(optimized).filter(
                (dp) => dp.tailCall,
            );
            expect(tailDispatches.length).toBeGreaterThanOrEqual(1);
            const tail = tailDispatches[0];
            expect(tail.alternatives ?? []).toHaveLength(0);
            for (const m of tail.dispatch) {
                for (const bucket of m.tokenMap.values()) {
                    expect(bucket).toHaveLength(1);
                }
            }

            const baseline = loadGrammarRules(
                "t.grammar",
                TAIL_SINGLE_BUCKET_GRAMMAR,
            );
            for (const input of [
                "head a alpha",
                "head b beta gamma",
                "head c",
                "head a", // suffix mismatch under bucket "a"
                "head b beta", // suffix mismatch under bucket "b"
                "head x", // peek miss - no bucket, no fallback
                "head", // partial - no following token to peek
                "noise", // doesn't match outer prefix
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });

        it("matches when a single-rule bucket sits next to a multi-rule bucket and a fallback", () => {
            // Asymmetric shape exercising the same tail entry: one
            // bucket has multiple rules, another has exactly one,
            // and a wildcard rule lands in fallback.
            const text = `<Start> = head a alpha -> "a1"
                                  | head a alpha2 -> "a2"
                                  | head b beta -> "b"
                                  | head $(rest:string) -> { other: rest };`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: {
                    factorCommonPrefixes: true,
                    tailFactoring: true,
                    dispatchifyAlternations: true,
                },
            });
            for (const input of [
                "head a alpha",
                "head a alpha2",
                "head b beta",
                "head c something", // fallback (wildcard) path
                "head b xyz", // bucket "b" miss → fallback
            ]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });
});
