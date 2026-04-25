// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammarCompletion } from "../src/grammarCompletion.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { expectMetadata } from "./testUtils.js";

// Tests for the `shortestWildcard` option on `matchGrammarCompletion`.
//
// Mirrors `GrammarMatchOptions.shortestWildcard` for the matcher: when
// true, completion only explores the shortest-wildcard match for each
// state.  Longer-wildcard alternatives — which under exhaustive
// matching can surface "spurious" completions for keywords already
// present inside the input — are suppressed.
describe("Grammar Completion - shortestWildcard option", () => {
    describe("wildcard followed by keyword terminator (full input)", () => {
        // Grammar: `<x> hello world` where `hello world` is the keyword
        // terminator.  Input "foo hello world" is ambiguous under
        // exhaustive matching:
        //   - shortest:  wildcard="foo",            terminator="hello world" ✔
        //   - longest:   wildcard="foo hello world", terminator unmatched   ✔
        // The longer-wildcard alternative leaves the keyword unmatched
        // and emits a completion at P=15 (full input) instead of
        // P=3 (back to the wildcard's end).
        const g = `<Start> = $(x) hello\\ world -> x;`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("exhaustive (default): matchedPrefixLength reflects longer-wildcard alternative (P=15)", () => {
            const result = matchGrammarCompletion(grammar, "foo hello world");
            expectMetadata(result, {
                completions: ["hello world"],
                matchedPrefixLength: 15,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "all",
                properties: [],
            });
        });

        it("shortestWildcard: matchedPrefixLength stays at shortest-wildcard match (P=3)", () => {
            const result = matchGrammarCompletion(
                grammar,
                "foo hello world",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            // No longer-wildcard alternative is explored — completion
            // anchors at the shortest match's wildcard end.
            expectMetadata(result, {
                completions: ["hello world"],
                matchedPrefixLength: 3,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "all",
                properties: [],
            });
        });
    });

    describe("two wildcards with keyword separator (full input)", () => {
        // Grammar: `play <name> by <artist>`.  Input
        // "play hello by world" is ambiguous:
        //   - shortest:  name="hello",          artist="world"        ✔
        //   - longest:   name="hello by world", artist unmatched       ✔
        // Under exhaustive, the longer-wildcard alternative emits a
        // spurious "by" completion at P=19 (full input).  Under
        // shortest, only the shortest path is explored, leaving the
        // result at the partial artist-completion path (P=13).
        const g = `<Start> = play $(name) by $(artist) -> { name, artist };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("exhaustive (default): emits spurious 'by' completion from longer-wildcard alternative", () => {
            const result = matchGrammarCompletion(
                grammar,
                "play hello by world",
            );
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 19,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "all",
                properties: [],
            });
        });

        it("shortestWildcard: only the shortest-match artist completion path is taken", () => {
            const result = matchGrammarCompletion(
                grammar,
                "play hello by world",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            // Shortest path: name="hello", "by" matched, artist
            // wildcard captured "world" — the partial-artist
            // completion path emits at P=13 (after "by").
            expectMetadata(result, {
                completions: [],
                matchedPrefixLength: 13,
                closedSet: false,
                directionSensitive: true,
                afterWildcard: "none",
                properties: [
                    {
                        match: { name: "hello" },
                        propertyNames: ["artist"],
                    },
                ],
            });
        });
    });

    describe("partial input — both modes return same partial-match completion", () => {
        // For inputs that don't fully consume to a successful match,
        // shortestWildcard should not change behavior.  There's no
        // successful full match to anchor "shortest" against, so the
        // partial-match completion path is identical.
        const g = `<Start> = play $(name) by $(artist) -> { name, artist };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers 'by' terminator after wildcard text (default and shortestWildcard match)", () => {
            const def = matchGrammarCompletion(grammar, "play hello");
            const shortest = matchGrammarCompletion(
                grammar,
                "play hello",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            expectMetadata(def, {
                completions: ["by"],
                matchedPrefixLength: 10,
                afterWildcard: "all",
            });
            expect(shortest).toEqual(def);
        });
    });

    describe("input ends with literal terminator + trailing separator", () => {
        // Grammar: `play <name> by <artist>`.  Input
        // "play This Train by " (note the trailing space).
        // Under exhaustive, two interpretations are explored:
        //   (1) name="This Train", literal "by" matches, artist
        //       wildcard pending at the trailing space — emits
        //       a property completion for `artist` at P=18.
        //   (2) name="This Train by" (longer wildcard), literal
        //       "by" doesn't match, finalizeState clean (only
        //       trailing separator) — emits a spurious "by"
        //       completion at P=19.
        // shortestWildcard should suppress (2) because (1) has
        // already consumed all meaningful (non-separator) input.
        const g = `<Start> = play $(name) by $(artist) -> { name, artist };`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("exhaustive (default): emits spurious 'by' completion from longer-wildcard alternative", () => {
            const result = matchGrammarCompletion(
                grammar,
                "play This Train by ",
            );
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 18,
                afterWildcard: "all",
            });
        });

        it("shortestWildcard: only artist property completion is offered", () => {
            const result = matchGrammarCompletion(
                grammar,
                "play This Train by ",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            // Shortest path: name="This Train", literal "by"
            // matched, artist wildcard pending at trailing
            // space — only the property completion for artist
            // is emitted; the spurious "by" alternative is
            // suppressed.
            expectMetadata(result, {
                completions: [],
                matchedPrefixLength: 18,
                closedSet: false,
                directionSensitive: true,
                afterWildcard: "none",
                properties: [
                    {
                        match: { name: "This Train" },
                        propertyNames: ["artist"],
                    },
                ],
            });
        });
    });

    describe("optional-skip sibling captures past literal terminator", () => {
        // Multi-alternative rule with an optional `(the)?` between
        // "from" and "album".  Input
        // "play <track> by <artist> from album <album_partial>"
        // produces three pending states:
        //   - A1 (`play <track> by <artist>`): exact match — artist
        //     wildcard captures "Wax Tailor from album", no completion.
        //   - A3 (`play <track> by <artist> from (the)? album <album>`):
        //     - "without the" branch: shorter track interpretation
        //       reaches EOI with album wildcard pending — emits
        //       property completion for album.
        //     - "with the" branch: cannot match (no "the" in input);
        //       finalizeState absorbs the rest into the track wildcard,
        //       leaving partIndex at "from".  Without suppression,
        //       Phase 2's findPartialKeywordInWildcard scans the
        //       captured track text, finds the literal "from" inside,
        //       and re-emits it as a spurious completion.
        // shortestWildcard suppresses the "with the" sibling because
        // its captured wildcard contains the next-part literal.
        const g = `
<Start> = play $(track) by $(artist) -> { track, artist }
        | play $(track) from (the)? album $(album) -> { track, album }
        | play $(track) by $(artist) from (the)? album $(album) -> { track, artist, album };
`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("shortestWildcard: no spurious 'from' completion", () => {
            const result = matchGrammarCompletion(
                grammar,
                "play This Train by Wax Tailor from album ",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            // No string completions — only album property
            // completions from the legitimate shorter-wildcard
            // interpretations of A2 and A3.
            expectMetadata(result, {
                completions: [],
                matchedPrefixLength: 40,
                closedSet: false,
                directionSensitive: true,
                afterWildcard: "none",
            });
            // Two property entries (one per matching rule), both
            // for `album`.
            expect(result.properties).toHaveLength(2);
            expect(
                result.properties!.every((p) =>
                    p.propertyNames.includes("album"),
                ),
            ).toBe(true);
        });
    });

    describe("non-wildcard completion is unaffected by shortestWildcard", () => {
        // Pure keyword grammar — no wildcards at all.  shortestWildcard
        // should be a strict no-op since there are no wildcard frames
        // to abandon.
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
            `<A> = first -> "a";`,
            `<B> = second -> "b";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("default and shortestWildcard return identical results for empty input", () => {
            const def = matchGrammarCompletion(grammar, "");
            const shortest = matchGrammarCompletion(
                grammar,
                "",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            expect(shortest).toEqual(def);
        });

        it("default and shortestWildcard return identical results for partial input", () => {
            const def = matchGrammarCompletion(grammar, "first");
            const shortest = matchGrammarCompletion(
                grammar,
                "first",
                undefined,
                undefined,
                { wildcardPolicy: "shortest" },
            );
            expect(shortest).toEqual(def);
        });
    });
});
