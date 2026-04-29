// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Default-mode (`wildcardPolicy: "exhaustive"`) regression tests
// for wildcard-length alternatives in `grammarMatcher`.
//
// Longer-wildcard alternatives live on the live state's unified
// `backtracks` chain as `"wildcard"`-origin frames pushed by
// `captureWildcard`.  Forked siblings (optional-skip, nested-rule
// alternatives, repeat continuation) are produced by `forkMatchState`
// which DROPS the chain on the fork — enforcing a single-owner
// invariant on the backtrack chain.
//
// Correctness in default mode therefore depends on the live state
// re-spawning a fresh sibling at EACH viable wildcard length: when
// the matcher restores a `"wildcard"`-origin frame and re-runs
// `matchState`, the part loop is expected to push a NEW optional-
// skip / repeat backtrack at the new length.  These tests construct
// inputs where the longer-wildcard parse exists but is reachable
// only through that re-fork behavior.
//
// `wildcardFrameSnapshot.spec.ts` covers the snapshot-completeness
// half of the same invariant for optional-skip and nested-rule alt.
// This file extends coverage to the repeat-continuation re-spawn,
// the consecutive-wildcard frame-stack discipline, and the
// completion-side inner-loop refactor.

import { matchGrammarCompletion } from "../src/grammarCompletion.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import type { Grammar } from "../src/grammarTypes.js";
import { expectMetadata } from "./testUtils.js";

function uniqueMatches(grammar: Grammar, request: string): string[] {
    const results = matchGrammar(grammar, request).map((m) =>
        JSON.stringify(m.match),
    );
    return Array.from(new Set(results)).sort();
}

function allMatches(grammar: Grammar, request: string): string[] {
    return matchGrammar(grammar, request)
        .map((m) => JSON.stringify(m.match))
        .sort();
}

describe("wildcard-frame default-mode interactions", () => {
    // -----------------------------------------------------------------
    // Optional BEFORE wildcard — opt-skip is queued before the
    // wildcard is encountered, so it gets a fresh frame chain
    // naturally.  Both branches must surface independently.
    // -----------------------------------------------------------------
    describe("optional before wildcard: both branches enumerate independently", () => {
        // Grammar: (foo)? $(x) bar
        //
        // Input: "foo p bar"
        //
        // Viable parses (both fully consume the input):
        //   - opt taken: "foo" matched, x="p",      "bar" matched
        //   - opt skip:  x="foo p",                 "bar" matched
        const g = `<Start> = (foo)? $(x) bar -> { x };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("emits one match per branch with no duplicates", () => {
            const all = allMatches(grammar, "foo p bar");
            const unique = Array.from(new Set(all)).sort();
            expect(all).toStrictEqual(unique);
            expect(all).toStrictEqual(
                [
                    JSON.stringify({ x: "p" }),
                    JSON.stringify({ x: "foo p" }),
                ].sort(),
            );
        });
    });

    // -----------------------------------------------------------------
    // Repeat AFTER wildcard: the only valid parse requires extending
    // the wildcard past the first repeat occurrence and re-spawning
    // the repeat continuation at the new wildcard length.
    // -----------------------------------------------------------------
    describe("repeat after wildcard: re-spawned per length", () => {
        // Grammar: $(x) sep (more)+
        //
        // Input: "p sep more sep more"
        //
        // Viable parse:
        //   - x="p sep more", (more)+ matches the trailing "more" ✓
        //
        // The shorter x="p" parse is partial: (more)+ matches the
        // first "more", but trailing " sep more" remains so
        // finalizeState rejects it.  The longer parse requires
        // extending the wildcard frame and re-encountering the
        // repeat group, which spawns a new continuation entry with
        // an empty frame chain.
        const g = `<Start> = $(x) sep (more)+ -> { x };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("longer-wildcard parse emerges via re-spawned repeat continuation", () => {
            const unique = uniqueMatches(grammar, "p sep more sep more");
            expect(unique).toStrictEqual([JSON.stringify({ x: "p sep more" })]);
        });

        it("no parse is double-emitted across repeat × wildcard length", () => {
            const all = allMatches(grammar, "p sep more sep more");
            const unique = Array.from(new Set(all)).sort();
            expect(all).toStrictEqual(unique);
        });
    });

    // -----------------------------------------------------------------
    // Two consecutive wildcards: outer extension after inner has
    // already pushed its own frame.  Verifies the linked-list stack
    // discipline (most-recent first): inner extensions are exhausted
    // before outer.
    // -----------------------------------------------------------------
    describe("two consecutive wildcards: stack discipline", () => {
        // Grammar: $(a) x $(b) y
        //
        // Input: "p x q x r y"
        //
        // Viable (a, b) splits where "y" terminates b:
        //   - a="p",     b="q x r"
        //   - a="p x q", b="r"
        //
        // The longer-a parse requires extending the OUTER wildcard
        // frame after the inner wildcard frames have been processed.
        const g = `<Start> = $(a) x $(b) y -> { a, b };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("emits exactly the two valid splits, no duplicates", () => {
            const all = allMatches(grammar, "p x q x r y");
            const unique = Array.from(new Set(all)).sort();
            expect(all).toStrictEqual(unique);
            expect(all).toStrictEqual(
                [
                    JSON.stringify({ a: "p", b: "q x r" }),
                    JSON.stringify({ a: "p x q", b: "r" }),
                ].sort(),
            );
        });
    });

    // -----------------------------------------------------------------
    // Wildcard before nested rule containing its own wildcard.
    // Stresses snapshot completeness (parent / nestedLevel /
    // spacingMode must reset on extend) AND the inner-frame /
    // outer-frame stack discipline.
    // -----------------------------------------------------------------
    describe("wildcard before nested rule containing a wildcard", () => {
        // Grammar:
        //   <inner> = $(b) end -> b;
        //   <Start> = $(a) sep $(i:<inner>) -> { a, i };
        //
        // Input: "p sep q end sep r end"
        //
        // Viable (a, i) splits — both wildcards must capture
        // non-empty content AND the entire input must be consumed:
        //   - a="p",           i="q end sep r" (inner b extends)
        //   - a="p sep q end", i="r"           (outer a extends)
        //
        // The shorter-shorter split (a="p", i="q") is partial —
        // " sep r end" remains unconsumed so finalizeState rejects.
        // The two surviving parses each require a wildcard frame
        // to be extended on a different axis (inner vs outer),
        // exercising the linked-list stack discipline AND the
        // snapshot reset of parent / nestedLevel / spacingMode
        // when the OUTER frame is restored.
        const g = [
            `<inner> = $(b) end -> b;`,
            `<Start> = $(a) sep $(i:<inner>) -> { a, i };`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("emits both surviving parses with no duplicates", () => {
            const all = allMatches(grammar, "p sep q end sep r end");
            const unique = Array.from(new Set(all)).sort();
            expect(all).toStrictEqual(unique);
            expect(all).toStrictEqual(
                [
                    JSON.stringify({ a: "p", i: "q end sep r" }),
                    JSON.stringify({ a: "p sep q end", i: "r" }),
                ].sort(),
            );
        });
    });

    // -----------------------------------------------------------------
    // Three wildcards in default mode: every viable (a, b, c) split
    // must appear exactly once.  Regression guard against the
    // in-place extend-on-success loop double-emitting paths.
    // -----------------------------------------------------------------
    describe("three wildcards: full enumeration without duplication", () => {
        // Grammar: $(a) x $(b) x $(c) end
        //
        // Input: "p x q x r x s end"
        //
        // The terminal "end" anchors c; "x" delimits the three
        // wildcards.  Viable (a, b, c) splits — each wildcard must
        // capture at least one non-separator char:
        //   - ("p",     "q",     "r x s")
        //   - ("p",     "q x r", "s")
        //   - ("p x q", "r",     "s")
        const g = `<Start> = $(a) x $(b) x $(c) end -> { a, b, c };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("emits exactly the three splits with no duplicates", () => {
            const all = allMatches(grammar, "p x q x r x s end");
            const unique = Array.from(new Set(all)).sort();
            expect(all).toStrictEqual(unique);
            expect(all).toStrictEqual(
                [
                    JSON.stringify({ a: "p", b: "q", c: "r x s" }),
                    JSON.stringify({ a: "p", b: "q x r", c: "s" }),
                    JSON.stringify({ a: "p x q", b: "r", c: "s" }),
                ].sort(),
            );
        });
    });
});

// ---------------------------------------------------------------------
// Default-mode completion: regression guard against the inner-loop
// refactor in `collectCandidates`.  The previous design pushed each
// longer-wildcard alternative as a new pending entry and processed
// each via `matchState`; the new design drains every wildcard-extension
// frame inline via `runStateWithExtensions`.  In default mode the
// resulting candidate set must be unchanged.
// ---------------------------------------------------------------------
describe("grammar completion default-mode: candidate set preserved across wildcard extensions", () => {
    // Grammar: play $(name) by $(artist)
    //
    // Input "play hello by world" is ambiguous — see
    // grammarCompletionShortestWildcard.spec.ts for the full
    // walkthrough.  In DEFAULT mode the longer-wildcard alternative
    // must still surface its "by" completion at the full input
    // length (P=19).  The refactored inner-loop must enumerate that
    // alternative even though it is now processed inline against
    // the same MatchState rather than as a clone in `pending`.
    const g = `<Start> = play $(name) by $(artist) -> { name, artist };`;
    const grammar = loadGrammarRules("test.grammar", g);

    it("default mode still emits the longer-wildcard 'by' completion at P=19", () => {
        const result = matchGrammarCompletion(grammar, "play hello by world");
        // A regression in the inner extension loop would cause
        // matchedPrefixLength to drop back to 13 (the shortest-
        // wildcard partial-artist path).
        expectMetadata(result, {
            completions: ["by"],
            matchedPrefixLength: 19,
        });
    });
});
