// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression test for the top-level mixed-mode `leadingSpacingMode`
 * fix introduced when `dispatchifyAlternations` was hoisted onto
 * `Grammar.dispatch` (Phase 2 of the RulesPart/DispatchPart
 * unification).
 *
 * Before the fix, top-level dispatch was implemented by synthesizing
 * a wrapper `<Start>` rule whose single body was a `RulesPart` with
 * the dispatch index attached.  The wrapper rule's `spacingMode`
 * was uniform across every member, so a `[spacing=none]` rule that
 * landed in the fallback subset got matched under the wrapper's
 * default (auto) leading mode - i.e. leading whitespace was
 * silently consumed even though the `none`-mode rule disallows it.
 *
 * After Phase 2, top-level dispatch lives on `grammar.dispatch` and
 * each top-level rule keeps its own `spacingMode` at the start
 * position.  The matcher's `initialMatchState` peek-and-filter walks
 * the per-mode buckets directly and seeds each restored alternative
 * with its rule's own `spacingMode`.  A leading-space input must no
 * longer match a `[spacing=none]` top-level rule.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { match } from "./dispatchTestHelpers.js";

describe("Grammar Optimizer - top-level mixed-mode dispatch", () => {
    // Mix one [spacing=none] rule with several auto-mode
    // dispatch-eligible rules.  The four auto-mode alternatives
    // share distinct first tokens so dispatchifyAlternations
    // promotes them to per-token buckets; the none-mode rule lands
    // in the fallback subset (`grammar.rules`).
    const text = `<Start> [spacing=none] = hello -> "none";
                  <Start> = play song -> "play";
                  <Start> = stop now -> "stop";
                  <Start> = next track -> "next";
                  <Start> = previous track -> "prev";`;

    it("none-mode top-level rule rejects leading whitespace", () => {
        const grammar = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        // Without leading space: the none-mode rule matches.
        expect(match(grammar, "hello")).toEqual([JSON.stringify("none")]);
        // With leading space: the none-mode rule must NOT match.
        // Before Phase 2 the wrapper rule's auto leading mode let
        // the leading space through and this returned ["none"].
        expect(match(grammar, " hello")).toEqual([]);
    });

    it("auto-mode top-level rules still tolerate leading whitespace", () => {
        const grammar = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        expect(match(grammar, "play song")).toEqual([JSON.stringify("play")]);
        expect(match(grammar, " play song")).toEqual([JSON.stringify("play")]);
        expect(match(grammar, " stop now")).toEqual([JSON.stringify("stop")]);
    });

    it("matches the unoptimized baseline for representative inputs", () => {
        const baseline = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: false },
        });
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { dispatchifyAlternations: true },
        });
        for (const input of [
            "hello",
            " hello",
            "play song",
            " play song",
            "stop now",
            "next track",
            "previous track",
        ]) {
            expect(match(optimized, input)).toEqual(match(baseline, input));
        }
    });
});
