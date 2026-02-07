// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Standalone test for wildcard length variations
 * Tests wildcard matching with 1, 2, 3, 4, 5+ token wildcards
 */

import { compileGrammarToNFA } from "../dist/nfaCompiler.js";
import { matchNFA } from "../dist/nfaInterpreter.js";
import { compileNFAToDFA } from "../dist/dfaCompiler.js";
import { matchDFA } from "../dist/dfaMatcher.js";

function testWildcardLength(
    description,
    pattern,
    tokens,
    expectedCaptures,
    mode = "nfa",
) {
    console.log(`\n=== ${description} ===`);
    console.log(`Pattern: ${pattern}`);
    console.log(`Input: ${tokens.join(" ")}`);
    console.log(`Mode: ${mode.toUpperCase()}`);

    try {
        const nfa = compileGrammarToNFA(
            expectedCaptures.grammar,
            `test-${mode}`,
        );

        let result;
        if (mode === "nfa") {
            result = matchNFA(nfa, tokens);
        } else {
            const dfa = compileNFAToDFA(nfa, `test-dfa`);
            result = matchDFA(dfa, tokens);
        }

        console.log(`Matched: ${result.matched}`);

        if (result.matched) {
            console.log(`Captures:`);
            for (const [key, value] of result.captures.entries()) {
                const expected = expectedCaptures.values[key];
                const match = value === expected ? "✓" : "✗";
                console.log(
                    `  ${key}: "${value}" ${match} (expected: "${expected}")`,
                );
            }

            // Verify all captures match
            let allMatch = true;
            for (const [key, expectedValue] of Object.entries(
                expectedCaptures.values,
            )) {
                if (result.captures.get(key) !== expectedValue) {
                    allMatch = false;
                    console.log(`  ERROR: ${key} mismatch!`);
                }
            }

            if (allMatch) {
                console.log(`✓ PASS`);
                return true;
            } else {
                console.log(`✗ FAIL`);
                return false;
            }
        } else {
            console.log(`✗ FAIL: No match`);
            return false;
        }
    } catch (error) {
        console.log(`✗ ERROR: ${error.message}`);
        return false;
    }
}

// Test configurations
const tests = [
    {
        description: "1-token wildcard",
        pattern: "show $(location) weather",
        tokens: ["show", "peoria", "weather"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["show"] },
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                            { type: "string", value: ["weather"] },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "peoria" },
        },
    },
    {
        description: "2-token wildcard",
        pattern: "show $(location) weather",
        tokens: ["show", "des", "moines", "weather"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["show"] },
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                            { type: "string", value: ["weather"] },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "des moines" },
        },
    },
    {
        description: "3-token wildcard",
        pattern: "show $(location) weather",
        tokens: ["show", "new", "york", "city", "weather"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["show"] },
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                            { type: "string", value: ["weather"] },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "new york city" },
        },
    },
    {
        description: "4-token wildcard",
        pattern: "show $(location) weather",
        tokens: ["show", "san", "juan", "puerto", "rico", "weather"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["show"] },
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                            { type: "string", value: ["weather"] },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "san juan puerto rico" },
        },
    },
    {
        description: "5-token wildcard at end",
        pattern: "show $(location)",
        tokens: ["show", "the", "big", "apple", "new", "york", "city"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["show"] },
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "the big apple new york city" },
        },
    },
    {
        description: "Two wildcards: 1 + 2 tokens",
        pattern: "play $(track) by $(artist)",
        tokens: ["play", "kodachrome", "by", "paul", "simon"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                            { type: "string", value: ["by"] },
                            {
                                type: "wildcard",
                                variable: "artist",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                track: { type: "variable", name: "track" },
                                artist: { type: "variable", name: "artist" },
                            },
                        },
                    },
                ],
            },
            values: { track: "kodachrome", artist: "paul simon" },
        },
    },
    {
        description: "Two wildcards: 3 + 2 tokens",
        pattern: "play $(track) by $(artist)",
        tokens: ["play", "stairway", "to", "heaven", "by", "led", "zeppelin"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                            { type: "string", value: ["by"] },
                            {
                                type: "wildcard",
                                variable: "artist",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                track: { type: "variable", name: "track" },
                                artist: { type: "variable", name: "artist" },
                            },
                        },
                    },
                ],
            },
            values: { track: "stairway to heaven", artist: "led zeppelin" },
        },
    },
    {
        description: "Two wildcards: 2 + 3 tokens",
        pattern: "play $(track) by $(artist)",
        tokens: ["play", "bohemian", "rhapsody", "by", "red", "hot", "chilis"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                            { type: "string", value: ["by"] },
                            {
                                type: "wildcard",
                                variable: "artist",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                track: { type: "variable", name: "track" },
                                artist: { type: "variable", name: "artist" },
                            },
                        },
                    },
                ],
            },
            values: { track: "bohemian rhapsody", artist: "red hot chilis" },
        },
    },
    {
        description: "Three wildcards: 3 + 2 + 2 tokens",
        pattern: "move $(item) from $(source) to $(dest)",
        tokens: [
            "move",
            "the",
            "blue",
            "book",
            "from",
            "top",
            "shelf",
            "to",
            "lower",
            "drawer",
        ],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["move"] },
                            {
                                type: "wildcard",
                                variable: "item",
                                typeName: "string",
                            },
                            { type: "string", value: ["from"] },
                            {
                                type: "wildcard",
                                variable: "source",
                                typeName: "string",
                            },
                            { type: "string", value: ["to"] },
                            {
                                type: "wildcard",
                                variable: "dest",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                item: { type: "variable", name: "item" },
                                source: { type: "variable", name: "source" },
                                dest: { type: "variable", name: "dest" },
                            },
                        },
                    },
                ],
            },
            values: {
                item: "the blue book",
                source: "top shelf",
                dest: "lower drawer",
            },
        },
    },
    {
        description: "Wildcard at beginning: 3 tokens",
        pattern: "$(location) weather forecast",
        tokens: ["new", "york", "city", "weather", "forecast"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            {
                                type: "wildcard",
                                variable: "location",
                                typeName: "string",
                            },
                            { type: "string", value: ["weather", "forecast"] },
                        ],
                        value: {
                            type: "object",
                            value: {
                                location: {
                                    type: "variable",
                                    name: "location",
                                },
                            },
                        },
                    },
                ],
            },
            values: { location: "new york city" },
        },
    },
    {
        description: "Wildcard at beginning: 5 tokens",
        pattern: "$(item) is ready",
        tokens: ["the", "red", "car", "in", "the", "garage", "is", "ready"],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            {
                                type: "wildcard",
                                variable: "item",
                                typeName: "string",
                            },
                            { type: "string", value: ["is", "ready"] },
                        ],
                        value: {
                            type: "object",
                            value: { item: { type: "variable", name: "item" } },
                        },
                    },
                ],
            },
            values: { item: "the red car in the garage" },
        },
    },
    {
        description: "7-token wildcard",
        pattern: "search for $(query)",
        tokens: [
            "search",
            "for",
            "the",
            "best",
            "italian",
            "restaurant",
            "in",
            "downtown",
            "san",
            "francisco",
        ],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["search", "for"] },
                            {
                                type: "wildcard",
                                variable: "query",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                query: { type: "variable", name: "query" },
                            },
                        },
                    },
                ],
            },
            values: {
                query: "the best italian restaurant in downtown san francisco",
            },
        },
    },
    {
        description: "Four wildcards: 3 + 2 + 2 + 2 tokens",
        pattern: "copy $(file) from $(source) to $(dest) using $(method)",
        tokens: [
            "copy",
            "my",
            "important",
            "file",
            "from",
            "main",
            "server",
            "to",
            "backup",
            "location",
            "using",
            "secure",
            "protocol",
        ],
        expectedCaptures: {
            grammar: {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["copy"] },
                            {
                                type: "wildcard",
                                variable: "file",
                                typeName: "string",
                            },
                            { type: "string", value: ["from"] },
                            {
                                type: "wildcard",
                                variable: "source",
                                typeName: "string",
                            },
                            { type: "string", value: ["to"] },
                            {
                                type: "wildcard",
                                variable: "dest",
                                typeName: "string",
                            },
                            { type: "string", value: ["using"] },
                            {
                                type: "wildcard",
                                variable: "method",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                file: { type: "variable", name: "file" },
                                source: { type: "variable", name: "source" },
                                dest: { type: "variable", name: "dest" },
                                method: { type: "variable", name: "method" },
                            },
                        },
                    },
                ],
            },
            values: {
                file: "my important file",
                source: "main server",
                dest: "backup location",
                method: "secure protocol",
            },
        },
    },
];

// Run all tests
console.log("=".repeat(60));
console.log("Wildcard Length Variation Tests");
console.log("=".repeat(60));

let nfaPassed = 0;
let nfaFailed = 0;
let dfaPassed = 0;
let dfaFailed = 0;

// Test NFA
console.log("\n" + "=".repeat(60));
console.log("NFA MODE");
console.log("=".repeat(60));
for (const test of tests) {
    if (
        testWildcardLength(
            test.description,
            test.pattern,
            test.tokens,
            test.expectedCaptures,
            "nfa",
        )
    ) {
        nfaPassed++;
    } else {
        nfaFailed++;
    }
}

// Test DFA
console.log("\n" + "=".repeat(60));
console.log("DFA MODE");
console.log("=".repeat(60));
for (const test of tests) {
    if (
        testWildcardLength(
            test.description,
            test.pattern,
            test.tokens,
            test.expectedCaptures,
            "dfa",
        )
    ) {
        dfaPassed++;
    } else {
        dfaFailed++;
    }
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("SUMMARY");
console.log("=".repeat(60));
console.log(`NFA: ${nfaPassed} passed, ${nfaFailed} failed`);
console.log(`DFA: ${dfaPassed} passed, ${dfaFailed} failed`);
console.log(
    `Total: ${nfaPassed + dfaPassed} passed, ${nfaFailed + dfaFailed} failed`,
);

if (nfaFailed === 0 && dfaFailed === 0) {
    console.log("\n✓ All tests passed!");
    process.exit(0);
} else {
    console.log("\n✗ Some tests failed");
    process.exit(1);
}
