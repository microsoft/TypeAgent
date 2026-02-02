// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it } from "node:test";
import assert from "node:assert";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import { Grammar } from "../src/grammarTypes.js";

describe("Wildcard Loop Behavior", () => {
    it("should match single-token wildcard", () => {
        // Pattern: show $(location:string) weather
        // Input: show peoria weather
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["show"] },
                        { type: "wildcard", variable: "location", typeName: "string" },
                        { type: "string", value: ["weather"] },
                    ],
                    value: {
                        type: "object",
                        value: {
                            location: { type: "variable", name: "location" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "test-single-token");
        const tokens = ["show", "peoria", "weather"];
        const result = matchNFA(nfa, tokens);

        console.log("\n=== Test: Single-token wildcard ===");
        console.log(`Pattern: show $(location:string) weather`);
        console.log(`Input: ${tokens.join(" ")}`);
        console.log(`Matched: ${result.matched}`);
        if (result.matched) {
            console.log(`Captures:`, JSON.stringify(result.actionValue));
        }

        assert.strictEqual(result.matched, true, "Should match");
        assert.strictEqual(result.actionValue?.location, "peoria");
    });

    it("should match multi-token wildcard", () => {
        // Pattern: show $(location:string) weather
        // Input: show des moines weather
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["show"] },
                        { type: "wildcard", variable: "location", typeName: "string" },
                        { type: "string", value: ["weather"] },
                    ],
                    value: {
                        type: "object",
                        value: {
                            location: { type: "variable", name: "location" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "test-multi-token");
        const tokens = ["show", "des", "moines", "weather"];
        const result = matchNFA(nfa, tokens);

        console.log("\n=== Test: Multi-token wildcard ===");
        console.log(`Pattern: show $(location:string) weather`);
        console.log(`Input: ${tokens.join(" ")}`);
        console.log(`Matched: ${result.matched}`);
        if (result.matched) {
            console.log(`Captures:`, JSON.stringify(result.actionValue));
        }

        assert.strictEqual(result.matched, true, "Should match");
        assert.strictEqual(result.actionValue?.location, "des moines");
    });

    it("should match two wildcards with multi-token values", () => {
        // Pattern: play $(track:string) by $(artist:string)
        // Input: play kodachrome by paul simon
        const grammar: Grammar = {
            rules: [
                {
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
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "test-two-wildcards");
        const tokens = ["play", "kodachrome", "by", "paul", "simon"];
        const result = matchNFA(nfa, tokens);

        console.log("\n=== Test: Two wildcards ===");
        console.log(`Pattern: play $(track:string) by $(artist:string)`);
        console.log(`Input: ${tokens.join(" ")}`);
        console.log(`Matched: ${result.matched}`);
        if (result.matched) {
            console.log(`Captures:`, JSON.stringify(result.actionValue));
        }

        assert.strictEqual(result.matched, true, "Should match");
        assert.strictEqual(result.actionValue?.track, "kodachrome");
        assert.strictEqual(result.actionValue?.artist, "paul simon");
    });

    it("should match wildcard at end consuming all remaining tokens", () => {
        // Pattern: show $(location:string)
        // Input: show des moines iowa
        const grammar: Grammar = {
            rules: [
                {
                    parts: [
                        { type: "string", value: ["show"] },
                        { type: "wildcard", variable: "location", typeName: "string" },
                    ],
                    value: {
                        type: "object",
                        value: {
                            location: { type: "variable", name: "location" },
                        },
                    },
                },
            ],
        };

        const nfa = compileGrammarToNFA(grammar, "test-wildcard-at-end");
        const tokens = ["show", "des", "moines", "iowa"];
        const result = matchNFA(nfa, tokens);

        console.log("\n=== Test: Wildcard at end ===");
        console.log(`Pattern: show $(location:string)`);
        console.log(`Input: ${tokens.join(" ")}`);
        console.log(`Matched: ${result.matched}`);
        if (result.matched) {
            console.log(`Captures:`, JSON.stringify(result.actionValue));
        }

        assert.strictEqual(result.matched, true, "Should match");
        assert.strictEqual(result.actionValue?.location, "des moines iowa");
    });
});
