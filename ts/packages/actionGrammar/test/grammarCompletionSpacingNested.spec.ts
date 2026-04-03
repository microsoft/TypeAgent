// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Completion tests for grammars that mix spacing modes across nested rules.
 *
 * The matching path (grammarMatcherSpacingNested.spec.ts) covers how the
 * grammar matches full inputs with mixed spacing modes.  This file covers
 * the COMPLETION path: what completions are offered, what separatorMode
 * values are reported, and how the effective leading spacing mode at
 * nested-rule boundaries affects completion behavior.
 *
 * Key invariant: the separator between a matched prefix and the first
 * completion word should be governed by `leadingSpacingMode` (which walks
 * the parent chain), not the nested rule's own `spacingMode`.  This
 * mirrors how `matchStringPart` in grammarMatcher.ts uses
 * `leadingSpacingMode` for its leading separator regex.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - Mixed Spacing Modes (Nested Rules)",
    (matchGrammarCompletion) => {
        // ================================================================
        // Section 1: Parent spacing=none, nested rule auto (default)
        //
        // The parent rule uses spacing=none, so the flex-space between
        // the parent's first part ("hello") and the nested rule reference
        // allows no separator.  The nested rule's auto mode would
        // normally require a separator between Latin words, but at the
        // *leading edge* of the nested rule the parent's mode governs.
        // ================================================================

        describe("parent spacing=none, nested auto", () => {
            const g = `
                <Suffix> = world -> "w";
                <Start> [spacing=none] = hello $(x:<Suffix>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers nested rule's keyword with separatorMode reflecting parent's none mode", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                // "hello" fully matched.  Next part is the nested rule
                // <Suffix> whose first part is "world".  The separator
                // between "hello" (last char 'o') and "world" (first
                // char 'w') is governed by the parent's spacing=none →
                // separatorMode should be "none".
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("matches partial keyword without separator", () => {
                const result = matchGrammarCompletion(grammar, "hellow");
                // "hellow" → "hello" matched, "w" partially matches "world"
                // in the nested rule.  With spacing=none, no separator is
                // needed — the partial match succeeds.
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("still offers completion despite spurious separator (matchedPrefixLength tells caller where valid input ends)", () => {
                // "hello world" — the space violates spacing=none, but the
                // completion system still reports "world" because it reports
                // completions from the grammar structure.  matchedPrefixLength=5
                // tells the caller that only "hello" was validly consumed.
                const result = matchGrammarCompletion(grammar, "hello world");
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 2: Parent auto (default), nested rule spacing=none
        //
        // The parent uses auto mode, so a separator is required between
        // Latin words.  The nested rule uses spacing=none for its own
        // internal parts, but the leading separator into the nested rule
        // is governed by the parent's auto mode.
        // ================================================================

        describe("parent auto, nested spacing=none", () => {
            const g = `
                <Track> [spacing=none] = ab cd -> "trackname";
                <Start> = play $(x:<Track>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers nested rule's first keyword after separator", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                // "play " → "play" matched, trailing separator consumed.
                // Next is <Track> whose first part is "ab".  Leading
                // separator mode = parent's auto mode (compiles to
                // spacePunctuation; Latin→Latin requires space).
                // But we already have a trailing separator.
                expectMetadata(result, {
                    completions: ["ab"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("matches 'play ab' and offers second keyword in none mode", () => {
                // "play ab" → "play" matched with auto mode, " ab"
                // consumed via leading separator (parent auto allows
                // [\s\p{P}]*? before "ab").  Inside <Track>, "ab" matched.
                // Next part "cd" is an inter-word separator within the
                // none-mode rule → separatorMode = "none".
                const result = matchGrammarCompletion(grammar, "play ab");
                expectMetadata(result, {
                    completions: ["cd"],
                    matchedPrefixLength: 7,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match 'play abcd' backs up to last word (Category 1)", () => {
                // "play abcd" → full match.  Category 1 exact match backs
                // up to the last matched part.  The backup uses the nested
                // rule's spacingMode (saved as matchedSpacingMode on
                // lastMatchedPartInfo) so that the inter-word "none" mode is preserved across
                // finalizeNestedRule's parent-state restoration.
                const result = matchGrammarCompletion(grammar, "play abcd");
                expectMetadata(result, {
                    completions: ["cd"],
                    matchedPrefixLength: 7,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 3: Parent spacing=optional, nested spacing=required
        //
        // The nested rule requires spaces between its own parts, but the
        // leading separator into the nested rule is governed by the
        // parent's optional mode.  Start has a leading keyword "do" so
        // that backward completion always matches the full prefix (avoiding
        // a pre-existing invariant #3 path-dependence when backward backs
        // up across the nested rule boundary).
        // ================================================================

        describe("parent spacing=optional, nested spacing=required", () => {
            // Inner has a single keyword so that backward completion
            // always matches the full prefix (no mid-Inner word boundary
            // to back up across, avoiding a pre-existing invariant #3
            // path-dependence at nested rule boundaries).
            const g = `
                <Inner> [spacing=required] = hello -> "x";
                <Start> [spacing=optional] = do $(x:<Inner>) end -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers nested rule's first keyword with optional separator", () => {
                // "do" matched in Start.  Next part is <Inner> at
                // partIndex 1; the leading separator into Inner uses
                // the parent's optional mode.
                const result = matchGrammarCompletion(grammar, "do");
                expectMetadata(result, {
                    completions: ["hello"],
                    matchedPrefixLength: 2,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("after nested rule, separator to parent's next part uses parent's optional mode", () => {
                // "do hello" completes <Inner>.  Next part "end"
                // is in <Start> with spacing=optional → separator
                // between "hello" (Latin) and "end" (Latin): optional
                // mode says separator not required.
                const result = matchGrammarCompletion(grammar, "do hello");
                expectMetadata(result, {
                    completions: ["end"],
                    matchedPrefixLength: 8,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 4: Deep pass-through chain
        //
        // Mirrors the patterns from grammarMatcherSpacingNested.spec.ts:
        // grandparent optional, parent required (pass-through), grandchild optional.
        // The separator after the pass-through chain should be governed
        // by the grandparent's optional mode.
        // ================================================================

        describe("deep pass-through: grandparent optional, parent required, grandchild optional", () => {
            const g = `
                <Inner> [spacing=optional] = bar -> true;
                <Middle> [spacing=required] = $(x:<Inner>) -> x;
                <Start> [spacing=optional] = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("completion after pass-through uses grandparent's optional mode", () => {
                // "bar" → matched by <Inner>.  <Middle> is a pass-through.
                // Next part "baz" is in <Start> (spacing=optional).
                // The separator between "bar" and "baz" should use
                // the grandparent's optional mode (not Middle's required).
                const result = matchGrammarCompletion(grammar, "bar");
                expectMetadata(result, {
                    completions: ["baz"],
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("matches without separator (grandparent optional allows it)", () => {
                const result = matchGrammarCompletion(grammar, "barbaz");
                // "barbaz" → exact match (optional mode allows no separator).
                expectMetadata(result, {
                    completions: ["baz"],
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("deep pass-through: grandparent required, parent optional, grandchild optional", () => {
            const g = `
                <Inner> [spacing=optional] = bar -> true;
                <Middle> [spacing=optional] = $(x:<Inner>) -> x;
                <Start> [spacing=required] = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("completion after pass-through uses grandparent's required mode", () => {
                const result = matchGrammarCompletion(grammar, "bar");
                expectMetadata(result, {
                    completions: ["baz"],
                    matchedPrefixLength: 3,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 5: 4 levels deep
        // ================================================================

        describe("4 levels: great-grandparent optional, two required pass-through, leaf optional", () => {
            const g = `
                <Leaf> [spacing=optional] = bar -> true;
                <LevelA> [spacing=required] = $(x:<Leaf>) -> x;
                <LevelB> [spacing=required] = $(x:<LevelA>) -> x;
                <Start> [spacing=optional] = $(x:<LevelB>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("completion uses great-grandparent's optional mode past two pass-through levels", () => {
                const result = matchGrammarCompletion(grammar, "bar");
                expectMetadata(result, {
                    completions: ["baz"],
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 6: Property completion at nested rule boundary
        //
        // When a nested rule's first part is a wildcard, the property
        // completion's separatorMode should reflect the parent's mode.
        // ================================================================

        describe("property completion uses parent's spacing mode at nested boundary", () => {
            // Use matching spacing modes (both none) so backward's
            // path-dependent spacingMode matches forward's, avoiding
            // a pre-existing invariant #3 violation.
            const g = `
                <Inner> [spacing=none] = $(name:wildcard) done -> { name };
                <Start> [spacing=none] = go $(x:<Inner>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("property completion uses parent's none mode", () => {
                const result = matchGrammarCompletion(grammar, "go");
                // "go" matched.  Next part is <Inner> whose first part
                // is a wildcard.  The separator is governed by parent's
                // spacing=none → separatorMode should be "none".
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 2,
                    separatorMode: "none",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: {},
                            propertyNames: ["name"],
                        },
                    ],
                });
            });
        });

        // ================================================================
        // Section 7: Backward completion at nested boundary
        // ================================================================

        describe("backward completion at nested boundary respects parent mode", () => {
            const g = `
                <Suffix> = world -> "w";
                <Start> [spacing=none] = hello $(x:<Suffix>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward from 'hellow' uses parent's none mode", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hellow",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8: Mixed modes with alternation
        //
        // Two alternatives with different spacing modes should each
        // produce completions with their own correct separatorMode.
        // ================================================================

        describe("alternation with different spacing modes", () => {
            const g = `
                <RequiredRule> [spacing=required] = hello world -> "required";
                <OptionalRule> [spacing=optional] = hello world -> "optional";
                <Start> = $(x:<RequiredRule>) -> x | $(x:<OptionalRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'world' with merged separator mode from both alternatives", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                // Both alternatives match "hello" and offer "world".
                // Required mode produces spacePunctuation; optional
                // produces optional.  Merge: spacePunctuation wins.
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 9: Wildcard + keyword in spacing=none
        //
        // matchKeywordWordsFrom calls matchWordsGreedily without
        // suppressLeadingSeparator.  When the rule uses spacing=none,
        // the k=0 branch falls through to the optional leading
        // separator regex ([\\s\\p{P}]*?).  Because the quantifier is
        // lazy, it matches zero-width when the keyword immediately
        // follows — so for callers that don't set
        // suppressLeadingSeparator, behavior is equivalent to no
        // separator in practice.
        // ================================================================

        describe("wildcard + keyword in spacing=none", () => {
            const g = `
                <Start> [spacing=none] = $(x:wildcard) done -> { x };
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'done' after wildcard input", () => {
                const result = matchGrammarCompletion(grammar, "abc");
                // "abc" is consumed by the wildcard.  "done" is the
                // next keyword.  In spacing=none, the keyword must
                // abut the wildcard content with no separator.
                expectMetadata(result, {
                    completions: ["done"],
                    matchedPrefixLength: 3,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("partial keyword abutting wildcard matches in none mode", () => {
                // "abcdo" → wildcard absorbs "abc", "do" partially
                // matches "done" with no separator (spacing=none).
                const result = matchGrammarCompletion(grammar, "abcdo");
                expectMetadata(result, {
                    completions: ["done"],
                    matchedPrefixLength: 3,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("wildcard absorbs spurious space in none mode (space not a separator)", () => {
                // "abc do" — in spacing=none, the space is part of the
                // wildcard content.  The wildcard scanning still finds
                // "do" as a partial match of "done".
                // matchedPrefixLength=3 reflects the wildcard end before
                // the keyword candidate start.
                const result = matchGrammarCompletion(grammar, "abc do");
                expectMetadata(result, {
                    completions: ["done"],
                    matchedPrefixLength: 3,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 10: Deferred EOI/wildcard-string path with mixed modes
        //
        // When a wildcard is followed by a string part in a nested rule
        // with mixed spacing modes, the deferred wildcard-string
        // candidate path (post-processing) should still work correctly.
        // ================================================================

        describe("wildcard + string in nested rule with mixed spacing modes", () => {
            // Use matching spacing modes (both none) so backward's
            // path-dependent spacingMode matches forward's.
            const g = `
                <Inner> [spacing=none] = $(x:wildcard) done -> { x };
                <Start> = play $(y:<Inner>) -> y;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'done' after wildcard in nested none-mode rule", () => {
                // "play something" → "play" matched in <Start> (auto),
                // then " something" enters <Inner>.  The wildcard
                // absorbs "something", and "done" is the next keyword.
                const result = matchGrammarCompletion(
                    grammar,
                    "play something",
                );
                expectMetadata(result, {
                    completions: ["done"],
                    matchedPrefixLength: 14,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("partial keyword in nested none-mode rule after wildcard", () => {
                // "play somethingdo" → wildcard absorbs "something",
                // "do" partially matches "done" (no separator, none mode).
                const result = matchGrammarCompletion(
                    grammar,
                    "play somethingdo",
                );
                expectMetadata(result, {
                    completions: ["done"],
                    matchedPrefixLength: 14,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });
    },
);
