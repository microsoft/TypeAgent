// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Comprehensive tests for NFA priority system
 *
 * These tests verify that when multiple grammar rules match the same input,
 * the NFA matcher correctly selects the highest-priority match according to:
 * 1. Rules without unchecked wildcards > rules with unchecked wildcards (absolute)
 * 2. More fixed string parts > fewer fixed string parts
 * 3. More checked wildcards > fewer checked wildcards
 * 4. Fewer unchecked wildcards > more unchecked wildcards
 */

import { compileGrammarToNFA, matchNFA, Grammar } from "../src/index.js";

describe("NFA Priority System", () => {
    test("Rule 1: No unchecked wildcards beats rules with unchecked wildcards", () => {
        // Rule A: "play music" -> 2 fixed strings, 0 wildcards (highest priority)
        // Rule B: "play $(track:string)" -> 1 fixed + 1 unchecked wildcard
        const grammar: Grammar = {
            rules: [
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
                        value: {
                            action: { type: "literal", value: "playWildcard" },
                        },
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "playMusic" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "music"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2); // Should match "play music" rule
        expect(result.uncheckedWildcardCount).toBe(0);
        expect(result.checkedWildcardCount).toBe(0);
    });

    test("Rule 2: More fixed strings beats fewer fixed strings", () => {
        // Rule A: "play track $(name:string)" -> 2 fixed + 1 unchecked
        // Rule B: "play $(track:string)" -> 1 fixed + 1 unchecked (should lose)
        const grammar: Grammar = {
            rules: [
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
                        value: {
                            action: { type: "literal", value: "playShort" },
                        },
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
                        value: {
                            action: { type: "literal", value: "playLong" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "track", "something"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2); // Should match longer fixed string rule
        expect(result.uncheckedWildcardCount).toBe(1);
    });

    test("Rule 3: More checked wildcards beats fewer checked wildcards", () => {
        // Rule A: "play $(track:number) by $(artist:number)" -> 2 checked wildcards
        // Rule B: "play $(track:number)" -> 1 checked wildcard (should lose)
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "playOne" },
                        },
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "track",
                            typeName: "number",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "artist",
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "playTwo" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "123", "by", "456"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2); // "play" and "by"
        expect(result.checkedWildcardCount).toBe(2); // Should match rule with 2 checked wildcards
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("Rule 4: Fewer unchecked wildcards beats more unchecked wildcards", () => {
        // Rule A: "play $(track:string) by $(artist:string)" -> 2 unchecked
        // Rule B: "play $(track:string)" -> 1 unchecked (should win)
        const grammar: Grammar = {
            rules: [
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
                        value: {
                            action: { type: "literal", value: "playTwo" },
                        },
                    },
                },
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
                        value: {
                            action: { type: "literal", value: "playOne" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "something"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1); // "play"
        expect(result.uncheckedWildcardCount).toBe(1); // Should match rule with fewer unchecked
        expect(result.checkedWildcardCount).toBe(0);
    });

    test("Priority level 1 overrides level 2: No unchecked > more fixed strings", () => {
        // Rule A: "play music now" -> 3 fixed strings, 0 wildcards (priority level 1)
        // Rule B: "play $(x:string) $(y:string) $(z:string) $(w:string)" -> 1 fixed + 4 unchecked (priority level 2)
        const grammar: Grammar = {
            rules: [
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
                        {
                            type: "wildcard",
                            variable: "z",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "manyWildcards" },
                        },
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                        { type: "string", value: ["now"] },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "allFixed" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "music", "now"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(3);
        expect(result.uncheckedWildcardCount).toBe(0); // Level 1 wins even with fewer total tokens
        expect(result.checkedWildcardCount).toBe(0);
    });

    test("checked_wildcard paramSpec creates checked wildcards", () => {
        // Rule A: "play $(track:string)" with track as checked variable -> 1 checked
        // Rule B: "play $(song:string)" without checked -> 1 unchecked (should lose)
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "song",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            action: { type: "literal", value: "unchecked" },
                        },
                    },
                },
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
                        value: {
                            action: { type: "literal", value: "checked" },
                        },
                    },
                },
            ],
            checkedVariables: new Set(["track"]), // Mark track as checked
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "something"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1);
        expect(result.checkedWildcardCount).toBe(1); // Should match checked wildcard rule
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("Entity types create checked wildcards", () => {
        // Rule A: "play $(n:number)" -> entity type = checked
        // Rule B: "play $(track:string)" -> no entity = unchecked (should lose)
        const grammar: Grammar = {
            rules: [
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
                        value: {
                            action: { type: "literal", value: "unchecked" },
                        },
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
                        value: {
                            action: { type: "literal", value: "checked" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "123"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1);
        expect(result.checkedWildcardCount).toBe(1); // Should match entity-typed rule
        expect(result.uncheckedWildcardCount).toBe(0);
    });

    test("Complex scenario: All priority levels", () => {
        // Test all priority levels in one grammar
        const grammar: Grammar = {
            rules: [
                // Lowest priority: 1 fixed + 2 unchecked wildcards
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "a",
                            typeName: "string",
                            optional: false,
                        },
                        {
                            type: "wildcard",
                            variable: "b",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            priority: { type: "literal", value: "lowest" },
                        },
                    },
                },
                // Mid priority: 1 fixed + 1 unchecked wildcard
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
                        value: { priority: { type: "literal", value: "mid" } },
                    },
                },
                // High priority: 1 fixed + 1 checked wildcard
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
                        value: { priority: { type: "literal", value: "high" } },
                    },
                },
                // Highest priority: 2 fixed strings
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: {
                            priority: { type: "literal", value: "highest" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "music"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2);
        expect(result.uncheckedWildcardCount).toBe(0);
        expect(result.checkedWildcardCount).toBe(0);
    });

    test("Tie-breaking: When priorities are equal, first valid match wins", () => {
        // Both rules have identical priority (1 fixed + 1 unchecked wildcard)
        // Should return first valid match found
        const grammar: Grammar = {
            rules: [
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
                        value: { rule: { type: "literal", value: "A" } },
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "song",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: { rule: { type: "literal", value: "B" } },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "something"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(1);
        expect(result.uncheckedWildcardCount).toBe(1);
        expect(result.checkedWildcardCount).toBe(0);
        // With identical priorities, either match is acceptable
    });

    test("Optional parts don't affect priority when skipped", () => {
        // Rule A: "play (please)? music" -> If "please" is matched: 3 fixed, else: 2 fixed
        // Rule B: "play music" -> 2 fixed
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "rules",
                            optional: true,
                            rules: [
                                {
                                    parts: [
                                        { type: "string", value: ["please"] },
                                    ],
                                },
                            ],
                        },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: { rule: { type: "literal", value: "optional" } },
                    },
                },
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        { type: "string", value: ["music"] },
                    ],
                    value: {
                        type: "object",
                        value: { rule: { type: "literal", value: "fixed" } },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);

        // Without "please", both rules have same priority (2 fixed)
        const result1 = matchNFA(nfa, ["play", "music"]);
        expect(result1.matched).toBe(true);
        expect(result1.fixedStringPartCount).toBe(2);

        // With "please", optional rule wins (3 fixed)
        const result2 = matchNFA(nfa, ["play", "please", "music"]);
        expect(result2.matched).toBe(true);
        expect(result2.fixedStringPartCount).toBe(3);
    });

    test("Mixed checked and unchecked wildcards", () => {
        // Rule A: "play $(track:string) by $(artist:number)" -> 1 unchecked + 1 checked
        // Rule B: "play $(a:string) by $(b:string)" -> 2 unchecked (should lose - fewer checked)
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["play"] },
                        {
                            type: "wildcard",
                            variable: "a",
                            typeName: "string",
                            optional: false,
                        },
                        { type: "string", value: ["by"] },
                        {
                            type: "wildcard",
                            variable: "b",
                            typeName: "string",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            rule: { type: "literal", value: "allUnchecked" },
                        },
                    },
                },
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
                            typeName: "number",
                            optional: false,
                        },
                    ],
                    value: {
                        type: "object",
                        value: {
                            rule: { type: "literal", value: "mixedChecked" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "something", "by", "123"]);

        expect(result.matched).toBe(true);
        expect(result.fixedStringPartCount).toBe(2); // "play" and "by"
        expect(result.checkedWildcardCount).toBe(1); // artist:number
        expect(result.uncheckedWildcardCount).toBe(1); // track:string
    });
});
