// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for DFA compilation and matching
 *
 * Verifies that:
 * 1. NFAs can be compiled to DFAs
 * 2. DFA matching works correctly
 * 3. Priorities are preserved
 * 4. Completions work
 */

import {
    compileGrammarToNFA,
    compileNFAToDFA,
    matchDFA,
    getDFACompletions,
    printDFA,
    Grammar,
} from "../src/index.js";

describe("DFA Compilation", () => {
    test("Simple grammar compiles to DFA", () => {
        // Create a simple grammar: "play music"
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "simple");
        const dfa = compileNFAToDFA(nfa, "simple");

        expect(dfa).toBeDefined();
        expect(dfa.states.length).toBeGreaterThan(0);
        expect(dfa.startState).toBeDefined();
        expect(dfa.acceptingStates.length).toBeGreaterThan(0);
    });

    test("DFA matches correctly", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "music"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2);
        expect(result.tokensConsumed).toBe(2);
    });

    test("DFA preserves priorities", () => {
        // Grammar with two rules that can both match
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "playWildcard",
                                },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "music"]);

        expect(result.matched).toBe(true);
        // Should match the "play music" rule (2 fixed strings) over the wildcard rule
        expect(result.fixedStringPartCount).toBe(2);
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("DFA completions work", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: { type: "literal", value: "play-music" },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["song"] },
                    ],
                    value: { type: "literal", value: "play-song" },
                },
                {
                    parts: [{ type: "string", value: ["pause"] }],
                    value: { type: "literal", value: "pause" },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Completions after "play"
        const completions = getDFACompletions(dfa, ["play"]);

        expect(completions.completions).toContain("music");
        expect(completions.completions).toContain("song");
        expect(completions.prefixMatches).toBe(false);

        // Completions at start
        const startCompletions = getDFACompletions(dfa, []);

        expect(startCompletions.completions).toContain("play");
        expect(startCompletions.completions).toContain("pause");
    });

    test("DFA with wildcards matches correctly", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "bohemian-rhapsody"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1);
        expect(result.uncheckedWildcardCount).toBe(1);
    });

    test("DFA checked wildcards have higher priority", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "unchecked" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "n",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "checked" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "123"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1);
        expect(result.checkedWildcardCount).toBe(1);
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("DFA printout is readable", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: { type: "literal", value: "play-music" },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "test");
        const dfa = compileNFAToDFA(nfa, "test");

        const output = printDFA(dfa);

        expect(output).toContain("DFA: test");
        expect(output).toContain("Start state:");
        expect(output).toContain("Accepting states:");
        expect(output).toContain("[play]");
        expect(output).toContain("[music]");
    });

    test("DFA captures values correctly with priority selection", () => {
        // Grammar with two overlapping rules - different variables
        // Rule A: "play $(track:string)" -> lower priority (unchecked wildcard)
        // Rule B: "play $(id:number)" -> higher priority (checked wildcard)
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playTrack" },
                            },
                            {
                                type: "property",
                                key: "track",
                                value: { type: "variable", name: "track" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "id",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playId" },
                            },
                            {
                                type: "property",
                                key: "id",
                                value: { type: "variable", name: "id" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "123"]);

        expect(result.matched).toBe(true);
        // Should match the number rule (higher priority)
        expect(result.checkedWildcardCount).toBe(1);
        expect(result.uncheckedWildcardCount).toBe(0);
        // Should capture as "id" (not "track") - check via actionValue
        expect(result.actionValue?.id).toBe(123);
        expect(result.actionValue?.track).toBeUndefined();
    });

    test("DFA captures string values correctly", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "playTrackByArtist",
                                },
                            },
                            {
                                type: "property",
                                key: "track",
                                value: { type: "variable", name: "track" },
                            },
                            {
                                type: "property",
                                key: "artist",
                                value: { type: "variable", name: "artist" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, [
            "play",
            "bohemian-rhapsody",
            "by",
            "queen",
        ]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.track).toBe("bohemian-rhapsody");
        expect(result.actionValue?.artist).toBe("queen");
    });

    test("DFA completions show wildcard categories", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "track",
                                value: { type: "variable", name: "track" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "id",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "id",
                                value: { type: "variable", name: "id" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: { type: "literal", value: "play-music" },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Completions after "play"
        const completions = getDFACompletions(dfa, ["play"]);

        // Should show the literal "music"
        expect(completions.completions).toContain("music");
        // Wildcard categories are in wildcardCompletions (not in the flat completions array)
        const wildcards = completions.groups.flatMap(
            (g) => g.wildcardCompletions,
        );
        expect(wildcards.some((wc) => wc.variable === "track")).toBe(true);
        expect(
            wildcards.some(
                (wc) => wc.variable === "id" && wc.typeName === "number",
            ),
        ).toBe(true);
        expect(completions.prefixMatches).toBe(false);
    });

    test("DFA captures only variables from best matching rule", () => {
        // Grammar where both rules can match but have different captures
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "x",
                            typeName: "string",
                            optional: false,
                        },
                        {
                            type: "wildcard",
                            variable: "y",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "twoWildcards",
                                },
                            },
                            {
                                type: "property",
                                key: "x",
                                value: { type: "variable", name: "x" },
                            },
                            {
                                type: "property",
                                key: "y",
                                value: { type: "variable", name: "y" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["track"] },
                        {
                            type: "wildcard",
                            variable: "name",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "oneWildcard",
                                },
                            },
                            {
                                type: "property",
                                key: "name",
                                value: { type: "variable", name: "name" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "track", "something"]);

        expect(result.matched).toBe(true);
        // Should match second rule (more fixed strings)
        expect(result.fixedStringPartCount).toBe(2);
        // Should only have "name" in actionValue, not "x" or "y"
        expect(result.actionValue?.name).toBe("something");
        expect(result.actionValue?.x).toBeUndefined();
        expect(result.actionValue?.y).toBeUndefined();
    });

    test("DFA handles overlapping variable names correctly", () => {
        // CRITICAL: Both rules use the SAME variable name "track"
        // Rule A: "play $(track:string)" -> lower priority (unchecked wildcard)
        // Rule B: "play $(track:number)" -> higher priority (checked wildcard)
        // This tests that we don't accidentally return the string capture when number wins
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track", // SAME NAME
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playTrack" },
                            },
                            {
                                type: "property",
                                key: "track",
                                value: { type: "variable", name: "track" },
                            },
                        ],
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track", // SAME NAME
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "playTrackNumber",
                                },
                            },
                            {
                                type: "property",
                                key: "track",
                                value: { type: "variable", name: "track" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "123"]);

        expect(result.matched).toBe(true);
        // Should match the number rule (higher priority due to checked wildcard)
        expect(result.checkedWildcardCount).toBe(1);
        expect(result.uncheckedWildcardCount).toBe(0);
        // CRITICAL: Should capture as number (123), NOT string ("123")
        expect(result.actionValue?.track).toBe(123);
        expect(typeof result.actionValue?.track).toBe("number");
    });

    test("DFA tracks rule index correctly", () => {
        // Grammar with multiple rules
        const grammar: Grammar = {
            alternatives: [
                {
                    // Rule 0
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
                {
                    // Rule 1
                    parts: [{ type: "string", value: ["pause"] }],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "pause" },
                            },
                        ],
                    },
                },
                {
                    // Rule 2
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Test rule 0
        const result0 = matchDFA(dfa, ["play", "music"]);
        expect(result0.matched).toBe(true);
        expect(result0.ruleIndex).toBe(0);

        // Test rule 1
        const result1 = matchDFA(dfa, ["pause"]);
        expect(result1.matched).toBe(true);
        expect(result1.ruleIndex).toBe(1);

        // Test rule 2 (lower priority than rule 0 for "play music")
        const result2 = matchDFA(dfa, ["play", "song"]);
        expect(result2.matched).toBe(true);
        expect(result2.ruleIndex).toBe(2);
    });

    test("DFA completions are grouped by rule", () => {
        const grammar: Grammar = {
            alternatives: [
                {
                    // Rule 0
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
                {
                    // Rule 1
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["song"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playSong" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Completions after "play"
        const completions = getDFACompletions(dfa, ["play"]);

        // Should have groups for both rules
        expect(completions.groups.length).toBeGreaterThan(0);

        // Should show both "music" and "song" as possible completions
        expect(completions.completions).toContain("music");
        expect(completions.completions).toContain("song");
    });

    test("DFA returns correct rule index with priority selection", () => {
        // When multiple rules can match, should return the highest priority rule's index
        const grammar: Grammar = {
            alternatives: [
                {
                    // Rule 0 - lower priority (wildcard)
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: {
                                    type: "literal",
                                    value: "playGeneric",
                                },
                            },
                        ],
                    },
                },
                {
                    // Rule 1 - higher priority (more fixed strings)
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "action",
                                value: { type: "literal", value: "playMusic" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        const result = matchDFA(dfa, ["play", "music"]);

        expect(result.matched).toBe(true);
        // Should match rule 1 (higher priority - more fixed strings)
        expect(result.ruleIndex).toBe(1);
        expect(result.fixedStringPartCount).toBe(2);
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("DFA completions on real player grammar - after 'play'", () => {
        // This test uses a simplified version of the player grammar
        const grammar: Grammar = {
            alternatives: [
                {
                    // play the first track
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["the"] },
                        { type: "string", value: ["first"] },
                        { type: "string", value: ["track"] },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: {
                                    type: "literal",
                                    value: "playFromCurrentTrackList",
                                },
                            },
                        ],
                    },
                },
                {
                    // play track #5
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["track"] },
                        {
                            type: "wildcard",
                            variable: "n",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: {
                                    type: "literal",
                                    value: "playFromCurrentTrackList",
                                },
                            },
                        ],
                    },
                },
                {
                    // play <trackName> by <artist>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "trackName",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Test completions after "play"
        const completions = getDFACompletions(dfa, ["play"]);

        expect(completions.groups.length).toBeGreaterThan(0);
        expect(completions.completions).toContain("the");
        expect(completions.completions).toContain("track");
        const wildcards2 = completions.groups.flatMap(
            (g) => g.wildcardCompletions,
        );
        expect(wildcards2.some((wc) => wc.variable === "trackName")).toBe(true);
    });

    test("DFA completions on real player grammar - after 'play kodachrome by'", () => {
        // This tests the completion for artist name after "play <track> by"
        const grammar: Grammar = {
            alternatives: [
                {
                    // play <trackName> by <artist>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "trackName",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
                {
                    // play <trackName> from album <album>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "trackName",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["from"] },
                        { type: "string", value: ["album"] },
                        {
                            type: "wildcard",
                            variable: "albumName",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Test completions after "play kodachrome by"
        const completions = getDFACompletions(dfa, [
            "play",
            "kodachrome",
            "by",
        ]);

        expect(completions.groups.length).toBeGreaterThan(0);
        const wildcards3 = completions.groups.flatMap(
            (g) => g.wildcardCompletions,
        );
        expect(wildcards3.some((wc) => wc.variable === "artist")).toBe(true);
        expect(completions.prefixMatches).toBe(false);
    });

    test("DFA completions provide wildcard metadata for getActionCompletion", () => {
        // Test that completions include metadata needed to call AppAgent.getActionCompletion
        const grammar: Grammar = {
            alternatives: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "trackName",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "ArtistName",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Test completions after "play"
        const completions1 = getDFACompletions(dfa, ["play"]);

        expect(completions1.groups.length).toBe(1);
        const group1 = completions1.groups[0];

        // Should have rule index
        expect(group1.ruleIndex).toBe(0);

        // Should have wildcard completions with metadata
        expect(group1.wildcardCompletions.length).toBeGreaterThan(0);

        const trackNameCompletion = group1.wildcardCompletions.find(
            (wc) => wc.variable === "trackName",
        );
        expect(trackNameCompletion).toBeDefined();
        expect(trackNameCompletion?.variable).toBe("trackName");
        expect(trackNameCompletion?.typeName).toBe("string");
        expect(trackNameCompletion?.displayString).toBe("$(trackName)");

        // Test completions after "play kodachrome by"
        const completions2 = getDFACompletions(dfa, [
            "play",
            "kodachrome",
            "by",
        ]);

        expect(completions2.groups.length).toBe(1);
        const group2 = completions2.groups[0];

        const artistCompletion = group2.wildcardCompletions.find(
            (wc) => wc.variable === "artist",
        );
        expect(artistCompletion).toBeDefined();
        expect(artistCompletion?.variable).toBe("artist");
        expect(artistCompletion?.typeName).toBe("ArtistName");
        expect(artistCompletion?.displayString).toBe("$(artist:ArtistName)");
    });

    test("DFA completions with multiple different wildcard options", () => {
        // Test grammar with multiple rules that have different wildcards at same position
        // After "play", you can either say "play <artist>" or "play <track>"
        const grammar: Grammar = {
            alternatives: [
                {
                    // play <artist>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "ArtistName",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playArtist" },
                            },
                        ],
                    },
                },
                {
                    // play <track>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "TrackName",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playTrack" },
                            },
                        ],
                    },
                },
                {
                    // play <album>
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "album",
                            typeName: "AlbumName",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: [
                            {
                                type: "property",
                                key: "actionName",
                                value: { type: "literal", value: "playAlbum" },
                            },
                        ],
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);

        // Test completions after "play"
        const completions = getDFACompletions(dfa, ["play"]);

        // Should have groups for each rule
        expect(completions.groups.length).toBe(3);

        // All groups should have the same wildcard completions since they're at the same state
        for (const group of completions.groups) {
            expect(group.wildcardCompletions.length).toBe(3);

            // Should have all three wildcard types
            const artistCompletion = group.wildcardCompletions.find(
                (wc) => wc.variable === "artist",
            );
            const trackCompletion = group.wildcardCompletions.find(
                (wc) => wc.variable === "track",
            );
            const albumCompletion = group.wildcardCompletions.find(
                (wc) => wc.variable === "album",
            );

            expect(artistCompletion).toBeDefined();
            expect(artistCompletion?.variable).toBe("artist");
            expect(artistCompletion?.typeName).toBe("ArtistName");
            expect(artistCompletion?.displayString).toBe(
                "$(artist:ArtistName)",
            );

            expect(trackCompletion).toBeDefined();
            expect(trackCompletion?.variable).toBe("track");
            expect(trackCompletion?.typeName).toBe("TrackName");
            expect(trackCompletion?.displayString).toBe("$(track:TrackName)");

            expect(albumCompletion).toBeDefined();
            expect(albumCompletion?.variable).toBe("album");
            expect(albumCompletion?.typeName).toBe("AlbumName");
            expect(albumCompletion?.displayString).toBe("$(album:AlbumName)");
        }

        // Wildcard display strings are in wildcardCompletions (not in the flat completions array)
        // The groups loop above already verified all three wildcardCompletions entries.
    });
});
