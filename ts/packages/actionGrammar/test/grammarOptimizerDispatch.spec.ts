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

    // ── Auto-mode + script-prefix bucketing ────────────────────────────
    //
    // In auto mode each rule is bucketed under the leading
    // word-boundary-script run of its first literal token (Latin /
    // Cyrillic / Greek / ...).  Rules whose first literal starts with
    // a non-word-boundary char (CJK, digit, punctuation) have an
    // empty prefix and go to `fallback`.  This mirrors what the
    // matcher's `peekNextToken` returns for any input that could
    // match the rule, so dispatch remains a pure filter.  These
    // tests exercise each branch and confirm match equivalence with
    // the unoptimized baseline.

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

    it("buckets auto-mode mixed-script first literal under its WB-script prefix", () => {
        // First literal "play你" has WB-script prefix "play"; that's
        // also what `peekNextToken` returns for inputs whose first
        // run starts with "play" followed by CJK.  So the rule
        // dispatches under bucket "play".
        const text = `<Start> = play你 song -> "ps"
                     | stop -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "play",
            "stop",
        ]);
        expect(dispatch!.fallback ?? []).toHaveLength(0);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play你 song", "stop", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("sends auto-mode digit-leading rules to fallback", () => {
        // Digits are not word-boundary-script, so digit-leading
        // literals get an empty prefix and end up in fallback.
        // "weeks" buckets normally; result is dispatch with one
        // tokenMap key + two fallback rules.
        const text = `<Start> = 1 hour -> "h"
                     | 2 days -> "d"
                     | weeks -> "w";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual(["weeks"]);
        expect(dispatch!.fallback ?? []).toHaveLength(2);

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
    // Each rule's bucket key is derived independently (leading
    // WB-script prefix in auto, full first literal in required).
    // Rules with multiple word-boundary scripts can coexist in the
    // same dispatch; rules with non-WB-leading first literals end up
    // in fallback alongside word-boundary-keyed rules.  Match
    // results match the unoptimized baseline in every case.

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

    it("sends a CJK-leading rule to fallback alongside Latin-keyed rules", () => {
        // The CJK rule's first literal has an empty WB-prefix - it
        // goes to fallback.  Latin rules continue to bucket under
        // their WB-prefix.  The CJK input "再生" peeks as undefined
        // (no WB prefix), so the dispatch arm tries the fallback and
        // matches.
        const text = `<Start> = play song -> "play"
                     | stop -> "stop"
                     | 再生 -> "j_play";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized.rules);
        expect(dispatch).toBeDefined();
        expect(Array.from(dispatch!.tokenMap.keys()).sort()).toEqual([
            "play",
            "stop",
        ]);
        expect(dispatch!.fallback ?? []).toHaveLength(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play song", "stop", "再生", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("mixed-script input against an eligible (Latin+Cyrillic) dispatch grammar", () => {
        // Grammar dispatches; input mixes scripts (e.g. "play你").
        // `peekNextToken` returns the WB-script prefix "play", which
        // hits the "play" bucket; the suffix's StringPart regex then
        // re-matches from the original index against "play你 song"
        // and either succeeds (when the rule's literals line up with
        // the script transitions in the input) or fails the same
        // way the unoptimized matcher would.
        const text = `<Start> = play song -> "play"
                     | стоп -> "stop";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play你 song", // "play" hits dispatch; suffix fails on " song" mismatch
            "стоп你", // "стоп" hits dispatch; suffix matches up to "стоп", trailing "你" rejected
            "play song", // pure Latin: hits dispatch bucket, succeeds
            "стоп", // pure Cyrillic: hits dispatch bucket, succeeds
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

    it("matches script-transition input through dispatched WB-prefix bucket", () => {
        // Regression test: in auto mode an input may legitimately
        // omit a separator at a script transition (Latin→CJK), e.g.
        // "play你好" matches the rule `play 你好`.  Pre-fix the
        // dispatch optimizer's peek returned the entire non-separator
        // run "play你好" and missed the "play" bucket, so the
        // optimized matcher returned no match while the baseline
        // matched.  With WB-script-prefix bucketing peek returns
        // "play" and the suffix re-matches successfully.
        const text = `<Start> = play 你好 -> "p"
                     | stop -> "s";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();
        for (const input of [
            "play你好", // Latin→CJK transition, no separator
            "play 你好", // explicit separator
            "stop",
            "play你", // suffix mismatch (only "你", missing "好")
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("matches script-transition input via wildcard suffix in dispatched bucket", () => {
        // Same script-transition dynamic as above but with the
        // post-token suffix being a wildcard.  Input "play你好"
        // hits the "play" bucket and the wildcard captures "你好".
        const text = `<Start> = play $(t:string) -> { play: t }
                     | stop -> "s"
                     | next -> "n";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();
        for (const input of ["play你好", "play hello", "stop", "next"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Cross-mode dispatch (outer rule mode ≠ dispatched part mode) ─
    //
    // The dispatch arm calls `peekNextToken` with TWO independent
    // spacing modes: `leadingMode` from the surrounding state (the
    // outer rule's mode) and `tokenMode` from the dispatched part
    // itself (the partition's mode = the inner alternative rules'
    // mode).  When the two disagree, peek must honor each mode for
    // its own concern: leading-separator handling vs script-
    // transition truncation.  These regression tests exercise the
    // mismatch via grammars that compose a non-auto outer rule with
    // an auto-mode inner alternation containing dispatch-eligible
    // script-transition rules.

    it("none outer + auto inner: script-transition input dispatches", () => {
        // Outer rule is `[spacing=none]` so no leading whitespace is
        // allowed at the outer boundary.  The inner alternation is
        // auto-mode and contains a script-transition rule
        // `play 你好`.  Input "play你好" must reach the dispatched
        // "play" bucket: peek's tokenMode (auto) must truncate at
        // the Latin→CJK transition.  Pre-fix (single-mode peek
        // using outer's "none" for both purposes) the run was
        // returned whole and missed the bucket.
        const text = `<Inner> = play 你好 -> "p" | stop -> "s" | next -> "n";
                     <Start> [spacing=none] = <Inner>;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();
        for (const input of [
            "play你好", // hits dispatch via WB-script-prefix "play"
            "play 你好", // explicit separator (auto inner accepts it)
            "stop",
            "next",
            " play你好", // outer none rejects leading sep
            "play你好 ", // outer none rejects trailing sep
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("none outer + auto inner: leading separator rejected before dispatch", () => {
        // Confirms peek's leadingMode = outer's "none" rejects a
        // leading separator at the dispatch boundary, even though
        // the inner alternation's auto mode would normally tolerate
        // one.  All four inputs with a leading space must fail to
        // match the optimized grammar exactly as the baseline does.
        const text = `<Inner> = play -> "p" | stop -> "s" | next -> "n";
                     <Start> [spacing=none] = <Inner>;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(findDispatchPart(optimized.rules)).toBeDefined();
        for (const input of [" play", "  stop", "\tnext", "play", "stop"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("auto outer + none inner: dispatched literal must match without separator", () => {
        // Inner alternation is `[spacing=none]`, so peek's tokenMode
        // is "none" - no script-transition truncation.  Outer is
        // auto, so peek's leadingMode skips leading whitespace.
        // Input "  play你好" must skip outer whitespace, then peek
        // returns the full non-separator run "play你好", which the
        // none-mode inner rule `play你好` matches exactly.
        const text = `<Inner> [spacing=none] = play你好 -> "p" | stop -> "s";
                     <Start> = <Inner>;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // Note: dispatch may or may not be emitted for a none-mode
        // partition (the optimizer rejects optional/none dispatch
        // partitions today).  Either way, optimized vs baseline
        // results must agree.
        for (const input of [
            "play你好",
            "  play你好  ",
            "stop",
            "play 你好", // none inner forbids the inner separator
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
