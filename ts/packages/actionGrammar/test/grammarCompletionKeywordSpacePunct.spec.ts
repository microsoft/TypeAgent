// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Completion tests for keywords containing explicit (escaped) spaces
 * and/or punctuation characters.
 *
 * The matching path (grammarMatcherKeywordSpacePunct.spec.ts) covers
 * how the grammar matches full inputs with these keywords.  This file
 * covers the COMPLETION path: what completions are offered, what
 * matchedPrefixLength and separatorMode values are reported, and how
 * backward direction interacts with these keywords.
 *
 * Ignores NFA/DFA variants — grammar matcher only.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - Keywords with Space/Punctuation",
    (matchGrammarCompletion) => {
        // ================================================================
        // Section 1: Punctuation at end of segment in multi-word keyword
        //   Grammar: `hello, world` → segments ["hello,", "world"]
        // ================================================================

        describe("completion for keyword with trailing punctuation segment", () => {
            const g = `<Start> = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello,"]);
                // Empty input: no prior match to reconsider → not direction-sensitive
                // Keyword-only grammar → exhaustive
                // No wildcards → position is definite
                // Empty input → first keyword offered; separator before "hello,"
                // is N/A (no prior char). separatorMode reflects the gap
                // between matchedPrefixLength and the completion text.
                // At position 0 with no prior char, auto mode: "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers first segment for partial prefix 'hel'", () => {
                const result = matchGrammarCompletion(grammar, "hel");
                expect(result.completions).toEqual(["hello,"]);
                // Category 3b (dirty partial): "hel" partially matches "hello,".
                // Prefix-filter match → directionSensitive = false
                // mpl=0, no prior char → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after first segment typed", () => {
                // "hello," typed → first word matched fully
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.completions).toEqual(["world"]);
                // "hello," fully matched, no trailing separator.
                // Backward would back up; forward advances. → direction-sensitive
                // requiresSeparator(",", "w", auto) → comma is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after first segment + space", () => {
                const result = matchGrammarCompletion(grammar, "hello, ");
                expect(result.completions).toEqual(["world"]);
                // Trailing space commits the match → both directions same
                // Trailing separator consumed → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode: comma-ending word before Latin word", () => {
                // After "hello," the next char is "w" (Latin).
                // requiresSeparator(",", "w", auto) → false (comma not word-boundary)
                // → separatorMode should be "optional"
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.separatorMode).toBe("optional");
            });

            it("no completions for exact match", () => {
                const result = matchGrammarCompletion(grammar, "hello, world");
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment for partial second word 'wor'", () => {
                const result = matchGrammarCompletion(grammar, "hello, wor");
                expect(result.completions).toEqual(["world"]);
                // Category 3b: "wor" partially matches "world" → prefix-filter
                // requiresSeparator(",", "w", auto) → comma is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 2: Punctuation at start of second segment
        //   Grammar: `hello ,world` → segments ["hello", ",world"]
        // ================================================================

        describe("completion for keyword with leading punctuation segment", () => {
            const g = `<Start> = hello ,world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after 'hello'", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual([",world"]);
                // "hello" fully matched, no trailing sep → direction-sensitive
                // requiresSeparator("o", ",", auto) → comma is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode: Latin word before comma-starting word", () => {
                // After "hello" the next char is "," (punctuation).
                // requiresSeparator("o", ",", auto) → false (comma not word-boundary)
                // → separatorMode should be "optional"
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.separatorMode).toBe("optional");
            });

            it("offers second segment after 'hello '", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual([",world"]);
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("no completions for exact match", () => {
                const result = matchGrammarCompletion(grammar, "hello,world");
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 3: Standalone punctuation segment
        //   Grammar: `hello . world` → segments ["hello", ".", "world"]
        // ================================================================

        describe("completion for standalone punctuation segment", () => {
            const g = `<Start> = hello . world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers dot segment after 'hello'", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual(["."]);
                // "hello" fully matched, no trailing sep → direction-sensitive
                // requiresSeparator("o", ".", auto) → dot is punct → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello.'", () => {
                const result = matchGrammarCompletion(grammar, "hello.");
                expect(result.completions).toEqual(["world"]);
                // "hello." two segments matched, no trailing sep → direction-sensitive
                // requiresSeparator(".", "w", auto) → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello . '", () => {
                const result = matchGrammarCompletion(grammar, "hello . ");
                expect(result.completions).toEqual(["world"]);
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 8,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("no completions for exact match", () => {
                const result = matchGrammarCompletion(grammar, "hello . world");
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 4: Escaped space keyword (single segment with space)
        //   Grammar: `hello\ world` → segment ["hello world"]
        // ================================================================

        describe("completion for escaped-space keyword (single segment)", () => {
            const g = `<Start> = hello\\ world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello world' for partial prefix 'hel'", () => {
                const result = matchGrammarCompletion(grammar, "hel");
                expect(result.completions).toEqual(["hello world"]);
                // 3b dirty partial with prefix-filter → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello world' for partial prefix 'hello '", () => {
                // "hello " is partial match of single segment "hello world"
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello world' for partial prefix 'hello w'", () => {
                const result = matchGrammarCompletion(grammar, "hello w");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after full 'hello world' typed", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.completions).toEqual(["next"]);
                // "hello world" fully matched as single segment, no trailing sep
                // → direction-sensitive
                // requiresSeparator("d", "n", auto) → both Latin → true → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello world '", () => {
                const result = matchGrammarCompletion(grammar, "hello world ");
                expect(result.completions).toEqual(["next"]);
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("no completions for exact match", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello world next",
                );
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 16,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 5: Escaped space creating multi-segment keyword
        //   Grammar: `hello\  world` (escaped space + flex space)
        //   → segments ["hello ", "world"]
        // ================================================================

        describe("completion for escaped-space + flex-space (multi-segment)", () => {
            const g = `<Start> = hello\\  world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment 'hello ' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello "]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello ' typed", () => {
                // "hello " fully matches segment "hello "
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual(["world"]);
                // "hello " fully matched, no trailing sep → direction-sensitive
                // requiresSeparator(" ", "w", auto) → space is not script boundary → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello world' typed", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.completions).toEqual(["next"]);
                // Both segments matched, no trailing sep → direction-sensitive
                // requiresSeparator("d", "n", auto) → both Latin → true → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 5b: Flex-space before literal space (start of segment)
        //   Grammar: `hello \ world next` → segments ["hello", " world"]
        //   (flex-space between "hello" and " world", literal space at
        //    START of second segment)
        //
        //   This is the inverse of Section 5 (literal space at END).
        //   The flex-space regex [\s\p{P}]* sits before the literal
        //   space in " world".  In auto/optional mode the flex-space
        //   can consume zero characters, so a single input space
        //   satisfies the literal.  In required mode the flex-space
        //   [\s\p{P}]+ must match at least one character, stealing
        //   the single input space and leaving the literal unmatched
        //   (so two input spaces are needed).
        // ================================================================

        describe("completion for flex-space before literal-space segment", () => {
            describe("auto mode", () => {
                const g = `<Start> = hello \\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("offers first segment 'hello' for empty input", () => {
                    const result = matchGrammarCompletion(grammar, "");
                    expect(result.completions).toEqual(["hello"]);
                    expectMetadata(result, {
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("offers second segment ' world' after 'hello'", () => {
                    // "hello" fully matches first segment; next is " world"
                    const result = matchGrammarCompletion(grammar, "hello");
                    expect(result.completions).toEqual([" world"]);
                    // "hello" fully matched, no trailing sep → direction-sensitive
                    // requiresSeparator("o", " ", auto) → space is not word-boundary → "optional"
                    expectMetadata(result, {
                        matchedPrefixLength: 5,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("separatorMode after 'hello' before ' world'", () => {
                    // requiresSeparator("o", " ", auto) → " " not word-boundary → false
                    // → separatorMode = "optional"
                    const result = matchGrammarCompletion(grammar, "hello");
                    expect(result.separatorMode).toBe("optional");
                });

                it("offers 'next' after 'hello world' (one space)", () => {
                    // One input space: flex-space zero, literal " world" starts at 5
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                    );
                    expect(result.completions).toEqual(["next"]);
                    // Both segments matched, no trailing sep → direction-sensitive
                    // requiresSeparator("d", "n", auto) → both Latin → "spacePunctuation"
                    expectMetadata(result, {
                        matchedPrefixLength: 11,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("offers 'next' after 'hello  world' (two spaces)", () => {
                    // Two spaces: flex-space gets first, literal " world" gets second
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  world",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expectMetadata(result, {
                        matchedPrefixLength: 12,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("offers ' world' after 'hello ' (trailing space consumed as partial)", () => {
                    // "hello " — does the space get consumed by flex-space
                    // (leaving literal unmatched → completion is " world"),
                    // or matched as the literal space in " world"
                    // (leaving "world" as partial → completion is something else)?
                    // In auto mode flex-space is [\s\p{P}]*  (zero or more),
                    // and the regex is non-greedy, so the space should be
                    // left for the literal " world".
                    const result = matchGrammarCompletion(grammar, "hello ");
                    expect(result.completions).toEqual([" world"]);
                    // Trailing space: consumeTrailingSeparators advances → "optional"
                    // Trailing space commits "hello" → not direction-sensitive
                    expectMetadata(result, {
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("backward direction", () => {
                const g = `<Start> = hello \\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'hello world' backs up to ' world'", () => {
                    // "hello world" matches ["hello", " world"]; no trailing
                    // separator → backward should back up to last segment.
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual([" world"]);
                    // requiresSeparator("o", " ", auto) → "optional"
                    // Backward differs from forward → direction-sensitive
                    expectMetadata(result, {
                        matchedPrefixLength: 5,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'hello world ' commits → offers 'next'", () => {
                    // Trailing space after full match of both segments
                    // commits the match → forward-like behavior.
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["next"]);
                    // Trailing space consumed → "optional"
                    // Trailing space commits → same as forward → not direction-sensitive
                    expectMetadata(result, {
                        matchedPrefixLength: 12,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'hello' backs up to 'hello'", () => {
                    // Only first segment matched, no trailing sep → back up
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["hello"]);
                    // mpl=0 → "optional"
                    // Backed up to start → direction-sensitive
                    expectMetadata(result, {
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'hello ' — space consumed, backs up to ' world'", () => {
                    // "hello " in backward: the space is consumed (either
                    // by flex-space or partial literal " world"), so
                    // matchedPrefixLength is 6.  Backward backs up to
                    // offer " world" as the next segment.
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello ",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual([" world"]);
                    // Trailing space consumed → "optional"
                    // Trailing space commits → not direction-sensitive
                    expectMetadata(result, {
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("directionSensitive is true for 'hello world' (no trailing sep)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "forward",
                    );
                    expect(result.directionSensitive).toBe(true);
                });

                it("directionSensitive is false for 'hello world ' (trailing sep)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "forward",
                    );
                    expect(result.directionSensitive).toBe(false);
                });
            });

            describe("required mode", () => {
                const g = `<Start> [spacing=required] = hello \\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("offers ' world' after 'hello'", () => {
                    const result = matchGrammarCompletion(grammar, "hello");
                    expect(result.completions).toEqual([" world"]);
                    // required mode: requiresSeparator always true → "spacePunctuation"
                    expectMetadata(result, {
                        matchedPrefixLength: 5,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("offers 'next' after 'hello  world' (two spaces)", () => {
                    // Required mode: [\s\p{P}]+ gets first space, literal
                    // " world" gets second space + "world"
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  world",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expectMetadata(result, {
                        matchedPrefixLength: 12,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("optional mode", () => {
                const g = `<Start> [spacing=optional] = hello \\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("offers 'next' after 'hello world' (one space)", () => {
                    // Optional: [\s\p{P}]* can be zero, literal " world" gets the space
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expectMetadata(result, {
                        matchedPrefixLength: 11,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("none mode", () => {
                const g = `<Start> [spacing=none] = hello \\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("offers ' world' after 'hello'", () => {
                    // None mode: no flex-space, literal " world" starts immediately
                    const result = matchGrammarCompletion(grammar, "hello");
                    expect(result.completions).toEqual([" world"]);
                    expectMetadata(result, {
                        matchedPrefixLength: 5,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("offers 'next' after 'hello world' (literal space consumed)", () => {
                    // None mode: no flex-space gap, "hello" + " world" = "hello world"
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                    );
                    expect(result.completions).toEqual(["next"]);
                    // None mode → "none"
                    expectMetadata(result, {
                        matchedPrefixLength: 11,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("separatorMode after ' world' in none mode", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                    );
                    expect(result.separatorMode).toBe("none");
                });
            });
        });

        // ================================================================
        // Section 6: Keyword with hyphen (escaped)
        //   Grammar: `hello\-world next` → segment ["hello-world"] + "next"
        // ================================================================

        describe("completion for escaped-hyphen keyword", () => {
            const g = `<Start> = hello\\-world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello-world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello-world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello-world' for partial 'hello'", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual(["hello-world"]);
                // 3b dirty partial with prefix-filter
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello-world' for partial 'hello-'", () => {
                const result = matchGrammarCompletion(grammar, "hello-");
                expect(result.completions).toEqual(["hello-world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello-world' typed", () => {
                const result = matchGrammarCompletion(grammar, "hello-world");
                expect(result.completions).toEqual(["next"]);
                // Fully matched, no trailing sep → direction-sensitive
                // requiresSeparator("d", "n", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 7: Keyword with colon and space
        //   Grammar: `set: value done` → segments ["set:", "value", "done"]
        // ================================================================

        describe("completion for colon-ending keyword", () => {
            const g = `<Start> = set: value done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'set:' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["set:"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'value' after 'set:'", () => {
                const result = matchGrammarCompletion(grammar, "set:");
                expect(result.completions).toEqual(["value"]);
                // "set:" fully matched, no trailing sep → direction-sensitive
                // requiresSeparator(":", "v", auto) → colon is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'value' after 'set: '", () => {
                const result = matchGrammarCompletion(grammar, "set: ");
                expect(result.completions).toEqual(["value"]);
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after 'set: value'", () => {
                const result = matchGrammarCompletion(grammar, "set: value");
                expect(result.completions).toEqual(["done"]);
                // "value" fully matched, no trailing sep → direction-sensitive
                // requiresSeparator("e", "d", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode: colon-ending word before Latin word", () => {
                // requiresSeparator(":", "v", auto) → false → "optional"
                const result = matchGrammarCompletion(grammar, "set:");
                expect(result.separatorMode).toBe("optional");
            });
        });

        // ================================================================
        // Section 8: Ellipsis segment (multi-char punctuation)
        //   Grammar: `hello ... world` → segments ["hello", "...", "world"]
        // ================================================================

        describe("completion for ellipsis segment", () => {
            const g = `<Start> = hello ... world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers '...' after 'hello'", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual(["..."]);
                // requiresSeparator("o", ".", auto) → dot is punct → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello...'", () => {
                const result = matchGrammarCompletion(grammar, "hello...");
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(".", "w", auto) → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 8,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello ... '", () => {
                const result = matchGrammarCompletion(grammar, "hello ... ");
                expect(result.completions).toEqual(["world"]);
                // Trailing space commits
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 9: Keyword entirely of punctuation
        //   Grammar: `... done` → segments ["..."] + ["done"]
        // ================================================================

        describe("completion for punctuation-only keyword", () => {
            const g = `<Start> = ... done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers '...' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["..."]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after '...'", () => {
                const result = matchGrammarCompletion(grammar, "...");
                expect(result.completions).toEqual(["done"]);
                // "..." fully matched (word 0), no trailing separator →
                // backward would back up → direction-sensitive.
                // Consistent with Latin keyword behavior (e.g., "hello"
                // in grammar "hello done" → directionSensitive=true).
                // requiresSeparator(".", "d", auto) → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on '...' backs up to '...'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "...",
                    undefined,
                    "backward",
                );
                // "..." fully matched, no trailing separator → backward
                // backs up to offer "..." at position 0.
                expect(result.completions).toEqual(["..."]);
                // mpl=0, backward exact match → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after '... '", () => {
                const result = matchGrammarCompletion(grammar, "... ");
                expect(result.completions).toEqual(["done"]);
                // Trailing space commits
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 10: Wildcard before keyword with leading punctuation
        //   Grammar: `$(x) ,done` → wildcard then segments [",done"]
        // ================================================================

        describe("completion: wildcard before keyword starting with punctuation", () => {
            const g = `<Start> = $(x) ,done -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers ',done' after wildcard content", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual([",done"]);
                // Wildcard finalized at EOI, keyword follows → openWildcard
                // Keyword completion → closedSet true
                // Wildcard finalized at EOI → direction-sensitive
                // requiresSeparator("o", ",", auto) → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("offers ',done' after wildcard + space", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual([",done"]);
                // Trailing space consumed by wildcard; wildcard still at EOI
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("matchedPrefixLength includes comma when typed", () => {
                // "hello," — comma starts the keyword
                const result = matchGrammarCompletion(grammar, "hello,d");
                expect(result.completions).toEqual([",done"]);
                // Wildcard absorbs all input → mpl = input length
                // requiresSeparator("d", ",", auto) → comma is punct → "optional"
                // Wildcard to reconsider → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 11: Wildcard after keyword ending with punctuation
        //   Grammar: `hello, $(x)` → segment ["hello,"] then wildcard
        // ================================================================

        describe("completion: wildcard after keyword ending with punctuation", () => {
            const g = `
                entity Name;
                <Start> = hello, $(x:Name) -> { actionName: "test", parameters: { x } };
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers property completion after 'hello,'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.completions).toHaveLength(0);
                // Entity wildcard → closedSet false
                // Keyword matched, wildcard is next (not at EOI boundary) → openWildcard false
                // requiresSeparator(",", "a", auto) → comma is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: true,
                    openWildcard: false,
                });
            });

            it("offers property completion after 'hello, '", () => {
                const result = matchGrammarCompletion(grammar, "hello, ");
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.completions).toHaveLength(0);
                // Trailing space commits
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                });
            });

            it("separatorMode: comma before entity should be 'optional'", () => {
                // requiresSeparator(",", "a", auto) → false → optional
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.separatorMode).toBe("optional");
            });
        });

        // ================================================================
        // Section 12: Wildcard between punctuation-ending and punctuation-starting keywords
        //   Grammar: `hello, $(x) .world`
        // ================================================================

        describe("completion: wildcard between punctuated keywords", () => {
            const g = `<Start> = hello, $(x) .world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers '.world' terminator after wildcard content", () => {
                const result = matchGrammarCompletion(grammar, "hello, foo");
                expect(result.completions).toEqual([".world"]);
                // Wildcard finalized at EOI, keyword follows → openWildcard
                // Keyword completion → closedSet true
                // requiresSeparator("o", ".", auto) → dot is punct → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("offers '.world' terminator after wildcard + space", () => {
                const result = matchGrammarCompletion(grammar, "hello, foo ");
                expect(result.completions).toEqual([".world"]);
                // Trailing space absorbed by wildcard → "optional"
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 13: Backward direction with punctuation keyword
        // ================================================================

        describe("backward direction with trailing punctuation keyword", () => {
            const g = `<Start> = hello, world done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward on 'hello, world' backs up to 'world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, world",
                    undefined,
                    "backward",
                );
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(",", "w", auto) → "optional"
                // Backward differs from forward → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("forward on 'hello, world' offers 'done'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, world",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["done"]);
                // requiresSeparator("d", "d", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'hello,' backs up to 'hello,'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello,",
                    undefined,
                    "backward",
                );
                // "hello," fully matched, no trailing separator → backs up
                expect(result.completions).toEqual(["hello,"]);
                // mpl=0 → "optional"
                // Backed up to start → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'hello, ' (trailing space) commits → forward behavior", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, ",
                    undefined,
                    "backward",
                );
                // Trailing space commits → should offer "world" like forward
                expect(result.completions).toEqual(["world"]);
                // Trailing space consumed → "optional"
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 14: Backward with escaped-space keyword
        // ================================================================

        describe("backward direction with escaped-space keyword", () => {
            const g = `<Start> = hello\\ world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward on 'hello world' backs up to 'hello world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello world",
                    undefined,
                    "backward",
                );
                // "hello world" is one segment — no trailing separator,
                // backward should back up to start
                expect(result.completions).toEqual(["hello world"]);
                // mpl=0 → "optional"
                // Backed up to start → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'hello world ' commits → offers 'next'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello world ",
                    undefined,
                    "backward",
                );
                expect(result.completions).toEqual(["next"]);
                // Trailing space consumed → "optional"
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 15: Multiple alternation with punctuation keywords
        // ================================================================

        describe("alternation with different punctuation keywords", () => {
            const g = `
                <Start> = hello, world -> 1 | hello. world -> 2;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers both first segments for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions.sort()).toEqual(["hello,", "hello."]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello,'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                // Only the comma variant should match
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'hello.'", () => {
                const result = matchGrammarCompletion(grammar, "hello.");
                // Only the dot variant should match
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(".", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 16: Nested rule with punctuation keyword
        // ================================================================

        describe("nested rule with punctuation in keyword", () => {
            const g = `
                <Inner> = hello, world -> "inner";
                <Start> = $(x:<Inner>) done -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello,"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after 'hello,'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after 'hello, world'", () => {
                const result = matchGrammarCompletion(grammar, "hello, world");
                expect(result.completions).toEqual(["done"]);
                // requiresSeparator("d", "d", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 17: Spacing mode interactions with punctuation completion
        // ================================================================

        describe("spacing=required with punctuation keyword completion", () => {
            const g = `<Start> [spacing=required] = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello,"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after 'hello, '", () => {
                // required mode needs explicit separator after "hello,"
                const result = matchGrammarCompletion(grammar, "hello, ");
                expect(result.completions).toEqual(["world"]);
                // Trailing space commits in required mode
                // Trailing space consumed → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode for required spacing after punctuation word", () => {
                // Trailing space triggers consumeTrailingSeparators → "optional"
                const result = matchGrammarCompletion(grammar, "hello, ");
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("spacing=optional with punctuation keyword completion", () => {
            const g = `<Start> [spacing=optional] = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers second segment after 'hello,'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.completions).toEqual(["world"]);
                // optional mode: requiresSeparator always false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode should be 'optional'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("spacing=none with punctuation keyword completion", () => {
            const g = `<Start> [spacing=none] = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello,"]);
                // None mode → "none"
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers second segment after 'hello,'", () => {
                // In none mode, no separator between segments
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.completions).toEqual(["world"]);
                // None mode → "none"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode should be 'none'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.separatorMode).toBe("none");
            });
        });

        // ================================================================
        // Section 18: Escaped space in none mode completion
        // ================================================================

        describe("spacing=none with escaped-space keyword completion", () => {
            const g = `<Start> [spacing=none] = hello\\ world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello world"]);
                // None mode → "none"
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello world'", () => {
                // In none mode, "hello world" directly adjacent to "next"
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.completions).toEqual(["next"]);
                // None mode → "none"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode should be 'none' after escaped-space keyword", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.separatorMode).toBe("none");
            });
        });

        // ================================================================
        // Section 19: Punctuation-only keyword before wildcard
        // ================================================================

        describe("punctuation-only keyword before wildcard", () => {
            const g = `
                entity Name;
                <Start> = ... $(x:Name) -> { actionName: "test", parameters: { x } };
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers '...' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["..."]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers property completion after '...'", () => {
                const result = matchGrammarCompletion(grammar, "...");
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.completions).toHaveLength(0);
                // Entity wildcard → closedSet false
                // requiresSeparator(".", wildcard-first-char, auto) → false → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: true,
                    openWildcard: false,
                });
            });

            it("offers property completion after '... '", () => {
                const result = matchGrammarCompletion(grammar, "... ");
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.completions).toHaveLength(0);
                // Trailing space commits
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                });
            });
        });

        // ================================================================
        // Section 20: Sequence of punctuated keywords
        //   Grammar: `hello, world! thanks.`
        //   → segments ["hello,", "world!", "thanks."]
        // ================================================================

        describe("completion for sequence of punctuated keywords", () => {
            const g = `<Start> = hello, world! thanks. -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello,"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world!' after 'hello,'", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.completions).toEqual(["world!"]);
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'thanks.' after 'hello, world!'", () => {
                const result = matchGrammarCompletion(grammar, "hello, world!");
                expect(result.completions).toEqual(["thanks."]);
                // requiresSeparator("!", "t", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("no completions for exact match", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, world! thanks.",
                );
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 21,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 21: findPartialKeywordInWildcard with punctuation keyword
        // ================================================================

        describe("backward: findPartialKeywordInWildcard with punctuation terminator", () => {
            // When a wildcard absorbs all input, backward checks if the
            // tail of the wildcard content is a partial prefix of the next keyword
            const g = `<Start> = $(x) hello, world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward on 'foo hel' finds partial of 'hello,'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hel",
                    undefined,
                    "backward",
                );
                // findPartialKeywordInWildcard should find "hel" as
                // partial prefix of "hello,"
                expect(result.completions).toEqual(["hello,"]);
                // Wildcard boundary pinned at partial keyword → openWildcard
                // findPartialKeywordInWildcard: position=4 ("hel" starts after " ")
                // requiresSeparator(" ", "h", auto) → "optional"
                // Backward differs from forward → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("forward on 'foo hel' offers 'hello,' at prefix position", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hel",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["hello,"]);
                // Wildcard finalized at EOI → openWildcard
                // Wildcard absorbs all input → mpl = input length
                // requiresSeparator("l", "h", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            // NOTE: Expected behavior under exhaustive matching.
            // The wildcard greedily absorbs "foo hello," including the
            // first keyword word.  matchStringPartWithWildcard requires
            // ALL segments ["hello,", "world"] to match at once, so the
            // partial match (only "hello," present) is not detected.
            // The code falls to Category 2 which offers "hello," (first
            // unmatched word) instead of "world" (second word).
            //
            // TODO: A planned non-exhaustive match mode that stops
            // exploring longer wildcard alternatives once a full match
            // is found would allow this to return ["world"] instead.
            it("forward on 'foo hello,' — exhaustive match offers 'hello,' (longer wildcard absorbs keyword)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hello,",
                    undefined,
                    "forward",
                );
                // Under exhaustive matching: ["hello,"] (wildcard absorbed all input)
                // Under non-exhaustive matching: would be ["world"]
                expect(result.completions).toEqual(["hello,"]);
                // Wildcard absorbs all input → mpl = input length
                // requiresSeparator(",", "h", auto) → comma is punct → "optional"
                // Wildcard to reconsider → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 22: matchWordsGreedily boundary check with punctuation
        // ================================================================

        describe("matchWordsGreedily boundary with punctuation in keyword", () => {
            // When keyword "hello," is matched, isBoundarySatisfied is
            // checked after the comma. Verify this works correctly.
            const g = `<Start> = hello, worldly things -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("partial prefix 'hello, world' still offers 'worldly'", () => {
                // "world" is a partial prefix of "worldly", not a full match
                const result = matchGrammarCompletion(grammar, "hello, world");
                expect(result.completions).toEqual(["worldly"]);
                // 3b dirty partial with prefix-filter
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'things' after 'hello, worldly'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, worldly",
                );
                expect(result.completions).toEqual(["things"]);
                // requiresSeparator("y", "t", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 14,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 23: Escaped comma/punctuation in keyword (identity escape)
        //   Grammar: `hello\,world` → single segment "hello,world"
        // ================================================================

        describe("completion for identity-escaped punctuation (comma)", () => {
            // The parser's identity escape makes "\," → ","
            // But comma is not an expression special char, so it doesn't
            // need escaping. Let's check the parser behavior.
            const g = `<Start> = hello\\,world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello,world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                // "\," identity escape → "," → segment "hello,world"
                expect(result.completions).toEqual(["hello,world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello,world' typed", () => {
                const result = matchGrammarCompletion(grammar, "hello,world");
                expect(result.completions).toEqual(["next"]);
                // requiresSeparator("d", "n", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 24: Keyword "don't" (apostrophe is punctuation)
        //   Grammar: `don't stop` → segments ["don't", "stop"]
        //   (apostrophe is \p{P} punctuation in Unicode)
        // ================================================================

        describe("completion for keyword with apostrophe", () => {
            const g = `<Start> = don't stop -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers first segment for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["don't"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'stop' after \"don't\"", () => {
                const result = matchGrammarCompletion(grammar, "don't");
                expect(result.completions).toEqual(["stop"]);
                // requiresSeparator("t", "s", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode: apostrophe-ending word before Latin word", () => {
                // The apostrophe is inside the segment "don't" — it is NOT the
                // boundary character.  matchedPrefixLength = 5, so the char at
                // prefix[4] is 't' (last char of "don't"), and completionText[0]
                // is 's' (start of "stop").  requiresSeparator("t", "s", auto)
                // → both Latin → true → "spacePunctuation".
                const result = matchGrammarCompletion(grammar, "don't");
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        // ================================================================
        // Section 25: Keyword with regex-special characters
        //   Grammar: `price 1.99$ done` → segments ["price", "1.99$", "done"]
        //   Characters like . and $ need regex escaping
        // ================================================================

        describe("completion for keyword with regex-special characters", () => {
            const g = `<Start> = price 1.99 done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'price' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["price"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers '1.99' after 'price'", () => {
                const result = matchGrammarCompletion(grammar, "price");
                expect(result.completions).toEqual(["1.99"]);
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after 'price 1.99'", () => {
                const result = matchGrammarCompletion(grammar, "price 1.99");
                expect(result.completions).toEqual(["done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 26: closedSet behavior with punctuation keywords
        // ================================================================

        describe("closedSet with punctuation keyword completions", () => {
            const g = `<Start> = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("closedSet is true for keyword-only completions", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.closedSet).toBe(true);
            });

            it("closedSet is true after partial match", () => {
                const result = matchGrammarCompletion(grammar, "hello,");
                expect(result.closedSet).toBe(true);
            });
        });

        // ================================================================
        // Section 27: Trailing separator after punctuation keyword
        //   In auto mode, comma IS a separator character. So "hello,"
        //   ends with a separator. Does the trailing separator logic
        //   count it as committing the match?
        // ================================================================

        describe("trailing separator handling with punctuated keywords", () => {
            const g = `<Start> = play hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'play hello,' offers 'world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play hello,",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'play hello,' — comma part of keyword, not trailing sep", () => {
                // "hello," is one segment whose comma is part of the keyword,
                // not a trailing separator. Backward should back up to "hello,".
                // However, comma IS a separator character ([\s\p{P}]),
                // so the trailing separator check might incorrectly
                // treat it as a commit signal.
                const result = matchGrammarCompletion(
                    grammar,
                    "play hello,",
                    undefined,
                    "backward",
                );
                expect(result.completions).toEqual(["hello,"]);
                // requiresSeparator("y", "h", auto) → both Latin → "spacePunctuation"
                // Backed up to "hello," → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'play hello, ' — space after comma commits", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play hello, ",
                    undefined,
                    "backward",
                );
                // Space after "hello," is a real trailing separator → commits
                expect(result.completions).toEqual(["world"]);
                // Trailing space consumed → "optional"
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 28: Punctuation keyword with parenthesized optional part
        // ================================================================

        describe("optional part before punctuation keyword", () => {
            const g = `<Start> = play (shuffle)? hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers both 'shuffle' and 'hello,' after 'play'", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions.sort()).toEqual(
                    ["hello,", "shuffle"].sort(),
                );
                // "play" fully matched, no trailing sep → direction-sensitive
                // requiresSeparator("y", "h" or "s", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'world' after 'play hello,'", () => {
                const result = matchGrammarCompletion(grammar, "play hello,");
                expect(result.completions).toEqual(["world"]);
                // requiresSeparator(",", "w", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello,' after 'play shuffle'", () => {
                const result = matchGrammarCompletion(grammar, "play shuffle");
                expect(result.completions).toEqual(["hello,"]);
                // requiresSeparator("e", "h", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 29: Separator between wildcard keyword and
        //   punctuation-starting terminator: the flex-space regex
        //   [\s\p{P}]*? might consume the punctuation
        // ================================================================

        describe("wildcard followed by punctuation-only terminator", () => {
            const g = `<Start> = $(x) . -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers '.' terminator after wildcard content", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual(["."]);
                // Wildcard finalized at EOI → openWildcard
                // requiresSeparator("o", ".", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("offers '.' terminator after wildcard + space", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual(["."]);
                // Trailing space absorbed by wildcard → "optional"
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            // NOTE: Expected behavior under exhaustive matching.
            // The exact match (wildcard="hello", dot=".") sets
            // maxPrefixLength=6.  The greedy wildcard alternative
            // (wildcard="hello.", dot unmatched) also reaches Category 2
            // at the same maxPrefixLength=6 and emits "." as a completion.
            //
            // TODO: A planned non-exhaustive match mode that stops
            // exploring longer wildcard alternatives once a full match
            // is found would suppress the spurious "." completion.
            it("exhaustive match: wildcard content + dot still offers '.' (longer wildcard alternative)", () => {
                const result = matchGrammarCompletion(grammar, "hello.");
                // Under exhaustive matching: ["."]
                // Under non-exhaustive matching: would be []
                expect(result.completions).toEqual(["."]);
                // Exhaustive: wildcard absorbed dot → "optional"
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 30: Multi-word keyword where separator has punctuation
        //   Test that matchWordsGreedily handles words containing
        //   punctuation correctly as completion candidates
        // ================================================================

        describe("matchWordsGreedily with punctuation-containing words", () => {
            // Grammar: `v1.0 is released` → segments ["v1.0", "is", "released"]
            const g = `<Start> = v1.0 is released -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'v1.0' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["v1.0"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'is' after 'v1.0'", () => {
                const result = matchGrammarCompletion(grammar, "v1.0");
                expect(result.completions).toEqual(["is"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'released' after 'v1.0 is'", () => {
                const result = matchGrammarCompletion(grammar, "v1.0 is");
                expect(result.completions).toEqual(["released"]);
                // requiresSeparator("s", "r", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 7,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 31: Escaped space keyword as only alternative
        //   (no additional keywords after it)
        // ================================================================

        describe("completion for standalone escaped-space keyword", () => {
            const g = `<Start> = hello\\ world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello world' for partial 'hello '", () => {
                const result = matchGrammarCompletion(grammar, "hello ");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("no completions after exact match 'hello world'", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.completions).toHaveLength(0);
                // Exact match forward: no completion emitted → separatorMode not set
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 32: Partial prefix match with punctuation
        //   When user types "hel" for keyword "hello,", the completion
        //   should still offer "hello,"
        // ================================================================

        describe("partial prefix matching with punctuation keywords", () => {
            const g = `<Start> = hello, world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello,' for partial 'hel'", () => {
                const result = matchGrammarCompletion(grammar, "hel");
                expect(result.completions).toEqual(["hello,"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'hello,' for partial 'hello'", () => {
                // "hello" without comma is partial prefix of "hello,"
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toEqual(["hello,"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 33: Spacing=required with escaped space keyword
        // ================================================================

        describe("spacing=required with escaped-space keyword completion", () => {
            const g = `<Start> [spacing=required] = hello\\ world next -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello world' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'next' after 'hello world'", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.completions).toEqual(["next"]);
                // required mode: requiresSeparator always true → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("separatorMode should be 'spacePunctuation' for required spacing", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        // ================================================================
        // Section 34: directionSensitive flag with punctuation keywords
        // ================================================================

        describe("directionSensitive with punctuation keywords", () => {
            const g = `<Start> = hello, world done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("directionSensitive is true for 'hello, world' (no trailing sep)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, world",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("directionSensitive is false for 'hello, world ' (trailing sep commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello, world ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });
        });

        // ================================================================
        // Section 35: Wildcard followed by escaped-space keyword terminator
        // ================================================================

        describe("wildcard followed by escaped-space keyword terminator", () => {
            const g = `<Start> = $(x) hello\\ world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello world' terminator after wildcard content", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual(["hello world"]);
                // Wildcard finalized at EOI → openWildcard
                // requiresSeparator("o", "h", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("offers 'hello world' after wildcard + space", () => {
                const result = matchGrammarCompletion(grammar, "foo ");
                expect(result.completions).toEqual(["hello world"]);
                // Trailing space absorbed by wildcard → "optional"
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            // NOTE: Expected behavior under exhaustive matching.
            // Same pattern as the punctuation-only terminator:
            // exact match (wildcard="foo", terminator="hello world") at
            // maxPrefixLength=15 coexists with the greedy wildcard
            // alternative (wildcard="foo hello world", terminator unmatched)
            // which also emits at maxPrefixLength=15.
            //
            // TODO: A planned non-exhaustive match mode that stops
            // exploring longer wildcard alternatives once a full match
            // is found would suppress the spurious completion.
            it("exhaustive match: full match still offers 'hello world' (longer wildcard alternative)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hello world",
                );
                // Under exhaustive matching: ["hello world"]
                // Under non-exhaustive matching: would be []
                expect(result.completions).toEqual(["hello world"]);
                // Exhaustive: wildcard absorbed all → requiresSep("d","h") → "spacePunctuation"
                // Wildcard finalized at EOI → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 15,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward finds partial 'hel' in wildcard tail", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hel",
                    undefined,
                    "backward",
                );
                expect(result.completions).toEqual(["hello world"]);
                // Backward partial keyword found in wildcard tail
                // requiresSeparator(" ", "h", auto) → "optional"
                // Backward differs from forward → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 36: Completion text includes punctuation verbatim
        //   When a segment is "hello,", the completion text itself
        //   must be "hello," — punctuation must not be stripped.
        // ================================================================

        describe("completion text preserves punctuation verbatim", () => {
            const g = `<Start> = hello,\\ world done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            // Grammar: hello,\ world → single segment "hello, world"
            // The completion text must include the comma and space.

            it("offers 'hello, world' preserving comma and space", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["hello, world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers 'done' after exact segment match", () => {
                const result = matchGrammarCompletion(grammar, "hello, world");
                expect(result.completions).toEqual(["done"]);
                // requiresSeparator("d", "d", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 37: findPartialKeywordInWildcard — keyword starting
        //   with punctuation segment
        //   Grammar: `$(x) ,world done → x`
        //   Segments: [",world"] — starts with comma (punctuation)
        //   In findPartialKeywordInWildcard, candidateStart-1 must be
        //   a separator. Comma is \p{P} so it IS a separator char,
        //   but the comma here is part of the keyword, not a
        //   delimiter. The function scans right-to-left; when the
        //   keyword itself starts with punctuation, the leading
        //   punctuation is NOT a separator between wildcard and
        //   keyword — it's part of the keyword text.
        // ================================================================

        describe("findPartialKeywordInWildcard — keyword starting with punctuation", () => {
            const g = `<Start> = $(x) ,world done -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers ',world' after wildcard", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual([",world"]);
                // Wildcard absorbs all input → mpl = input length
                // requiresSeparator("o", ",", auto) → "optional"
                // Wildcard to reconsider → direction-sensitive
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo ,wor' finds partial of ',world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo ,wor",
                    undefined,
                    "backward",
                );
                // ",wor" is a partial prefix of ",world"
                // candidateStart at position 4 (the comma) — prefix[3]=" " is separator ✓
                expect(result.completions).toEqual([",world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo,wor' — no explicit separator before comma", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo,wor",
                    undefined,
                    "backward",
                );
                // In auto mode, requiresSeparator("o", ",", auto) → false
                // (comma is not a word-boundary script), so no separator is
                // needed between wildcard content and keyword. The comma
                // at candidateStart=3 is accepted, and ",wor" is a partial
                // prefix of ",world".
                expect(result.completions).toEqual([",world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("forward on 'foo ,world' offers 'done' after matched keyword", () => {
                const result = matchGrammarCompletion(grammar, "foo ,world");
                // Wildcard captures "foo", ",world" matched → next is "done"
                // But under exhaustive matching, wildcard may also
                // absorb ",world" → still offers ",world"
                expect(result.completions.sort()).toEqual(
                    expect.arrayContaining([",world"]),
                );
                // Wildcard absorbs all input → mpl = input length
                // requiresSeparator("d", ",", auto) → "optional"
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 38: findPartialKeywordInWildcard — keyword is a
        //   standalone punctuation segment followed by a word
        //   Grammar: `$(x) , world done → x`
        //   Segments: [",", "world"] — first segment is pure punctuation
        // ================================================================

        describe("findPartialKeywordInWildcard — punctuation-only first segment", () => {
            const g = `<Start> = $(x) , world done -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers ','", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual([","]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo ,' finds full match of ',' → offers 'world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo ,",
                    undefined,
                    "backward",
                );
                // "," is a full match of the first word → next word is "world"
                expect(result.completions).toEqual(["world"]);
                // Full match of "," → next word "world" offered at mpl=5
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 39: findPartialKeywordInWildcard — keyword with
        //   escaped space at beginning (literal space in segment)
        //   Grammar: `$(x) \ done next → x`
        //   Segments: [" done"] — starts with literal space
        //   The partial keyword text " do" would start with a space,
        //   which is itself a separator char. This is an unusual edge
        //   case where the keyword segment begins with a character
        //   that would normally be a separator.
        // ================================================================

        describe("findPartialKeywordInWildcard — keyword segment starting with escaped space", () => {
            const g = `<Start> = $(x) \\ done next -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers ' done'", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual([" done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo do' — ' done' starts with literal space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo do",
                    undefined,
                    "backward",
                );
                // In auto mode, requiresSeparator("o", " ", auto) → false
                // (space is not a word-boundary script), so no separator is
                // needed. candidateStart=3 (the space) is accepted.
                // textToCheck=" do" is a partial prefix of " done".
                expect(result.completions).toEqual([" done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 40: findPartialKeywordInWildcard — keyword with
        //   escaped space at end (literal trailing space in segment)
        //   Grammar: `$(x) hello\  done → x`
        //   Segments: ["hello "] — single segment ending with literal space
        // ================================================================

        describe("findPartialKeywordInWildcard — keyword segment ending with escaped space", () => {
            const g = `<Start> = $(x) hello\\  done -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers 'hello '", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual(["hello "]);
                // requiresSeparator("o", "h", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo hel' finds partial of 'hello '", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hel",
                    undefined,
                    "backward",
                );
                // "hel" is partial prefix of "hello " (segment includes
                // trailing space)
                expect(result.completions).toEqual(["hello "]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 41: findPartialKeywordInWildcard — keyword with
        //   escaped punctuation at beginning
        //   Grammar: `$(x) \-done next → x`
        //   Segments: ["-done"] — starts with literal hyphen/dash
        // ================================================================

        describe("findPartialKeywordInWildcard — keyword starting with escaped hyphen", () => {
            const g = `<Start> = $(x) \\-done next -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers '-done'", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual(["-done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo -do' finds partial of '-done'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo -do",
                    undefined,
                    "backward",
                );
                // "-do" partially matches "-done". candidateStart at
                // position 4 ("-"): prefix[3]=" " is separator ✓
                expect(result.completions).toEqual(["-done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo-do' — hyphen starts keyword, no separator needed", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo-do",
                    undefined,
                    "backward",
                );
                // In auto mode, requiresSeparator("o", "-", auto) → false
                // (hyphen is not a word-boundary script), so no separator is
                // needed. candidateStart=3 (the hyphen) is accepted.
                // "-do" is a partial prefix of "-done".
                expect(result.completions).toEqual(["-done"]);
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 42: findPartialKeywordInWildcard — keyword with
        //   escaped punctuation at end
        //   Grammar: `$(x) done\! next → x`
        //   Segments: ["done!"] — ends with literal exclamation
        // ================================================================

        describe("findPartialKeywordInWildcard — keyword ending with escaped exclamation", () => {
            const g = `<Start> = $(x) done\\! next -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'foo' offers 'done!'", () => {
                const result = matchGrammarCompletion(grammar, "foo");
                expect(result.completions).toEqual(["done!"]);
                // requiresSeparator("o", "d", auto) → both Latin → "spacePunctuation"
                expectMetadata(result, {
                    matchedPrefixLength: 3,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo don' finds partial of 'done!'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo don",
                    undefined,
                    "backward",
                );
                // "don" is partial prefix of "done!"
                expect(result.completions).toEqual(["done!"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo done' — full word match but segment has trailing '!'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo done",
                    undefined,
                    "backward",
                );
                // "done" is NOT a full match of "done!" — the segment
                // includes the exclamation mark. So "done" is a partial
                // prefix of "done!".
                expect(result.completions).toEqual(["done!"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Section 43: findPartialKeywordInWildcard — multi-segment
        //   keyword with escaped space creating single segment
        //   Grammar: `$(x) hello\ world done → x`
        //   Segments: ["hello world"] — single segment with embedded space
        //   This is covered in §35 but let's test more edge cases
        //   for partial matching within the embedded-space segment.
        // ================================================================

        describe("findPartialKeywordInWildcard — embedded space partial matching", () => {
            const g = `<Start> = $(x) hello\\ world done -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward on 'foo hello' finds partial of 'hello world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hello",
                    undefined,
                    "backward",
                );
                // "hello" is partial prefix of "hello world" (single
                // segment includes the space)
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo hello ' finds partial of 'hello world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hello ",
                    undefined,
                    "backward",
                );
                // "hello " is partial prefix of "hello world" (space
                // included in single segment)
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("backward on 'foo hello w' finds partial of 'hello world'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "foo hello w",
                    undefined,
                    "backward",
                );
                // "hello w" is partial prefix of "hello world"
                expect(result.completions).toEqual(["hello world"]);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });
    },
);
