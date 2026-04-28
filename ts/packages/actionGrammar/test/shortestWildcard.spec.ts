// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import type { Grammar } from "../src/grammarTypes.js";

function match(grammar: Grammar, request: string): unknown[] {
    return matchGrammar(grammar, request).map((m) => m.match);
}

function matchShortest(grammar: Grammar, request: string): unknown[] {
    return matchGrammar(grammar, request, {
        wildcardPolicy: "shortest",
    }).map((m) => m.match);
}

describe("shortestWildcard option", () => {
    // ---------------------------------------------------------------
    // Basic two-wildcard case (the motivating example)
    // ---------------------------------------------------------------
    describe("basic: two wildcards with ambiguous delimiter", () => {
        const g = `<Start> = play $(track) by $(artist) -> { actionName: "playTrack", parameters: { track, artist }};`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive (default) returns multiple matches", () => {
            const results = match(grammar, "play 5 by 5 by Math");
            expect(results.length).toBeGreaterThan(1);
        });

        it("shortestWildcard returns single leftmost-shortest match", () => {
            const results = matchShortest(grammar, "play 5 by 5 by Math");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({
                actionName: "playTrack",
                parameters: { track: "5", artist: "5 by Math" },
            });
        });

        it("shortestWildcard with unambiguous input matches normally", () => {
            const results = matchShortest(grammar, "play Stairway by Zeppelin");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({
                actionName: "playTrack",
                parameters: {
                    track: "Stairway",
                    artist: "Zeppelin",
                },
            });
        });
    });

    // ---------------------------------------------------------------
    // Backtracking: shortest wildcard leads to dead end
    // ---------------------------------------------------------------
    describe("backtracking when shortest wildcard fails", () => {
        // $(a) captures the shortest string before "x", then "y" must follow.
        // Input: "a x b x y" — shortest a="a" then expects "y" but sees "b",
        // so must backtrack to a="a x b" to find "x y".
        const g = `<Start> = $(a) x y -> { a };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive returns the only valid match", () => {
            const results = match(grammar, "a x b x y");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({ a: "a x b" });
        });

        it("shortestWildcard backtracks to find the valid match", () => {
            const results = matchShortest(grammar, "a x b x y");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({ a: "a x b" });
        });
    });

    // ---------------------------------------------------------------
    // Multiple top-level rules: both should match independently
    // ---------------------------------------------------------------
    describe("multiple top-level rules are not pruned", () => {
        const g = [
            `<Start> = play $(track) by $(artist) -> { actionName: "playTrack", parameters: { track, artist }};`,
            `<Start> = search $(query) by $(field) -> { actionName: "search", parameters: { query, field }};`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("only one rule matches, shortestWildcard returns it", () => {
            const results = matchShortest(grammar, "play 5 by 5 by Math");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({
                actionName: "playTrack",
                parameters: { track: "5", artist: "5 by Math" },
            });
        });

        it("both rules match different inputs independently", () => {
            const playResults = matchShortest(
                grammar,
                "play foo by bar by baz",
            );
            expect(playResults).toHaveLength(1);
            expect((playResults[0] as any).actionName).toBe("playTrack");

            const searchResults = matchShortest(
                grammar,
                "search foo by bar by baz",
            );
            expect(searchResults).toHaveLength(1);
            expect((searchResults[0] as any).actionName).toBe("search");
        });
    });

    // ---------------------------------------------------------------
    // Nested alternatives: should NOT be pruned
    // ---------------------------------------------------------------
    describe("nested alternatives survive pruning", () => {
        const g = [
            `<Start> = $(a) <sep> $(b) -> { a, b };`,
            `<sep> = by | from;`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive returns matches for both alternatives", () => {
            // "track by something from artist" can match:
            // - via "by": a="track", b="something from artist"
            // - via "from": a="track by something", b="artist"
            const results = match(grammar, "track by something from artist");
            expect(results.length).toBeGreaterThanOrEqual(2);
        });

        it("shortestWildcard returns one match per alternative", () => {
            // Both "by" and "from" alternatives should still be explored.
            // For "by" alternative: a="track" (shortest before "by"), b="something from artist"
            // For "from" alternative: a="track by something" (shortest before "from"), b="artist"
            const results = matchShortest(
                grammar,
                "track by something from artist",
            );
            expect(results).toHaveLength(2);
            // Find by-alternative result
            const byResult = results.find(
                (r: any) => r.a === "track" && r.b === "something from artist",
            );
            expect(byResult).toBeDefined();
            // Find from-alternative result
            const fromResult = results.find(
                (r: any) => r.a === "track by something" && r.b === "artist",
            );
            expect(fromResult).toBeDefined();
        });
    });

    // ---------------------------------------------------------------
    // Single wildcard: no ambiguity, same result either way
    // ---------------------------------------------------------------
    describe("single wildcard: no difference", () => {
        const g = `<Start> = play $(track) -> { track };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive and shortestWildcard produce same result", () => {
            const exhaustive = match(grammar, "play hello world");
            const shortest = matchShortest(grammar, "play hello world");
            expect(shortest).toStrictEqual(exhaustive);
            expect(shortest).toHaveLength(1);
            expect(shortest[0]).toStrictEqual({ track: "hello world" });
        });
    });

    // ---------------------------------------------------------------
    // Trailing wildcard: captures everything after the last literal
    // ---------------------------------------------------------------
    describe("trailing wildcard captures remainder", () => {
        const g = `<Start> = find $(query) in $(location) -> { query, location };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive with repeated delimiter", () => {
            const results = match(grammar, "find books in the library in town");
            expect(results.length).toBeGreaterThan(1);
        });

        it("shortestWildcard picks leftmost-shortest for first wildcard", () => {
            const results = matchShortest(
                grammar,
                "find books in the library in town",
            );
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({
                query: "books",
                location: "the library in town",
            });
        });
    });

    // ---------------------------------------------------------------
    // Three wildcards: each captures leftmost-shortest
    // ---------------------------------------------------------------
    describe("three wildcards: leftmost-shortest each", () => {
        const g = `<Start> = $(a) x $(b) x $(c) -> { a, b, c };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive returns multiple combinations", () => {
            // "p x q x r x s" has "x" at positions 2, 6, 10
            // Multiple ways to split across wildcards
            const results = match(grammar, "p x q x r x s");
            expect(results.length).toBeGreaterThan(1);
        });

        it("shortestWildcard returns one result with leftmost-shortest", () => {
            const results = matchShortest(grammar, "p x q x r x s");
            expect(results).toHaveLength(1);
            // a="p" (shortest before first x)
            // b="q" (shortest before second x)
            // c="r x s" (remainder)
            expect(results[0]).toStrictEqual({
                a: "p",
                b: "q",
                c: "r x s",
            });
        });
    });

    // ---------------------------------------------------------------
    // Optional parts are not pruned
    // ---------------------------------------------------------------
    describe("optional parts survive pruning", () => {
        const g = `<Start> = play $(track) (by $(artist))? -> { actionName: "play", parameters: { track }};`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("with optional present", () => {
            const results = matchShortest(grammar, "play song by artist");
            // Both "with optional" and "without optional" matches should remain
            // since optional push is NOT tagged as wildcard expansion
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it("without optional part", () => {
            const results = matchShortest(grammar, "play my song");
            expect(results.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ---------------------------------------------------------------
    // No match: should return empty in both modes
    // ---------------------------------------------------------------
    describe("no match returns empty", () => {
        const g = `<Start> = play $(track) by $(artist) -> { track, artist };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive returns empty", () => {
            expect(match(grammar, "search something")).toStrictEqual([]);
        });

        it("shortestWildcard returns empty", () => {
            expect(matchShortest(grammar, "search something")).toStrictEqual(
                [],
            );
        });
    });

    // ---------------------------------------------------------------
    // No wildcards at all: shortestWildcard has no effect
    // ---------------------------------------------------------------
    describe("no wildcards: flag has no effect", () => {
        const g = `<Start> = hello world -> true;`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("same result in both modes", () => {
            expect(match(grammar, "hello world")).toStrictEqual([true]);
            expect(matchShortest(grammar, "hello world")).toStrictEqual([true]);
        });
    });

    // ---------------------------------------------------------------
    // Wildcard with number part
    // ---------------------------------------------------------------
    describe("wildcard before number part", () => {
        const g = `<Start> = $(label) $(count:number) items -> { label, count };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive with ambiguous numbers", () => {
            // "aisle 5 3 items" — wildcard "aisle" or "aisle 5"?
            // (5 could be consumed by wildcard or by the number part)
            const results = match(grammar, "aisle 5 3 items");
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it("shortestWildcard picks shortest label", () => {
            const results = matchShortest(grammar, "aisle 5 3 items");
            expect(results).toHaveLength(1);
            // Two back-to-back wildcards: $(label) consumes up to
            // the last number that can still satisfy $(count:number).
            // The number matcher finds "3" as the last number before "items",
            // so label="aisle 5", count=3.
            expect(results[0]).toStrictEqual({
                label: "aisle 5",
                count: 3,
            });
        });
    });

    // ---------------------------------------------------------------
    // Multiple top-level rules with wildcards — independent pruning
    // ---------------------------------------------------------------
    describe("independent pruning per top-level rule", () => {
        const g = [
            `<Start> = cmd $(a) x $(b) -> { action: "cmd", a, b };`,
            `<Start> = run $(c) x $(d) -> { action: "run", c, d };`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("exhaustive produces multiple per rule", () => {
            const cmdResults = match(grammar, "cmd p x q x r");
            const cmdMatches = cmdResults.filter(
                (r: any) => r.action === "cmd",
            );
            expect(cmdMatches.length).toBeGreaterThan(1);
        });

        it("shortestWildcard gives one per matching rule", () => {
            // Only "cmd" rule matches
            const results = matchShortest(grammar, "cmd p x q x r");
            expect(results).toHaveLength(1);
            expect(results[0]).toStrictEqual({
                action: "cmd",
                a: "p",
                b: "q x r",
            });
        });

        it("both rules match different inputs independently", () => {
            const cmdResults = matchShortest(grammar, "cmd p x q x r");
            expect(cmdResults).toHaveLength(1);
            expect((cmdResults[0] as any).action).toBe("cmd");

            const runResults = matchShortest(grammar, "run p x q x r");
            expect(runResults).toHaveLength(1);
            expect((runResults[0] as any).action).toBe("run");
        });
    });

    // ---------------------------------------------------------------
    // Default (no options): same as before (exhaustive)
    // ---------------------------------------------------------------
    describe("default behavior unchanged (no options)", () => {
        const g = `<Start> = $(a) x $(b) -> { a, b };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("returns all combinations when no options passed", () => {
            const results = matchGrammar(grammar, "p x q x r");
            expect(results.length).toBeGreaterThan(1);
        });

        it("returns all combinations when options is undefined", () => {
            const results = matchGrammar(grammar, "p x q x r", undefined);
            expect(results.length).toBeGreaterThan(1);
        });

        it("returns all combinations when shortestWildcard is false", () => {
            const results = matchGrammar(grammar, "p x q x r", {
                wildcardPolicy: "exhaustive",
            });
            expect(results.length).toBeGreaterThan(1);
        });
    });

    // ---------------------------------------------------------------
    // Nested rule alternatives with wildcards on both sides
    // ---------------------------------------------------------------
    describe("nested alternatives with multi-wildcard parent", () => {
        const g = [
            `<Start> = $(a) <delim> $(b) -> { a, b };`,
            `<delim> = x | y;`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("both alternatives explored, each with shortest wildcard", () => {
            // "p x q y r" can match via "x" or "y"
            // via "x": a="p" (shortest), b="q y r"
            // via "y": a="p x q" (shortest before "y"), b="r"
            const results = matchShortest(grammar, "p x q y r");
            expect(results).toHaveLength(2);
            const xResult = results.find(
                (r: any) => r.a === "p" && r.b === "q y r",
            );
            expect(xResult).toBeDefined();
            const yResult = results.find(
                (r: any) => r.a === "p x q" && r.b === "r",
            );
            expect(yResult).toBeDefined();
        });
    });

    // ---------------------------------------------------------------
    // Nested alternatives: three choices, wildcard before each
    // ---------------------------------------------------------------
    describe("three nested alternatives each get shortest wildcards", () => {
        const g = [
            `<Start> = $(a) <kw> $(b) -> { a, b };`,
            `<kw> = at | in | on;`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("all three alternatives explored with ambiguous input", () => {
            // "meet at noon in the park on tuesday"
            // "at" alt: a="meet", b="noon in the park on tuesday"
            // "in" alt: a="meet at noon", b="the park on tuesday"
            // "on" alt: a="meet at noon in the park", b="tuesday"
            const results = matchShortest(
                grammar,
                "meet at noon in the park on tuesday",
            );
            expect(results).toHaveLength(3);
            expect(
                results.find(
                    (r: any) =>
                        r.a === "meet" && r.b === "noon in the park on tuesday",
                ),
            ).toBeDefined();
            expect(
                results.find(
                    (r: any) =>
                        r.a === "meet at noon" && r.b === "the park on tuesday",
                ),
            ).toBeDefined();
            // "on" is found inside "noon" — the matcher scans for substrings
            expect(
                results.find(
                    (r: any) =>
                        r.a === "meet at no" &&
                        r.b === "in the park on tuesday",
                ),
            ).toBeDefined();
        });
    });

    // ---------------------------------------------------------------
    // Exact match (no ambiguity): works in both modes
    // ---------------------------------------------------------------
    describe("exact match with wildcards consumes all input", () => {
        const g = `<Start> = $(a) plus $(b) -> { a, b };`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("unique delimiter gives one result in both modes", () => {
            const exhaustive = match(grammar, "foo plus bar");
            const shortest = matchShortest(grammar, "foo plus bar");
            expect(exhaustive).toHaveLength(1);
            expect(shortest).toHaveLength(1);
            expect(shortest[0]).toStrictEqual({ a: "foo", b: "bar" });
        });
    });

    // ---------------------------------------------------------------
    // Backtracking with nested alternative: dead end on one alternative,
    // success on longer wildcard for another
    // ---------------------------------------------------------------
    describe("backtracking with nested alternatives", () => {
        // <Start> = $(a) <kw> done
        // <kw> = x | y
        // Input: "foo x bar y done"
        // "x" alt: a="foo" x, then expects "done" but sees "bar" -> dead end
        //   backtrack: a="foo x bar y" x -> no more "x" -> fail
        // "y" alt: a="foo x bar" y done -> success
        const g = [`<Start> = $(a) <kw> done -> { a };`, `<kw> = x | y;`].join(
            "\n",
        );
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("finds match via backtracking to correct alternative", () => {
            const results = matchShortest(grammar, "foo x bar y done");
            expect(results.length).toBeGreaterThanOrEqual(1);
            // "y" alt with a="foo x bar" is the valid match
            expect(results.find((r: any) => r.a === "foo x bar")).toBeDefined();
        });
    });

    // ---------------------------------------------------------------
    // Two top-level rules, both match: independent shortest per rule
    // ---------------------------------------------------------------
    describe("two top-level rules both matching same input", () => {
        // Both rules can match "a x b x c"
        const g = [
            `<Start> = $(p) x $(q) -> { rule: "first", p, q };`,
            `<Start> = $(r) x $(s) -> { rule: "second", r, s };`,
        ].join("\n");
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("both rules return one result each with shortest wildcards", () => {
            const results = matchShortest(grammar, "a x b x c");
            // Both rules match because they have the same structure.
            // Each should return one result with leftmost-shortest.
            expect(results).toHaveLength(2);
            const first = results.find((r: any) => r.rule === "first");
            const second = results.find((r: any) => r.rule === "second");
            expect(first).toStrictEqual({ rule: "first", p: "a", q: "b x c" });
            expect(second).toStrictEqual({
                rule: "second",
                r: "a",
                s: "b x c",
            });
        });
    });

    // ---------------------------------------------------------------
    // Repeat groups are not pruned
    // ---------------------------------------------------------------
    describe("repeat groups survive pruning", () => {
        const g = `<Start> = (hello)+ world -> true;`;
        let grammar: Grammar;
        beforeAll(() => {
            grammar = loadGrammarRules("test.grammar", g);
        });

        it("repeat still works in shortestWildcard mode", () => {
            const exhaustive = match(grammar, "hello hello world");
            const shortest = matchShortest(grammar, "hello hello world");
            expect(exhaustive).toStrictEqual([true]);
            expect(shortest).toStrictEqual([true]);
        });
    });

    // ---------------------------------------------------------------
    // Result uniqueness in default mode: each viable wildcard
    // placement should be emitted exactly once.  Regression guard
    // against the in-place extend-on-success loop in `matchGrammar`
    // double-emitting paths that are also queued via `pending`.
    // ---------------------------------------------------------------
    describe("default mode emits no duplicate results", () => {
        it("two wildcards with multiple anchors each", () => {
            const g = `<Start> = $(a) x $(b) x end -> { a, b };`;
            const grammar = loadGrammarRules("test.grammar", g);
            // Input "a x b x c x end" admits these (a, b) splits:
            //   ("a",         "b x c")
            //   ("a x b",     "c")
            const results = match(grammar, "a x b x c x end");
            const serialized = results.map((r) => JSON.stringify(r));
            expect(new Set(serialized).size).toBe(serialized.length);
            expect(serialized.sort()).toStrictEqual(
                [
                    JSON.stringify({ a: "a", b: "b x c" }),
                    JSON.stringify({ a: "a x b", b: "c" }),
                ].sort(),
            );
        });

        it("wildcard before a nested-rule with alternatives", () => {
            // Sibling MatchStates spawned for nested-rule
            // alternatives must not share ownership of the parent's
            // wildcard-frame chain — otherwise each branch can
            // independently extend to the same successful capture
            // and double-emit the parse.  Single-owner enforcement
            // happens via `cloneMatchState` at the spawn site.
            const g = [
                `<body> = foo bar | bar;`,
                `<Start> = $(a) sep <body> -> { a };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);
            // Only one valid parse: a="a sep foo b" matched via
            // the `bar` alternative.
            const results = match(grammar, "a sep foo b sep bar");
            const serialized = results.map((r) => JSON.stringify(r));
            expect(new Set(serialized).size).toBe(serialized.length);
            expect(serialized).toStrictEqual([
                JSON.stringify({ a: "a sep foo b" }),
            ]);
        });
    });
});
