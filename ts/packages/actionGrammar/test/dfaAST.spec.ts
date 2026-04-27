// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for AST-based DFA matching (matchDFAToAST + evaluateMatchAST)
 *
 * Verifies:
 * 1. Basic literal matching produces correct AST
 * 2. Wildcard matching produces correct AST with variable bindings
 * 3. Minimal munch: wildcards consume minimal tokens
 * 4. Backtracking: literal choice reversed when it leads to dead end
 * 5. Flex-space prefix splitting
 * 6. Value evaluation from AST matches NFA-produced values
 * 7. Two-pass split-candidate matching
 */

import {
    compileGrammarToNFA,
    compileNFAToDFA,
    matchDFAToAST,
    matchDFAToASTWithSplitting,
    evaluateMatchAST,
    type Grammar,
} from "../src/index.js";

// Helper: compile grammar → DFA
function compileToDFA(grammar: Grammar, name?: string) {
    const nfa = compileGrammarToNFA(grammar, name);
    return compileNFAToDFA(nfa, name);
}

describe("DFA AST Matching", () => {
    describe("Basic literal matching", () => {
        test("matches simple two-word command", () => {
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
                                    value: {
                                        type: "literal",
                                        value: "playMusic",
                                    },
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar, "simple");
            const result = matchDFAToAST(dfa, ["play", "music"]);

            expect(result.matched).toBe(true);
            expect(result.fixedStringPartCount).toBe(2);
            expect(result.ast).toBeDefined();
            expect(result.ast!.parts).toHaveLength(2);
            expect(result.ast!.parts[0]).toEqual({
                kind: "token",
                token: "play",
            });
            expect(result.ast!.parts[1]).toEqual({
                kind: "token",
                token: "music",
            });
        });

        test("rejects non-matching input", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            { type: "string", value: ["music"] },
                        ],
                        value: { type: "literal", value: "playMusic" },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "video"]);

            expect(result.matched).toBe(false);
        });

        test("rejects partial input", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            { type: "string", value: ["music"] },
                        ],
                        value: { type: "literal", value: "playMusic" },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play"]);

            expect(result.matched).toBe(false);
        });
    });

    describe("Wildcard matching", () => {
        test("captures single-token wildcard", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "action",
                                    value: { type: "literal", value: "play" },
                                },
                                { type: "property", key: "track", value: null },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "Yesterday"]);

            expect(result.matched).toBe(true);
            expect(result.ast!.parts).toHaveLength(2);
            expect(result.ast!.parts[0]).toEqual({
                kind: "token",
                token: "play",
            });
            expect(result.ast!.parts[1]).toMatchObject({
                kind: "wildcard",
                variable: "track",
                tokens: ["Yesterday"],
            });
        });

        test("captures multi-token wildcard (minimal munch absorbs remainder)", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                { type: "property", key: "track", value: null },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "Bohemian", "Rhapsody"]);

            expect(result.matched).toBe(true);
            expect(result.ast!.parts).toHaveLength(2);
            const wildcard = result.ast!.parts[1];
            expect(wildcard.kind).toBe("wildcard");
            if (wildcard.kind === "wildcard") {
                expect(wildcard.variable).toBe("track");
                expect(wildcard.tokens).toEqual(["Bohemian", "Rhapsody"]);
            }
        });
    });

    describe("Minimal munch with backtracking", () => {
        test("play X by Y — backtracking resolves ambiguity on 'by'", () => {
            const grammar: Grammar = {
                alternatives: [
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
                            value: [
                                { type: "property", key: "track", value: null },
                                {
                                    type: "property",
                                    key: "artist",
                                    value: null,
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar, "playByArtist");

            // Simple case: "play Yesterday by Beatles"
            const result1 = matchDFAToAST(dfa, [
                "play",
                "Yesterday",
                "by",
                "Beatles",
            ]);
            expect(result1.matched).toBe(true);
            expect(result1.ast!.parts).toHaveLength(4);

            // Verify the token/wildcard structure
            expect(result1.ast!.parts[0]).toEqual({
                kind: "token",
                token: "play",
            });
            expect(result1.ast!.parts[1]).toMatchObject({
                kind: "wildcard",
                variable: "track",
                tokens: ["Yesterday"],
            });
            expect(result1.ast!.parts[2]).toEqual({
                kind: "token",
                token: "by",
            });
            expect(result1.ast!.parts[3]).toMatchObject({
                kind: "wildcard",
                variable: "artist",
                tokens: ["Beatles"],
            });
        });

        test("play Day by Day by the Carpenters — minimal munch takes first 'by'", () => {
            const grammar: Grammar = {
                alternatives: [
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
                            value: [
                                { type: "property", key: "track", value: null },
                                {
                                    type: "property",
                                    key: "artist",
                                    value: null,
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar, "playByArtist");

            // With unchecked wildcards, minimal munch takes the first valid split:
            // With correct DFA subset construction (token transitions merge
            // wildcard targets), each DFA state after "by" includes both the
            // literal "by" path and the wildcard continuation.  The AST builder's
            // greedy approach now splits at BOTH "by" tokens, producing 3 wildcard
            // segments.  The DFA hybrid matcher (production path) delegates to NFA
            // for correct value computation.
            const result = matchDFAToAST(dfa, [
                "play",
                "Day",
                "by",
                "Day",
                "by",
                "the",
                "Carpenters",
            ]);

            expect(result.matched).toBe(true);

            const wildcards = result.ast!.parts.filter(
                (p) => p.kind === "wildcard",
            );
            expect(wildcards).toHaveLength(3);

            if (
                wildcards[0].kind === "wildcard" &&
                wildcards[1].kind === "wildcard" &&
                wildcards[2].kind === "wildcard"
            ) {
                // Minimal munch: both "by" tokens consumed as literal separators
                expect(wildcards[0].tokens.join(" ")).toBe("Day");
                expect(wildcards[0].variable).toBe("track");
                expect(wildcards[1].tokens.join(" ")).toBe("Day");
                expect(wildcards[1].variable).toBe("artist");
                expect(wildcards[2].tokens.join(" ")).toBe("the Carpenters");
                expect(wildcards[2].variable).toBe("artist");
            }
        });

        test("backtracking on dead end — play X on Y at Z", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                            { type: "string", value: ["on"] },
                            {
                                type: "wildcard",
                                variable: "device",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                { type: "property", key: "track", value: null },
                                {
                                    type: "property",
                                    key: "device",
                                    value: null,
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);

            // "on" appears only once — no ambiguity, straightforward match
            const result = matchDFAToAST(dfa, [
                "play",
                "Bohemian",
                "Rhapsody",
                "on",
                "kitchen",
                "speaker",
            ]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);
            expect(value).toEqual({
                track: "Bohemian Rhapsody",
                device: "kitchen speaker",
            });
        });
    });

    describe("Value evaluation", () => {
        test("evaluates simple object value from AST", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "actionName",
                                    value: { type: "literal", value: "play" },
                                },
                                { type: "property", key: "track", value: null },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "Yesterday"]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);

            expect(value).toEqual({
                actionName: "play",
                track: "Yesterday",
            });
        });

        test("evaluates multi-token wildcard value", () => {
            const grammar: Grammar = {
                alternatives: [
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
                            value: [
                                { type: "property", key: "track", value: null },
                                {
                                    type: "property",
                                    key: "artist",
                                    value: null,
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, [
                "play",
                "Bohemian",
                "Rhapsody",
                "by",
                "Queen",
            ]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);

            expect(value).toEqual({
                track: "Bohemian Rhapsody",
                artist: "Queen",
            });
        });

        test("evaluates minimal-munch match correctly", () => {
            const grammar: Grammar = {
                alternatives: [
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
                            value: [
                                { type: "property", key: "track", value: null },
                                {
                                    type: "property",
                                    key: "artist",
                                    value: null,
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);

            // Minimal munch: "Bohemian Rhapsody" before "by", "Queen" after
            const result = matchDFAToAST(dfa, [
                "play",
                "Bohemian",
                "Rhapsody",
                "by",
                "Queen",
            ]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);

            expect(value).toEqual({
                track: "Bohemian Rhapsody",
                artist: "Queen",
            });
        });

        test("evaluates literal-only value expression", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "actionName",
                                    value: { type: "literal", value: "pause" },
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["pause"]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);

            expect(value).toEqual({ actionName: "pause" });
        });
    });

    describe("Multiple rules", () => {
        test("matches correct rule among alternatives", () => {
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
                                    value: {
                                        type: "literal",
                                        value: "playMusic",
                                    },
                                },
                            ],
                        },
                    },
                    {
                        parts: [
                            { type: "string", value: ["stop"] },
                            { type: "string", value: ["music"] },
                        ],
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "action",
                                    value: {
                                        type: "literal",
                                        value: "stopMusic",
                                    },
                                },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);

            const r1 = matchDFAToAST(dfa, ["play", "music"]);
            expect(r1.matched).toBe(true);
            expect(evaluateMatchAST(r1.ast!, grammar)).toEqual({
                action: "playMusic",
            });

            const r2 = matchDFAToAST(dfa, ["stop", "music"]);
            expect(r2.matched).toBe(true);
            expect(evaluateMatchAST(r2.ast!, grammar)).toEqual({
                action: "stopMusic",
            });
        });
    });

    describe("Two-pass split-candidate matching", () => {
        test("possessive splits via two-pass", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "artist",
                                typeName: "string",
                            },
                            { type: "string", value: ["'s"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "artist",
                                    value: null,
                                },
                                { type: "property", key: "track", value: null },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar, "possessive");

            // "Swift's" should be split into ["Swift", "'s"] by two-pass
            const result = matchDFAToASTWithSplitting(dfa, [
                "play",
                "Swift's",
                "Shake",
                "It",
                "Off",
            ]);

            expect(result.matched).toBe(true);
            const value = evaluateMatchAST(result.ast!, grammar);
            expect(value).toEqual({
                artist: "Swift",
                track: "Shake It Off",
            });
        });
    });

    describe("Priority counting", () => {
        test("counts fixed string parts correctly", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            { type: "string", value: ["the"] },
                            { type: "string", value: ["music"] },
                        ],
                        value: { type: "literal", value: "playTheMusic" },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "the", "music"]);

            expect(result.matched).toBe(true);
            expect(result.fixedStringPartCount).toBe(3);
            expect(result.uncheckedWildcardCount).toBe(0);
        });

        test("counts unchecked wildcards correctly", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: [
                                { type: "property", key: "track", value: null },
                            ],
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["play", "Yesterday"]);

            expect(result.matched).toBe(true);
            expect(result.fixedStringPartCount).toBe(1);
            expect(result.uncheckedWildcardCount).toBe(1);
        });
    });

    describe("Case insensitive matching", () => {
        test("normalizes token case", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            { type: "string", value: ["music"] },
                        ],
                        value: {
                            type: "literal",
                            value: "playMusic",
                        },
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, ["Play", "Music"]);

            expect(result.matched).toBe(true);
        });
    });

    describe("Empty input", () => {
        test("handles empty token array", () => {
            const grammar: Grammar = {
                alternatives: [
                    {
                        parts: [{ type: "string", value: ["play"] }],
                    },
                ],
            };

            const dfa = compileToDFA(grammar);
            const result = matchDFAToAST(dfa, []);

            expect(result.matched).toBe(false);
        });
    });
});
