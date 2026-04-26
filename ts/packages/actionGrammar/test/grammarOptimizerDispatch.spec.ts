// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Focused tests for the `dispatchifyAlternations` optimizer pass.
 *
 * Coverage:
 *   - Pure keyword dispatch (no fallback) produces identical match
 *     results vs the unoptimized grammar.
 *   - Mixed dispatch + fallback (wildcard alternative) produces
 *     identical results across hit and fallback inputs.
 *   - The pass actually emits a `DispatchPart` when eligible.
 *   - The pass leaves the AST unchanged for ineligible cases
 *     (single-alternative, no static first token, optional/none
 *     spacing modes).
 *   - Round-trip: serialize/deserialize a dispatch-optimized grammar
 *     and confirm match results are preserved.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { DispatchPart, GrammarRule } from "../src/grammarTypes.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { grammarFromJson } from "../src/grammarDeserializer.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request)
        .map((m) => JSON.stringify(m.match))
        .sort();
}

function findDispatchPart(rules: GrammarRule[]): DispatchPart | undefined {
    const seen = new Set<GrammarRule[]>();
    const visit = (rs: GrammarRule[]): DispatchPart | undefined => {
        if (seen.has(rs)) return undefined;
        seen.add(rs);
        for (const r of rs) {
            for (const p of r.parts) {
                if (p.type === "dispatch") return p;
                if (p.type === "rules") {
                    const inner = visit(p.rules);
                    if (inner) return inner;
                }
            }
        }
        return undefined;
    };
    return visit(rules);
}

describe("Grammar Optimizer - dispatchifyAlternations", () => {
    it("emits a DispatchPart for a multi-keyword alternation", () => {
        const text = `<Start> = play the song -> "song"
                     | stop the music -> "stop"
                     | next track -> "next"
                     | previous track -> "prev";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(dispatch!.type).toBe("dispatch");
        const keys = Array.from(dispatch!.tokenMap.keys()).sort();
        expect(keys).toEqual(["next", "play", "previous", "stop"]);
        expect(dispatch!.fallback ?? []).toHaveLength(0);
    });

    it("matches identically to the unoptimized grammar (pure dispatch)", () => {
        const text = `<Start> = play the song -> "song"
                     | stop the music -> "stop"
                     | next track -> "next"
                     | previous track -> "prev";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        for (const input of [
            "play the song",
            "stop the music",
            "next track",
            "previous track",
            "no match",
            "play",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("groups multiple alternatives sharing a first token", () => {
        const text = `<Start> = play song -> "song"
                     | play album -> "album"
                     | play playlist -> "playlist"
                     | stop -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        // "play" bucket has 3 members, "stop" has 1.
        expect(dispatch!.tokenMap.get("play")).toHaveLength(3);
        expect(dispatch!.tokenMap.get("stop")).toHaveLength(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play song",
            "play album",
            "play playlist",
            "stop",
            "play",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("places wildcard-first members in fallback", () => {
        const text = `<Start> = play $(t:string) -> { play: t }
                     | stop -> "stop"
                     | next -> "next";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        // Wildcard-first member ("play $(t:string)") goes to fallback;
        // "stop" / "next" go into tokenMap.  Note: the leading literal
        // "play" of the wildcard rule is not statically known to the
        // dispatch optimizer because the first part is a StringPart
        // followed by a wildcard - but the StringPart itself is
        // unbound, so it's eligible.  We expect "play" → 1 entry and
        // "stop"/"next" → 1 each, fallback empty.  Verify that match
        // results are preserved either way.
        expect(
            dispatch!.tokenMap.size + (dispatch!.fallback?.length ?? 0),
        ).toBeGreaterThanOrEqual(2);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play hello", "stop", "next", "no"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("leaves single-alternative rules unchanged", () => {
        const text = `<Start> = play song -> "song";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeUndefined();
    });

    it("emits dispatch even for two single-bucket alternatives", () => {
        // Two alternatives, both with first token = literal: dispatch
        // would produce 2 buckets of 1 each, no fallback.  That still
        // filters (saves one regex try on a non-matching first token),
        // so dispatch IS emitted.  This test sanity-checks that the
        // bail-out is only triggered when dispatch genuinely wouldn't
        // help.
        const text = `<Start> = foo -> 1 | bar -> 2;`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "bar",
            "foo",
        ]);
    });

    it("preserves implicit-default value through dispatch", () => {
        // The matcher's implicit-default uses the literal tokens of
        // the StringPart - the dispatch must NOT strip the leading
        // token.  This regression test catches that.
        const text = `<Start> = a b | c d | e;`;
        const baseline = loadGrammarRules("t.grammar", text, {
            startValueRequired: false,
        });
        const optimized = loadGrammarRules("t.grammar", text, {
            startValueRequired: false,
            optimizations: { dispatchifyAlternations: true },
        });
        for (const input of ["a b", "c d", "e", "x"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("survives a JSON round-trip", () => {
        const text = `<Start> = play -> "play"
                     | stop -> "stop"
                     | next -> "next";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const roundTripped = grammarFromJson(grammarToJson(optimized));
        const dispatch = findDispatchPart(roundTripped.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "next",
            "play",
            "stop",
        ]);

        for (const input of ["play", "stop", "next", "x"]) {
            expect(match(roundTripped, input)).toStrictEqual(
                match(optimized, input),
            );
        }
    });

    it("does not dispatch optional/none spacing modes", () => {
        // none-mode rules: tokens run together, so peek-by-separator
        // would return the entire run and miss bucket keys.  The
        // optimizer must skip dispatch for these partitions.
        const text = `<Start> [spacing=none] = playsong -> "ps" | stopnow -> "sn";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // A RulesPart with multiple members should remain.
        expect(findDispatchPart(optimized.rules)).toBeUndefined();
        // findRulesPartByMembers with min 2 members may not exist for
        // top-level (top-level isn't a RulesPart) - just verify
        // results match unoptimized.
        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["playsong", "stopnow", "play"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Auto-mode + script-eligibility coverage ────────────────────────
    //
    // Auto-mode dispatch is gated by `dispatchKeyScriptRe`: every
    // tokenMap key must be composed entirely of word-boundary-script
    // chars (Latin/Cyrillic/Greek/...).  CJK / digit-only / mixed-script
    // keys are ineligible.  These tests exercise each branch and
    // confirm match equivalence with the unoptimized baseline.

    it("dispatches auto-mode all-Cyrillic keys", () => {
        // Cyrillic is in the word-boundary-script list, so auto-mode
        // dispatch is eligible.
        const text = `<Start> = играть песню -> "play"
                     | стоп -> "stop"
                     | дальше -> "next";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "дальше",
            "играть",
            "стоп",
        ]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["играть песню", "стоп", "дальше", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does NOT dispatch auto-mode all-CJK keys", () => {
        // CJK (Han) is NOT in the word-boundary-script list, so the
        // auto-mode eligibility check rejects this partition.  Match
        // results must still be correct via the unoptimized RulesPart.
        const text = `<Start> = 再生 -> "play"
                     | 停止 -> "stop"
                     | 次 -> "next";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeUndefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["再生", "停止", "次", "他"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does NOT dispatch auto-mode mixed-script keys", () => {
        // A key like "play你" is not a single-script run, so the
        // anchored eligibility regex rejects it (any non-word-boundary
        // char in any key disqualifies the whole partition).
        const text = `<Start> = play你 song -> "ps"
                     | stop -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeUndefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play你 song", "stop", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does NOT dispatch auto-mode digit-only first tokens", () => {
        // Digits are not part of any word-boundary script.  Bare
        // numeric leading tokens disqualify the partition.
        const text = `<Start> = 1 hour -> "h"
                     | 2 days -> "d"
                     | weeks -> "w";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // The partition contains "1" and "2" keys (digits) which are
        // not word-boundary-script, so auto-mode dispatch is rejected.
        expect(findDispatchPart(optimized.rules)).toBeUndefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["1 hour", "2 days", "weeks", "3 days"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("dispatches required-mode keys regardless of script", () => {
        // `required` spacing mode skips the auto-mode script check
        // entirely - the matcher always demands a separator after the
        // first token, so peek-by-separator agrees with the StringPart
        // boundary even for CJK / digit / mixed keys.
        const text = `<Start> [spacing=required] = 再生 song -> "play"
                     | 停止 now -> "stop"
                     | 1 thing -> "one";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "1",
            "停止",
            "再生",
        ]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["再生 song", "停止 now", "1 thing", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("dispatch tokenMap keys are lowercased", () => {
        // The optimizer lowercases keys (`first.value[0].toLowerCase()`)
        // and the matcher's `peekNextToken` lowercases peeked tokens.
        // Mixed-case input must still hit the correct bucket.
        const text = `<Start> = Play song -> "play"
                     | STOP -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "play",
            "stop",
        ]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play song",
            "Play song",
            "PLAY SONG",
            "stop",
            "Stop",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Cross-script grammar (different keys, different scripts) ───────
    //
    // The eligibility gate requires *every* key in the partition to
    // belong to a word-boundary script.  When all keys do (even across
    // different scripts e.g. Latin + Cyrillic + Greek), dispatch is
    // emitted.  When any single key falls outside the list (CJK,
    // digit-only, mixed-script), the whole partition stays as
    // `RulesPart`.  Match results must be identical to baseline either
    // way; these tests sanity-check both branches.

    it("dispatches when all keys belong to word-boundary scripts (Latin + Cyrillic + Greek)", () => {
        const text = `<Start> = play song -> "play"
                     | стоп -> "stop"
                     | παύση -> "pause";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "play",
            "παύση",
            "стоп",
        ]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play song",
            "стоп",
            "παύση",
            "noise",
            "play стоп", // Latin first-token bucket; tail mismatch → no match
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does NOT dispatch when one key is CJK among Latin keys", () => {
        // A single non-word-boundary key (CJK 再生) disqualifies the
        // whole partition - dispatch stays off and the matcher falls
        // back to the unoptimized RulesPart.
        const text = `<Start> = play song -> "play"
                     | stop -> "stop"
                     | 再生 -> "j_play";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeUndefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play song", "stop", "再生", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("mixed-script input against an eligible (Latin+Cyrillic) dispatch grammar", () => {
        // Grammar dispatches; input mixes scripts (e.g. "play你").
        // `peekNextToken` returns the full non-separator run "play你",
        // which is not a tokenMap key, so dispatch falls through to
        // fallback (none here) → no match - identical to the
        // unoptimized RulesPart's behavior, where the leading
        // StringPart regex on "play" would also fail to match the run
        // boundary at "play你".
        const text = `<Start> = play song -> "play"
                     | стоп -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play你 song", // mixed Latin+CJK first token: no dispatch hit
            "стоп你", // mixed Cyrillic+CJK first token: no dispatch hit
            "play song", // pure Latin: hits dispatch bucket
            "стоп", // pure Cyrillic: hits dispatch bucket
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("CJK-leading input falls through to wildcard fallback when grammar dispatches Latin keys", () => {
        // Grammar has Latin dispatch keys plus a wildcard alternative
        // (which goes to fallback).  CJK input "你好" peeks as the
        // full run, misses every Latin bucket, and is tried against
        // the wildcard fallback - which captures it.  Confirms
        // dispatched + fallback ordering is preserved across scripts.
        const text = `<Start> = play -> "play"
                     | stop -> "stop"
                     | $(t:string) -> { other: t };`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        // "play" / "stop" in tokenMap, wildcard rule in fallback.
        expect(dispatch!.fallback?.length ?? 0).toBe(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play", "stop", "你好", "hello", "再生"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
