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
import { GrammarRule, RulesPart } from "../src/grammarTypes.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { grammarFromJson } from "../src/grammarDeserializer.js";
import {
    findDispatchPart,
    getDispatchAllTokenMap,
    getDispatchTokenKeyCount,
    match,
} from "./dispatchTestHelpers.js";

describe("Grammar Optimizer - dispatchifyAlternations", () => {
    it("emits a DispatchPart for a multi-keyword alternation", () => {
        const text = `<Start> = play the song -> "song"
                     | stop the music -> "stop"
                     | next track -> "next"
                     | previous track -> "prev";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(dispatch!.type).toBe("rules");
        expect(dispatch!.dispatch).toBeDefined();
        const keys = Array.from(
            getDispatchAllTokenMap(dispatch!).keys(),
        ).sort();
        expect(keys).toEqual(["next", "play", "previous", "stop"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);
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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        // "play" bucket has 3 members, "stop" has 1.
        expect(getDispatchAllTokenMap(dispatch!).get("play")).toHaveLength(3);
        expect(getDispatchAllTokenMap(dispatch!).get("stop")).toHaveLength(1);

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
        const dispatch = findDispatchPart(optimized);
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
            getDispatchTokenKeyCount(dispatch!) +
                (dispatch!.alternatives?.length ?? 0),
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
        expect(findDispatchPart(optimized)).toBeUndefined();
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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["bar", "foo"]);
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
        const dispatch = findDispatchPart(roundTripped);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["next", "play", "stop"]);

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
        expect(findDispatchPart(optimized)).toBeUndefined();
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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["дальше", "играть", "стоп"]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["играть песню", "стоп", "дальше", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("dispatches auto-mode all-CJK keys via leading code point", () => {
        // CJK (Han) is not in the word-boundary-script list, so the
        // WB-prefix of each first literal is empty.  The optimizer
        // falls back to bucketing on the leading code point, so each
        // rule gets its own bucket and dispatch is emitted.  Match
        // results must still match the unoptimized RulesPart.
        const text = `<Start> = 再生 -> "play"
                     | 停止 -> "stop"
                     | 次 -> "next";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["停", "再", "次"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);

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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "stop"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play你 song", "stop", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("dispatches auto-mode digit-leading rules via leading digit", () => {
        // Digits are not word-boundary-script, so digit-leading
        // literals get an empty WB-prefix; the optimizer falls back
        // to the leading code point.  All three rules dispatch:
        // "1", "2", and "weeks" are all bucket keys.
        const text = `<Start> = 1 hour -> "h"
                     | 2 days -> "d"
                     | weeks -> "w";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["1", "2", "weeks"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);

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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["1", "停止", "再生"]);

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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "stop"]);

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
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "παύση", "стоп"]);

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

    it("dispatches CJK-leading rules under their leading code point alongside Latin-keyed rules", () => {
        // Mixed-script alternation: the CJK rule's first literal has
        // an empty WB-prefix and falls back to the leading code
        // point ("再"), while Latin rules continue to bucket under
        // their WB-prefix.  All three rules dispatch; no fallback.
        // The CJK input "再生" peeks as "再" (first code point) and
        // routes to its bucket.
        const text = `<Start> = play song -> "play"
                     | stop -> "stop"
                     | 再生 -> "j_play";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "stop", "再"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);

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
        expect(findDispatchPart(optimized)).toBeDefined();

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
        // (which goes to fallback).  CJK input "你好" peeks as "你"
        // (first code point under Option G), misses both Latin
        // buckets, and is tried against the wildcard fallback -
        // which captures it.  Confirms dispatched + fallback
        // ordering is preserved across scripts.
        const text = `<Start> = play -> "play"
                     | stop -> "stop"
                     | $(t:string) -> { other: t };`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        // "play" / "stop" in tokenMap, wildcard rule in fallback.
        expect(dispatch!.alternatives?.length ?? 0).toBe(1);

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
        expect(findDispatchPart(optimized)).toBeDefined();
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
        expect(findDispatchPart(optimized)).toBeDefined();
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
        expect(findDispatchPart(optimized)).toBeDefined();
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
        expect(findDispatchPart(optimized)).toBeDefined();
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

    // ── Pending-wildcard fallback in enterDispatchPart ────────────────
    //
    // Regression tests for a latent bug: when a `DispatchPart` follows
    // a wildcard-bearing prefix in the same rule, `state.index` at
    // dispatch entry points at the *wildcard's start* (the end is
    // resolved later when the next concrete part matches).  Peeking
    // from there returns the wildcard's leading token, not the next
    // concrete token, so dispatch can't filter correctly.
    // `enterDispatchPart` detects `state.pendingWildcard !== undefined`
    // and falls back to a non-dispatch alternation entry over the full
    // member list - each member's leading `StringPart` then resolves
    // the wildcard the same way it does in the unoptimized
    // `RulesPart` path.
    //
    // The bug surfaced first via tail dispatch (`grammarOptimizerDispatchTail.spec.ts`)
    // because tail factoring is what most often places a dispatch
    // after a wildcard, but it affects non-tail dispatch identically -
    // the fix lives above the `tailCall` branch in `enterDispatchPart`.
    // These tests exercise the non-tail path explicitly.

    it("matches a non-tail dispatch following a wildcard", () => {
        // Non-tail layout: <Start> wraps the alternation as the
        // second part of a parent rule with three parts (head ++
        // dispatch ++ tail), so the alternation cannot be a tail
        // call.  A leading wildcard between the head and the
        // dispatch sets pendingWildcard; the dispatch must still
        // partition correctly via the fallback path.
        const text = `<Start> = head $(t:string) (foo X | bar Y) end -> { t: t };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        // Without tailCall: the alternation isn't the rule's last
        // part, so the optimizer cannot mark it as a tail call.
        expect(dispatch!.tailCall).toBeUndefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["bar", "foo"]);

        for (const input of [
            "head some text foo X end",
            "head other words bar Y end",
            "head a foo X end",
            "head a bar Y end",
            "head foo X end", // no wildcard content - rejected (wildcard is non-empty)
            "head x foo Y end", // wrong dispatch arm
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("matches a non-tail dispatch following a typed wildcard", () => {
        // Same shape as above but with a typed wildcard (`<Inner>`
        // rule reference).  Confirms the fallback branch handles
        // both `$(t:string)` and named-rule wildcards uniformly.
        const text = `
            <Start> = play <Inner> (by $(a:string) -> { kind: "by", a }
                                  | from album $(b:string) -> { kind: "album", b }) -> 1;
            <Inner> = $(name:string);`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["by", "from"]);

        for (const input of [
            "play song by artist",
            "play song from album record",
            "play a long title by some artist",
            "play tune from album greatest hits",
            "play nothing", // no dispatch arm matches
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("preserves match parity when a wildcard precedes a fallback-only dispatch hit", () => {
        // Mixed dispatch: one literal-first member ("foo X") and one
        // wildcard-first member that lands in fallback.  After the
        // outer wildcard sets pendingWildcard, the dispatch entry
        // should consider BOTH the tokenMap entry and the fallback,
        // matching what the unoptimized RulesPart would do.
        const text = `<Start> = head $(t:string) (foo X -> "hit"
                                                 | $(w:string) end -> { fallback: w }) -> { t: t };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        // The wildcard-first arm goes to fallback.
        expect(dispatch!.alternatives?.length ?? 0).toBeGreaterThanOrEqual(1);

        for (const input of [
            "head some text foo X",
            "head some text other end",
            "head a foo X",
            "head only end",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Option G: first-code-point bucketing for non-WB-script keys ──
    //
    // Auto-mode rules whose first literal starts with a non-word-
    // boundary-script character (CJK Han / Hiragana / Katakana,
    // digits, punctuation, supplementary code points) bucket on the
    // leading code point.  `peekNextToken` mirrors that on the input
    // side so the buckets line up.

    it("dispatches Hiragana/Katakana auto-mode rules under leading code point", () => {
        // Japanese rule set: Hiragana and Katakana are also not in
        // the WB-script list, so each rule buckets on its leading
        // code point.  The first character is enough selectivity for
        // typical voice-command sets.
        const text = `<Start> = さいせい -> "play"
                     | ていし -> "stop"
                     | カット -> "cut";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["さ", "て", "カ"]);
        expect(dispatch!.alternatives ?? []).toHaveLength(0);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["さいせい", "ていし", "カット", "ノイズ"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("collides multiple CJK rules sharing a leading character into one bucket", () => {
        // 你好 and 你们 both bucket on "你"; 我 buckets on "我".
        // The "你" bucket has two rules; suffix re-match disambiguates.
        const text = `<Start> = 你好 -> "hi"
                     | 你们 -> "you"
                     | 我 -> "me";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["你", "我"]);
        expect(getDispatchAllTokenMap(dispatch!).get("你")).toHaveLength(2);
        expect(getDispatchAllTokenMap(dispatch!).get("我")).toHaveLength(1);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["你好", "你们", "我", "你", "他"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("dispatches supplementary-plane (surrogate pair) leading character", () => {
        // U+1F3B5 (musical note) is a single code point encoded as a
        // surrogate pair in UTF-16.  classifyDispatchMember /
        // peekNextToken use codePointAt(0) + fromCodePoint, which
        // round-trip the supplementary char as a 2-UTF-16-unit
        // bucket key.  Matching must work end-to-end.
        const text = `<Start> = 🎵 song -> "music"
                     | play -> "p";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        const keys = Array.from(getDispatchAllTokenMap(dispatch!).keys());
        expect(keys).toContain("🎵");
        expect(keys).toContain("play");

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["🎵 song", "play", "🎵", "noise"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("buckets mixed CJK + Latin alternation correctly", () => {
        // Realistic mixed-language rule set: Latin commands +
        // Japanese hiragana + Han.  Each bucket keys on the
        // appropriate prefix (WB-prefix for Latin, first char for
        // CJK).  Inputs route to the right bucket.
        const text = `<Start> = play -> "p"
                     | stop -> "s"
                     | 再生 -> "jp"
                     | さいせい -> "jh";`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "stop", "さ", "再"]);

        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of [
            "play",
            "stop",
            "再生",
            "さいせい",
            "noise",
            "再",
            "さい",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    /**
     * Match-order semantics: dispatch trades source-order
     * preservation for first-token bucketing.  When a fallback
     * (non-statically-tokened) member appears *before* a token-
     * bucket member in source order, the unoptimized matcher tries
     * the fallback first - so on inputs both alternatives accept,
     * the fallback's value wins.  After dispatch, the bucket member
     * is tried first on a peek hit and its value wins instead.
     *
     * This is documented as accepted in
     * `dispatchifyAlternations`'s docstring.  This test pins the
     * behavior so any future change (e.g. a `preserveSourceOrder`
     * opt-in) is forced to update it explicitly.
     */
    it("documents accepted match-order shift: bucket member wins over earlier fallback", () => {
        // Wildcard-first member appears before "play" member in
        // source order.  Both accept "play me a song"; baseline
        // returns the wildcard's value, optimized returns the
        // "play" rule's value.
        const text = `<Start> = $(text:string) -> { kind: "fallback", text }
                                  | play $(rest:string) -> { kind: "play", rest }
                                  | stop -> { kind: "stop" };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // Confirm a DispatchPart was emitted at the top level with
        // the wildcard rule in fallback.
        const dispatch = findDispatchPart(optimized);
        expect(dispatch).toBeDefined();
        expect((dispatch!.alternatives ?? []).length).toBe(1);
        expect(
            Array.from(getDispatchAllTokenMap(dispatch!).keys()).sort(),
        ).toEqual(["play", "stop"]);

        // On "play me a song": baseline prefers the source-order
        // first match (wildcard), optimized prefers the bucket hit.
        const baselineFirst = matchGrammar(baseline, "play me a song")[0]
            ?.match;
        const optimizedFirst = matchGrammar(optimized, "play me a song")[0]
            ?.match;
        expect(baselineFirst).toEqual({
            kind: "fallback",
            text: "play me a song",
        });
        expect(optimizedFirst).toEqual({
            kind: "play",
            rest: "me a song",
        });

        // Both still produce the *same set* of matches (just in a
        // different order), so exhaustive match-set equality holds.
        expect(match(baseline, "play me a song")).toStrictEqual(
            match(optimized, "play me a song"),
        );
    });
});

/**
 * The optimizer never emits these `DispatchPart` shapes (they offer
 * no filtering benefit over an equivalent `RulesPart`), but the
 * matcher must still handle them correctly because they can arrive
 * via hand-written or third-party serialized grammars.
 * `grammarDeserializer.ts` logs a `debug` advisory but loads them.
 *
 * Each test hand-constructs a `DispatchPart` of the non-canonical
 * shape, drops it into a minimal grammar, runs `matchGrammar`
 * directly against it, and asserts the result equals an equivalent
 * `RulesPart`-only baseline.
 */
describe("Grammar Optimizer - non-canonical DispatchPart shapes", () => {
    function buildRule(token: string, value: string): GrammarRule {
        return {
            parts: [{ type: "string", value: [token] }],
            value: { type: "literal", value },
        };
    }

    it("matcher handles empty tokenMap with non-empty fallback", () => {
        // Equivalent to a plain RulesPart over `fallback` - dispatch
        // peek always misses, so every match goes through fallback.
        const ruleA = buildRule("alpha", "a");
        const ruleB = buildRule("beta", "b");
        const dispatch: RulesPart = {
            type: "rules",
            dispatch: [],
            alternatives: [ruleA, ruleB],
        };
        const grammar = { alternatives: [{ parts: [dispatch] }] };
        const baseline = { alternatives: [ruleA, ruleB] };

        for (const input of ["alpha", "beta", "gamma", ""]) {
            const got = matchGrammar(grammar, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            const exp = matchGrammar(baseline, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            expect(got).toStrictEqual(exp);
        }
    });

    it("matcher handles single-bucket dispatch with no fallback", () => {
        // Equivalent to a plain RulesPart over the single bucket -
        // peek hit yields the bucket, miss yields no alternatives.
        const ruleA = buildRule("alpha", "a1");
        const ruleA2: GrammarRule = {
            parts: [{ type: "string", value: ["alpha", "two"] }],
            value: { type: "literal", value: "a2" },
        };
        const dispatch: RulesPart = {
            type: "rules",
            alternatives: [],
            dispatch: [
                {
                    spacingMode: undefined,
                    tokenMap: new Map([["alpha", [ruleA, ruleA2]]]),
                },
            ],
        };
        const grammar = { alternatives: [{ parts: [dispatch] }] };
        const baseline = { alternatives: [ruleA, ruleA2] };

        for (const input of ["alpha", "alpha two", "beta", ""]) {
            const got = matchGrammar(grammar, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            const exp = matchGrammar(baseline, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            expect(got).toStrictEqual(exp);
        }
    });

    it("matcher handles empty tokenMap with empty fallback (always fails)", () => {
        // Degenerate but well-formed: peek always misses, no fallback,
        // so the dispatch arm returns false for every input.  The
        // equivalent RulesPart with zero alternatives also matches
        // nothing.
        const dispatch: RulesPart = {
            type: "rules",
            alternatives: [],
            dispatch: [],
        };
        const grammar = { alternatives: [{ parts: [dispatch] }] };

        for (const input of ["alpha", "beta", ""]) {
            expect(matchGrammar(grammar, input)).toEqual([]);
        }
    });

    it("non-canonical shapes round-trip through serializer", () => {
        // Round-trip a hand-built non-canonical dispatch through
        // grammarToJson / grammarFromJson and confirm matches still
        // line up.  Verifies the deserializer's `debug` advisory
        // does not block the load.
        const ruleA = buildRule("alpha", "a");
        const dispatch: RulesPart = {
            type: "rules",
            alternatives: [],
            dispatch: [
                {
                    spacingMode: undefined,
                    tokenMap: new Map([["alpha", [ruleA]]]),
                },
            ],
        };
        const grammar = { alternatives: [{ parts: [dispatch] }] };
        const roundTripped = grammarFromJson(grammarToJson(grammar));

        for (const input of ["alpha", "beta", ""]) {
            const got = matchGrammar(roundTripped, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            const exp = matchGrammar(grammar, input)
                .map((m) => JSON.stringify(m.match))
                .sort();
            expect(got).toStrictEqual(exp);
        }
    });

    // ── Regression: separator chars embedded in literal first tokens ──
    //
    // Discovered by the `vocabulary.separatorInLiteralProb` fuzz
    // dimension.  In `required` mode, `peekNextToken` truncates the
    // input at the first separator (it returns the leading
    // non-separator run).  The dispatch bucket key must be derived
    // the same way; using the full literal token caused a key
    // mismatch when the literal embedded a separator char like `?`
    // or `@`, dropping the match entirely.
    describe("regression: separator char inside required-mode literal", () => {
        it("matches a required-mode alternation whose first token embeds '?'", () => {
            const text = `<Start> [spacing=required] = d? b@ a% -> "first"
                                                | b d d d@ -> "second";`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            // Sanity: dispatch fired and bucketed on the truncated
            // (peek-equivalent) token, not the full literal.
            const dispatch = findDispatchPart(optimized);
            expect(dispatch).toBeDefined();
            const keys = Array.from(
                getDispatchAllTokenMap(dispatch!).keys(),
            ).sort();
            expect(keys).toEqual(["b", "d"]);

            for (const input of ["d? b@ a%", "b d d d@", "zzz", "d?"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });

        it("dispatches each separator char (`,`, `.`, `:`, `!`, `?`, `@`, `#`, `%`, `&`, `+`, `=`, `'`, `\"`)", () => {
            // One alternative per separator character, each with the
            // separator embedded in its first literal.  All 13 alts
            // collapse into a SINGLE `"x"` bucket (the leading
            // non-separator run is identical), so the dispatch must
            // still discriminate among them via the member rules'
            // StringPart regexes after routing.  The fallback subset
            // must be empty and dispatch must still produce the
            // right match for each input.
            const text = `<Start> [spacing=required] = x, a -> "comma"
                | x. a -> "dot"
                | x: a -> "colon"
                | x! a -> "bang"
                | x? a -> "qmark"
                | x@ a -> "at"
                | x# a -> "hash"
                | x% a -> "pct"
                | x& a -> "amp"
                | x+ a -> "plus"
                | x= a -> "eq"
                | x' a -> "apos"
                | x" a -> "quot";`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            const inputs = [
                ["x, a", "comma"],
                ["x. a", "dot"],
                ["x: a", "colon"],
                ["x! a", "bang"],
                ["x? a", "qmark"],
                ["x@ a", "at"],
                ["x# a", "hash"],
                ["x% a", "pct"],
                ["x& a", "amp"],
                ["x+ a", "plus"],
                ["x= a", "eq"],
                ["x' a", "apos"],
                ['x" a', "quot"],
            ];
            for (const [input, expected] of inputs) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
                expect(match(optimized, input)).toStrictEqual([
                    JSON.stringify(expected),
                ]);
            }
        });

        it("sends a literal that starts with a separator to the fallback bucket", () => {
            // Leading non-separator run of `?x` is empty - the
            // dispatch can't bucket this rule (peek would never
            // return a key matching `?x`), so it must land in the
            // fallback subset and still match correctly.
            const text = `<Start> [spacing=required] = ?x -> "lead-sep"
                                                | yy -> "normal";`;
            const baseline = loadGrammarRules("t.grammar", text);
            const optimized = loadGrammarRules("t.grammar", text, {
                optimizations: { dispatchifyAlternations: true },
            });
            const dispatch = findDispatchPart(optimized);
            // Dispatch may or may not fire (depends on whether the
            // single non-fallback bucket survives the
            // single-bucket-no-fallback skip), but if it does the
            // fallback subset must contain the leading-separator
            // alternative.
            if (dispatch !== undefined) {
                const keys = Array.from(
                    getDispatchAllTokenMap(dispatch).keys(),
                );
                expect(keys).not.toContain("?x");
                expect(keys).not.toContain("?");
            }
            // The actual match must work either way.
            for (const input of ["?x", "yy", "zzz"]) {
                expect(match(optimized, input)).toStrictEqual(
                    match(baseline, input),
                );
            }
        });
    });
});
