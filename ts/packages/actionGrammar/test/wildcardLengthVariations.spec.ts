// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for wildcard matching with varying token lengths
 *
 * Verifies that wildcards correctly match and concatenate 1, 2, 3, 4, 5+ tokens
 * in both NFA and DFA modes
 */

import {
    compileGrammarToNFA,
    compileNFAToDFA,
    matchNFA,
    matchDFA,
    Grammar,
} from "../src/index.js";

describe("Wildcard Length Variations - NFA", () => {
    test("1-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["show", "peoria", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("peoria");
    });

    test("2-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["show", "des", "moines", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("des moines");
    });

    test("3-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["show", "new", "york", "city", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("new york city");
    });

    test("4-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["show", "san", "juan", "puerto", "rico", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("san juan puerto rico");
    });

    test("5-token wildcard at end", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["show", "the", "big", "apple", "new", "york", "city"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("the big apple new york city");
    });

    test("Two wildcards: 1 + 2 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["play"] },
                    { type: "wildcard", variable: "track", typeName: "string" },
                    { type: "string", value: ["by"] },
                    { type: "wildcard", variable: "artist", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        track: { type: "variable", name: "track" },
                        artist: { type: "variable", name: "artist" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "kodachrome", "by", "paul", "simon"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.track).toBe("kodachrome");
        expect(result.actionValue?.artist).toBe("paul simon");
    });

    test("Two wildcards: 3 + 2 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["play"] },
                    { type: "wildcard", variable: "track", typeName: "string" },
                    { type: "string", value: ["by"] },
                    { type: "wildcard", variable: "artist", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        track: { type: "variable", name: "track" },
                        artist: { type: "variable", name: "artist" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "stairway", "to", "heaven", "by", "led", "zeppelin"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.track).toBe("stairway to heaven");
        expect(result.actionValue?.artist).toBe("led zeppelin");
    });

    test("Two wildcards: 2 + 3 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["play"] },
                    { type: "wildcard", variable: "track", typeName: "string" },
                    { type: "string", value: ["by"] },
                    { type: "wildcard", variable: "artist", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        track: { type: "variable", name: "track" },
                        artist: { type: "variable", name: "artist" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["play", "bohemian", "rhapsody", "by", "red", "hot", "chilis"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.track).toBe("bohemian rhapsody");
        expect(result.actionValue?.artist).toBe("red hot chilis");
    });

    test("Three wildcards with varying lengths", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["move"] },
                    { type: "wildcard", variable: "item", typeName: "string" },
                    { type: "string", value: ["from"] },
                    { type: "wildcard", variable: "source", typeName: "string" },
                    { type: "string", value: ["to"] },
                    { type: "wildcard", variable: "dest", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        item: { type: "variable", name: "item" },
                        source: { type: "variable", name: "source" },
                        dest: { type: "variable", name: "dest" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["move", "the", "blue", "book", "from", "top", "shelf", "to", "lower", "drawer"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.item).toBe("the blue book");
        expect(result.actionValue?.source).toBe("top shelf");
        expect(result.actionValue?.dest).toBe("lower drawer");
    });

    test("Wildcard at beginning with 3 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather", "forecast"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["new", "york", "city", "weather", "forecast"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("new york city");
    });

    test("Wildcard at beginning with 5 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "wildcard", variable: "item", typeName: "string" },
                    { type: "string", value: ["is", "ready"] },
                ],
                value: {
                    type: "object",
                    value: { item: { type: "variable", name: "item" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["the", "red", "car", "in", "the", "garage", "is", "ready"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.item).toBe("the red car in the garage");
    });

    test("7-token wildcard", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["search", "for"] },
                    { type: "wildcard", variable: "query", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: { query: { type: "variable", name: "query" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["search", "for", "the", "best", "italian", "restaurant", "in", "downtown", "san", "francisco"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.query).toBe("the best italian restaurant in downtown san francisco");
    });

    test("Four wildcards with varying lengths", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["copy"] },
                    { type: "wildcard", variable: "file", typeName: "string" },
                    { type: "string", value: ["from"] },
                    { type: "wildcard", variable: "source", typeName: "string" },
                    { type: "string", value: ["to"] },
                    { type: "wildcard", variable: "dest", typeName: "string" },
                    { type: "string", value: ["using"] },
                    { type: "wildcard", variable: "method", typeName: "string" },
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
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const result = matchNFA(nfa, ["copy", "my", "important", "file", "from", "main", "server", "to", "backup", "location", "using", "secure", "protocol"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.file).toBe("my important file");
        expect(result.actionValue?.source).toBe("main server");
        expect(result.actionValue?.dest).toBe("backup location");
        expect(result.actionValue?.method).toBe("secure protocol");
    });
});

describe("Wildcard Length Variations - DFA", () => {
    test("1-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["show", "peoria", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("peoria");
    });

    test("2-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["show", "des", "moines", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("des moines");
    });

    test("3-token wildcard in middle", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                    { type: "string", value: ["weather"] },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["show", "new", "york", "city", "weather"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("new york city");
    });

    test("5-token wildcard at end", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["show"] },
                    { type: "wildcard", variable: "location", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: { location: { type: "variable", name: "location" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["show", "the", "big", "apple", "new", "york", "city"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.location).toBe("the big apple new york city");
    });

    test("Two wildcards with 3+2 tokens", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["play"] },
                    { type: "wildcard", variable: "track", typeName: "string" },
                    { type: "string", value: ["by"] },
                    { type: "wildcard", variable: "artist", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        track: { type: "variable", name: "track" },
                        artist: { type: "variable", name: "artist" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["play", "stairway", "to", "heaven", "by", "led", "zeppelin"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.track).toBe("stairway to heaven");
        expect(result.actionValue?.artist).toBe("led zeppelin");
    });

    test("Three wildcards with varying lengths", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["move"] },
                    { type: "wildcard", variable: "item", typeName: "string" },
                    { type: "string", value: ["from"] },
                    { type: "wildcard", variable: "source", typeName: "string" },
                    { type: "string", value: ["to"] },
                    { type: "wildcard", variable: "dest", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: {
                        item: { type: "variable", name: "item" },
                        source: { type: "variable", name: "source" },
                        dest: { type: "variable", name: "dest" },
                    },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["move", "the", "blue", "book", "from", "top", "shelf", "to", "lower", "drawer"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.item).toBe("the blue book");
        expect(result.actionValue?.source).toBe("top shelf");
        expect(result.actionValue?.dest).toBe("lower drawer");
    });

    test("7-token wildcard", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["search", "for"] },
                    { type: "wildcard", variable: "query", typeName: "string" },
                ],
                value: {
                    type: "object",
                    value: { query: { type: "variable", name: "query" } },
                },
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["search", "for", "the", "best", "italian", "restaurant", "in", "downtown", "san", "francisco"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.query).toBe("the best italian restaurant in downtown san francisco");
    });

    test("Four wildcards with varying lengths", () => {
        const grammar: Grammar = {
            rules: [{
                parts: [
                    { type: "string", value: ["copy"] },
                    { type: "wildcard", variable: "file", typeName: "string" },
                    { type: "string", value: ["from"] },
                    { type: "wildcard", variable: "source", typeName: "string" },
                    { type: "string", value: ["to"] },
                    { type: "wildcard", variable: "dest", typeName: "string" },
                    { type: "string", value: ["using"] },
                    { type: "wildcard", variable: "method", typeName: "string" },
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
            }],
        };

        const nfa = compileGrammarToNFA(grammar);
        const dfa = compileNFAToDFA(nfa);
        const result = matchDFA(dfa, ["copy", "my", "important", "file", "from", "main", "server", "to", "backup", "location", "using", "secure", "protocol"]);

        expect(result.matched).toBe(true);
        expect(result.actionValue?.file).toBe("my important file");
        expect(result.actionValue?.source).toBe("main server");
        expect(result.actionValue?.dest).toBe("backup location");
        expect(result.actionValue?.method).toBe("secure protocol");
    });
});
