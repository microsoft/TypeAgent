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
                // separator mode = parent's auto mode.
                expectMetadata(result, {
                    completions: ["ab"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
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
                    separatorMode: "optionalSpacePunctuation",
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
                    separatorMode: "optionalSpacePunctuation",
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
                    separatorMode: "optionalSpacePunctuation",
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
                    separatorMode: "optionalSpacePunctuation",
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
                    separatorMode: "optionalSpacePunctuation",
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
        // Two alternatives with different spacing modes but no
        // spacing=none rule.  "required" and "optionalSpace" are NOT a
        // true separator conflict — "optionalSpace" is compatible with
        // both trailing-separator states.  The result is a normal
        // merge with the strongest separator mode winning.
        // ================================================================

        describe("alternation with different spacing modes", () => {
            const g = `
                <RequiredRule> [spacing=required] = hello world -> "required";
                <OptionalRule> [spacing=optional] = hello world -> "optionalSpace";
                <Start> = $(x:<RequiredRule>) -> x | $(x:<OptionalRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no conflict: spacePunctuation is strongest merged mode", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                // Both alternatives match "hello" and offer "world".
                // Required mode → spacePunctuation; optional mode →
                // optionalSpacePunctuation.  Per-group: two separate groups.
                expectMetadata(result, {
                    groups: [
                        {
                            completions: ["world"],
                            separatorMode: "spacePunctuation",
                        },
                        {
                            completions: ["world"],
                            separatorMode: "optionalSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 5,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("trailing separator: normal merge, no P advancement", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                // Trailing separator: both alternatives still offer "world".
                // Per-group: two separate groups with their respective modes.
                expectMetadata(result, {
                    groups: [
                        {
                            completions: ["world"],
                            separatorMode: "spacePunctuation",
                        },
                        {
                            completions: ["world"],
                            separatorMode: "optionalSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 5,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8b: spacing=none + default (auto) mixed alternation
        //
        // When a spacing=none rule and a default-spacing rule both
        // match the same prefix, candidates from the none rule need
        // no separator while candidates from the auto rule do.
        // The conflict filter picks the right set based on trailing
        // separator state.
        // ================================================================

        describe("spacing=none + auto mixed alternation", () => {
            const g = `
                <NoneRule> [spacing=none] = ab cd -> "none";
                <AutoRule> = ab cd -> "auto";
                <Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no trailing separator: keeps none-mode completions", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                // Per-group: NoneRule → "none" group, AutoRule → "auto" group.
                // No conflict filtering — both kept.
                expectMetadata(result, {
                    groups: [
                        { completions: ["cd"], separatorMode: "none" },
                        {
                            completions: ["cd"],
                            separatorMode: "autoSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 2,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("trailing separator: keeps requiring completions, P advanced", () => {
                const result = matchGrammarCompletion(grammar, "ab ");
                // Per-group: both kept; no filtering.
                expectMetadata(result, {
                    groups: [
                        { completions: ["cd"], separatorMode: "none" },
                        {
                            completions: ["cd"],
                            separatorMode: "autoSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 2,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8c: Three-way: none + optional + required
        //
        // All three spacing modes produce candidates.  The conflict
        // filter keeps the two-bucket split: requiring vs non-requiring.
        // ================================================================

        describe("three-way: none + optional + required", () => {
            const g = `
                <NoneRule> [spacing=none] = ab cd -> "none";
                <OptRule> [spacing=optional] = ab cd -> "opt";
                <ReqRule> [spacing=required] = ab cd -> "req";
                <Start> = $(x:<NoneRule>) -> x | $(x:<OptRule>) -> x | $(x:<ReqRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no trailing separator: keeps none + optional", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                // Per-group: three separate groups, one per spacing mode.
                expectMetadata(result, {
                    groups: [
                        { completions: ["cd"], separatorMode: "none" },
                        {
                            completions: ["cd"],
                            separatorMode: "optionalSpacePunctuation",
                        },
                        {
                            completions: ["cd"],
                            separatorMode: "spacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 2,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("trailing separator: keeps optional + required, drops none, P advanced", () => {
                const result = matchGrammarCompletion(grammar, "ab ");
                // Per-group: three groups kept; no filtering.
                expectMetadata(result, {
                    groups: [
                        { completions: ["cd"], separatorMode: "none" },
                        {
                            completions: ["cd"],
                            separatorMode: "optionalSpacePunctuation",
                        },
                        {
                            completions: ["cd"],
                            separatorMode: "spacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 2,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8d: No conflict — same spacing modes
        //
        // When all alternatives use the same spacing mode, no conflict
        // is detected and behavior is unchanged from before the fix.
        // ================================================================

        describe("no conflict: both required", () => {
            const g = `
                <RuleA> [spacing=required] = hello world -> "a";
                <RuleB> [spacing=required] = hello world -> "b";
                <Start> = $(x:<RuleA>) -> x | $(x:<RuleB>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no conflict: spacePunctuation, closedSet true", () => {
                const result = matchGrammarCompletion(grammar, "hello");
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

        describe("no conflict: both optional", () => {
            const g = `
                <RuleA> [spacing=optional] = hello world -> "a";
                <RuleB> [spacing=optional] = hello world -> "b";
                <Start> = $(x:<RuleA>) -> x | $(x:<RuleB>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no conflict: optionalSpacePunctuation, closedSet true", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expectMetadata(result, {
                    completions: ["world"],
                    matchedPrefixLength: 5,
                    separatorMode: "optionalSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("no conflict: both none", () => {
            const g = `
                <RuleA> [spacing=none] = hello world -> "a";
                <RuleB> [spacing=none] = hello world -> "b";
                <Start> = $(x:<RuleA>) -> x | $(x:<RuleB>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("no conflict: none, closedSet true", () => {
                const result = matchGrammarCompletion(grammar, "hello");
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
        // Section 8e: Single spacing=none with trailing separator
        //
        // With only one spacing=none rule (no mixed modes), the shadow
        // candidate is harmlessly discarded because no other rule
        // can establish a higher maxPrefixLength.  Backward correctly
        // backs up to the last multi-word boundary without interference.
        // ================================================================

        describe("single none rule: backward backup without mixed modes", () => {
            const g = `
                <NoneRule> [spacing=none] = ab cd -> "none";
                <Start> = $(x:<NoneRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward without trailing sep: P=2, completion='cd'", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                expectMetadata(result, {
                    completions: ["cd"],
                    matchedPrefixLength: 2,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward without trailing sep: backs up to P=0, offers 'ab'", () => {
                // Backward reconsiders the last matched word "ab".
                // Without a second rule pushing maxPrefixLength higher,
                // the backed-up P=0 candidate wins.
                // separatorMode is "autoSpacePunctuation" because at P=0 the
                // separator between cursor and completion is governed
                // by the parent Start rule (auto spacing), not
                // NoneRule's internal spacing.
                const result = matchGrammarCompletion(
                    grammar,
                    "ab",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["ab"],
                    matchedPrefixLength: 0,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("forward with trailing sep: P=2, completion='cd' (space is trailing junk in none mode)", () => {
                // In spacing=none, finalizeState rejects trailing space.
                // Category 3b still collects the partial match at P=2.
                const result = matchGrammarCompletion(grammar, "ab ");
                expectMetadata(result, {
                    completions: ["cd"],
                    matchedPrefixLength: 2,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward with trailing sep: backs up to P=0, offers 'ab'", () => {
                // In backward mode, couldBackUp=true (spacing=none,
                // matchedWords>0) causes the NoneRule to back up past
                // "ab" to P=0.  No second rule exists to establish a
                // higher maxPrefixLength, so the shadow candidate
                // (consumedLength=2) is NOT flushed.  P=0 wins.
                // separatorMode is "optionalSpace" (same as above — parent
                // Start rule's auto spacing at P=0).
                const result = matchGrammarCompletion(
                    grammar,
                    "ab ",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["ab"],
                    matchedPrefixLength: 0,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8f: Two none-mode rules with different word counts
        //
        // The shadow candidate is needed even WITHOUT mixed separator
        // modes.  When two none-mode rules match different numbers of
        // words, backward's couldBackUp causes them to land at
        // different P values.  The longer-matching rule establishes
        // maxPrefixLength, discarding the shorter rule's backed-up
        // candidate.  Without the shadow, the shorter rule's
        // forward-equivalent candidate at that P is lost.
        // ================================================================

        describe("two none-mode rules: different word counts (no mixed modes)", () => {
            const g = `
                <Short> [spacing=none] = ab cd -> "short";
                <Long> [spacing=none] = ab ef gh -> "long";
                <Start> = $(x:<Short>) -> x | $(x:<Long>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'ab': both rules offer completions at P=2", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                // Both rules match "ab" (1 word each).
                // Short offers "cd", Long offers "ef" — both at P=2.
                expectMetadata(result, {
                    completions: ["cd", "ef"],
                    matchedPrefixLength: 2,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("forward 'abef': Long matches 2 words, P=4, only 'gh'", () => {
                // Long: matchWordsGreedily matches "ab"+"ef" → P=4, offers "gh".
                // Short: matchWordsGreedily matches "ab" → P=2, offers "cd".
                // P=4 wins, Short's candidate discarded.
                const result = matchGrammarCompletion(grammar, "abef");
                expectMetadata(result, {
                    completions: ["gh"],
                    matchedPrefixLength: 4,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward 'abef': Long backs up to P=2, shadow preserves Short's 'cd'", () => {
                // Long: matchedWords=2, couldBackUp → backs up to P=2, offers "ef".
                // Short: matchedWords=1, couldBackUp → backs up to P=0, offers "ab".
                // Long establishes maxPrefixLength=2.
                //
                // Without the shadow: Short's P=0 is discarded, and its
                // forward-equivalent P=2 "cd" was never collected → WRONG
                // (forward("ab") has both "cd" and "ef").
                //
                // With the shadow: Short's deferred shadow has
                // consumedLength=2 which matches maxPrefixLength → flushed,
                // adding "cd".  Result matches forward("ab").
                const result = matchGrammarCompletion(
                    grammar,
                    "abef",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["ef", "cd"],
                    matchedPrefixLength: 2,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8g: Default spacing — no asymmetric backup
        //
        // With default (auto) spacing, separators between words are
        // required (for word-char boundaries).  The presence of a
        // separator at the match point makes couldBackUp=false for
        // the shorter rule, so both rules land at the same P.  The
        // shadow candidate is still collected but never flushed
        // because maxPrefixLength matches the longer rule's backup P,
        // which equals the shorter rule's forward P.
        //
        // This proves the bug is specific to spacing modes that allow
        // zero-width word boundaries (none, optional).
        // ================================================================

        describe("default spacing: no asymmetric backup (different word counts)", () => {
            const g = `
                <Short> = ab cd -> "short";
                <Long> = ab ef gh -> "long";
                <Start> = $(x:<Short>) -> x | $(x:<Long>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'ab ef': Long at P=5, only 'gh'", () => {
                // Short: matchWordsGreedily matches "ab" (1 word) → P=2.
                // Long: matchWordsGreedily matches "ab"+"ef" (2 words) → P=5.
                // P=5 wins, Short discarded.
                const result = matchGrammarCompletion(grammar, "ab ef");
                expectMetadata(result, {
                    completions: ["gh"],
                    matchedPrefixLength: 5,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward 'ab ef': Long backs up to P=2, Short also at P=2", () => {
                // Long: matchedWords=2, couldBackUp=true (EOI) → P=2, offers "ef".
                // Short: matchedWords=1, trailing sep " " at endIndex=2 →
                //   nextNonSep("ab ef", 2) = 3 ≠ 2 → couldBackUp=false.
                //   Forward path: P=2, offers "cd".
                // Both at P=2 — no asymmetry, both completions present.
                const result = matchGrammarCompletion(
                    grammar,
                    "ab ef",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["cd", "ef"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("forward 'ab': both at P=2, offers cd + ef", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                expectMetadata(result, {
                    completions: ["cd", "ef"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward 'ab': both back up equally to P=0", () => {
                // Both rules match 1 word "ab" → nextNonSep("ab",2)=2
                // → couldBackUp=true for both → both back up to P=0.
                // No asymmetry.
                const result = matchGrammarCompletion(
                    grammar,
                    "ab",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["ab"],
                    matchedPrefixLength: 0,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8h: spacing=optional — asymmetric backup (like none)
        //
        // With spacing=optional, separators between words are optional,
        // so "abef" can match "ab"+"ef" with zero-width separator.
        // This allows asymmetric backups identical to spacing=none.
        // ================================================================

        describe("optional spacing: asymmetric backup (different word counts)", () => {
            const g = `
                <Short> [spacing=optional] = ab cd -> "short";
                <Long> [spacing=optional] = ab ef gh -> "long";
                <Start> = $(x:<Short>) -> x | $(x:<Long>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'abef': Long at P=4, only 'gh'", () => {
                // Long: matches "ab"+"ef" (0-width sep) → P=4.
                // Short: matches "ab" → P=2.  P=4 wins.
                const result = matchGrammarCompletion(grammar, "abef");
                expectMetadata(result, {
                    completions: ["gh"],
                    matchedPrefixLength: 4,
                    separatorMode: "optionalSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("forward 'ab': both at P=2", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                expectMetadata(result, {
                    completions: ["cd", "ef"],
                    matchedPrefixLength: 2,
                    separatorMode: "optionalSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward 'abef': Long backs up to P=2, shadow restores Short's 'cd'", () => {
                // Long: matchedWords=2, couldBackUp (EOI) → P=2, offers "ef".
                // Short: matchedWords=1, couldBackUp (nextNonSep=2=endIndex) →
                //   P=0, offers "ab".  Discarded by Long's maxPrefixLength=2.
                // Shadow: Short's forward candidate at consumedLength=2
                //   matches maxPrefixLength → flushed with "cd".
                const result = matchGrammarCompletion(
                    grammar,
                    "abef",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["ef", "cd"],
                    matchedPrefixLength: 2,
                    separatorMode: "optionalSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8i: Default (auto) spacing with punctuation/digit
        //   boundary — zero-width separator allowed
        //
        // In auto mode, requiresSeparator returns false when adjacent
        // chars cross a word-boundary script boundary (e.g. letter →
        // digit).  This allows "ab1ef" to match "ab" + "1ef" with
        // zero-width separator, creating the same asymmetric backup as
        // spacing=none or spacing=optional.
        // ================================================================

        describe("default spacing: punctuation boundary allows zero-width sep", () => {
            // "1cd" starts with a digit, so "ab" → "1cd" gets * (optional)
            // separator in auto mode.  "1ef" → "gh" is digit→letter, also *.
            const g = `
                <Short> = ab 1cd -> "short";
                <Long> = ab 1ef gh -> "long";
                <Start> = $(x:<Short>) -> x | $(x:<Long>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'ab': both at P=2", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                expectMetadata(result, {
                    completions: ["1cd", "1ef"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("forward 'ab1ef': Long at P=5, only 'gh'", () => {
                // Long matches "ab"+"1ef" (zero-width sep ok) → P=5.
                // Short matches "ab" → P=2.  P=5 wins.
                const result = matchGrammarCompletion(grammar, "ab1ef");
                expectMetadata(result, {
                    completions: ["gh"],
                    matchedPrefixLength: 5,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward 'ab1ef': Long backs up to P=2, shadow restores Short's '1cd'", () => {
                // Long: matchedWords=2 ("ab"+"1ef"), couldBackUp (EOI) → P=2, offers "1ef".
                // Short: matchedWords=1 ("ab"), nextNonSep("ab1ef",2)=2 (no sep) →
                //   couldBackUp=true → P=0, offers "ab".  Discarded.
                // Shadow: Short's forward candidate at consumedLength=2
                //   matches maxPrefixLength → flushed with "1cd".
                const result = matchGrammarCompletion(
                    grammar,
                    "ab1ef",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["1ef", "1cd"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 8j: Shadow flush must happen after Phase 2, not Phase 1
        //
        // When a wildcard-at-EOI rule is deferred to Phase 2, Phase 2 may
        // advance maxPrefixLength (e.g. finding a partial keyword inside
        // the wildcard for backward mode).  If the shadow flush runs at
        // the end of Phase 1 (before Phase 2), the shadow's consumedLength
        // won't match the not-yet-advanced maxPrefixLength and the
        // shadow is wrongly discarded.
        //
        // This test uses:
        //   WildcardRule: $(x:wildcard) done — Phase 2 finds partial keyword
        //     "do" at position 2 for backward("abdo"), advancing P to 2
        //   NoneRule: ab cd — Cat 3b backward backs up to P=0, shadow
        //     at consumedLength=2
        //
        // If the flush is too early, backward("abdo") lacks "cd".
        // ================================================================

        describe("shadow flush after Phase 2: wildcard partial keyword advances P", () => {
            const g = `
                <WildcardRule> [spacing=none] = $(x:wildcard) done -> { x };
                <NoneRule> [spacing=none] = ab cd -> "none";
                <Start> = $(x:<WildcardRule>) -> x | $(x:<NoneRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'ab': both rules contribute at P=2", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                // NoneRule: Cat 3b → P=2, offers "cd"
                // WildcardRule: wildcard absorbs "ab", EOI deferred →
                //   Phase 2 instantiates "done" at P=2
                expectMetadata(result, {
                    completions: ["cd", "done"],
                    matchedPrefixLength: 2,
                });
            });

            it("backward 'abdo': Phase 2 advances P, shadow flushes 'cd'", () => {
                // NoneRule backward: Cat 3b backs up to P=0 (couldBackUp
                //   in none mode).  Shadow at consumedLength=2 with "cd".
                // WildcardRule backward: Cat 2 backs up to wildcard
                //   start=0.  Deferred to Phase 2.
                // Phase 1 ends: maxPrefixLength=0.
                //
                // Phase 2: findPartialKeywordInWildcard finds "do" at
                //   position 2 → updateMaxPrefixLength(2).  Clears
                //   Phase 1 fixedCandidates.  Pushes "done" at P=2.
                //
                // Shadow flush (in Phase 2): consumedLength(2) matches
                //   maxPrefixLength(2) → "cd" flushed into
                //   fixedCandidates.
                //
                // Without the fix (flush at end of Phase 1):
                //   consumedLength(2) ≠ maxPrefixLength(0) → shadow
                //   discarded → "cd" missing.
                const result = matchGrammarCompletion(
                    grammar,
                    "abdo",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["done", "cd"],
                    matchedPrefixLength: 2,
                });
            });
        });

        // ================================================================
        // Section 8k: Phase 2 flush timing with default (no explicit) spacing
        //
        // Same scenario as 8j but without [spacing=none].  Uses a
        // digit-starting keyword ("1cd", "1done") so auto mode allows
        // zero-width separator at the letter→digit boundary, creating
        // the couldBackUp=true condition needed for the shadow.
        // ================================================================

        describe("shadow flush after Phase 2: default spacing with digit boundary", () => {
            const g = `
                <WildcardRule> = $(x:wildcard) 1done -> { x };
                <KeywordRule> = ab 1cd -> "kw";
                <Start> = $(x:<WildcardRule>) -> x | $(x:<KeywordRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'ab': both rules contribute at P=2", () => {
                const result = matchGrammarCompletion(grammar, "ab");
                expectMetadata(result, {
                    completions: ["1cd", "1done"],
                    matchedPrefixLength: 2,
                });
            });

            it("backward 'ab1do': Phase 2 advances P, shadow flushes '1cd'", () => {
                // KeywordRule backward: Cat 3b, matchedWords=1 ("ab"),
                //   nextNonSep("ab1do",2)=2 → couldBackUp=true →
                //   backs up to P=0.  Shadow at consumedLength=2.
                // WildcardRule backward: wildcard absorbs "ab1do",
                //   deferred to Phase 2.
                // Phase 2: finds "1do" as partial of "1done" at position 2
                //   → advances maxPrefixLength from 0 to 2.
                // Shadow flush: consumedLength(2)=maxPrefixLength(2)
                //   → "1cd" flushed.
                const result = matchGrammarCompletion(
                    grammar,
                    "ab1do",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["1done", "1cd"],
                    matchedPrefixLength: 2,
                });
            });
        });

        // ================================================================
        // Section 8l: Cat 2 backward with nested rule — no missing candidate
        //
        // Cat 2 backward only calls tryCollectBackwardCandidate when
        // hasPartToReconsider is true (lastMatchedPartInfo or pending
        // wildcard exists).  When the matched part is inside a nested
        // rule, the parent state's lastMatchedPartInfo is NOT set
        // (matching happened in the child), so hasPartToReconsider
        // is false and Cat 2 takes the forward path — correctly
        // collecting the next unmatched part.
        // ================================================================

        describe("Cat 2 backward with nested rule: forward path taken", () => {
            const g = `
                <Inner> = hello -> "inner";
                <RuleA> = $(x:<Inner>) world -> x;
                <RuleB> = hello there -> "b";
                <Start> = $(x:<RuleA>) -> x | $(x:<RuleB>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward 'hello ': both rules at P=5", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                expectMetadata(result, {
                    completions: ["world", "there"],
                    matchedPrefixLength: 5,
                });
            });

            it("backward 'hello ': Cat 2 takes forward path, both completions present", () => {
                // RuleA Cat 2: lastMatchedPartInfo is undefined (match
                //   happened in nested <Inner>) → hasPartToReconsider=false
                //   → takes forward path → collects "world" at P=5.
                // RuleB Cat 3b: P=5, "there".
                // Both completions are present — no missing candidate.
                const result = matchGrammarCompletion(
                    grammar,
                    "hello ",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["world", "there"],
                    matchedPrefixLength: 5,
                });
            });
        });

        // ================================================================
        // Section 8m: closedSet after EOI clear+anchor with conflict
        //
        // When separator conflict filtering drops candidates
        // (droppedCandidates=true) and the forward EOI clear+anchor
        // block fires (displacing maxPrefixLength to a higher
        // position), the clear+anchor resets closedSet=true.  The
        // droppedCandidates→closedSet=false override must run AFTER
        // clear+anchor so it applies to the final state.
        //
        // Grammar: NoneRule + AutoRule create a conflict at P;
        // WildcardRule produces a wildcard-at-EOI descriptor whose
        // partial keyword displaces P to a higher anchor.
        // ================================================================

        describe("closedSet forced false after EOI clear+anchor with conflict", () => {
            const g = `
                <NoneRule> [spacing=none] = ab cd -> "none";
                <AutoRule> = ab cd -> "auto";
                <WildcardRule> = ab $(w:string) cd -> w;
                <Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x | $(x:<WildcardRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("separator conflict + EOI displace: droppedCandidates reset", () => {
                // Phase 1:
                //   NoneRule Cat 3b: "cd" at P=2, spacingMode=none
                //   AutoRule Cat 3b: "cd" at P=2, spacingMode=auto (spacePunctuation)
                //   WildcardRule: wildcard captures to EOI → wildcardEoiDescriptor
                //
                // Conflict: none + spacePunctuation at P=2.
                // Trailing sep at P=2 (' ') → drop none, keep requiring.
                // P advances to 3. droppedCandidates=true.
                //
                // Phase 2: findPartialKeywordInWildcard finds "c" as
                //   prefix of "cd" at position 7 → forwardPartialKeyword.
                //
                // Phase 2 (EOI injection): anchor stripped to 6. clear+anchor resets
                //   closedSet=true AND droppedCandidates=false (the
                //   Phase 1 conflict is stale at the displaced P).
                //   Partial keyword "cd" added with no new conflict.
                //
                // Result must match completion("ab foo", forward)
                // (invariant #3: result at P is a function of
                // input[0..P] alone).
                const result = matchGrammarCompletion(grammar, "ab foo c");
                expectMetadata(result, {
                    completions: ["cd"],
                    matchedPrefixLength: 6,
                    closedSet: true,
                    afterWildcard: "all",
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
