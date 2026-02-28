// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar } from "../src/grammarTypes.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA, printNFA, printMatchResult } from "../src/nfaInterpreter.js";
import { NFABuilder, combineNFAs } from "../src/nfa.js";
import { loadGrammarRules } from "../src/grammarLoader.js";

describe("NFA Infrastructure", () => {
    describe("NFABuilder", () => {
        it("should build a simple token-matching NFA", () => {
            const builder = new NFABuilder();
            const start = builder.createState(false);
            const accept = builder.createState(true);

            builder.addTokenTransition(start, accept, ["hello"]);

            const nfa = builder.build(start, "simple-hello");

            expect(nfa.states).toHaveLength(2);
            expect(nfa.startState).toBe(start);
            expect(nfa.acceptingStates).toEqual([accept]);
        });

        it("should build an NFA with epsilon transitions", () => {
            const builder = new NFABuilder();
            const s0 = builder.createState(false);
            const s1 = builder.createState(false);
            const s2 = builder.createState(true);

            builder.addEpsilonTransition(s0, s1);
            builder.addTokenTransition(s1, s2, ["test"]);

            const nfa = builder.build(s0);

            expect(nfa.states).toHaveLength(3);
        });

        it("should build an NFA with wildcard transitions", () => {
            const builder = new NFABuilder();
            const start = builder.createState(false);
            const accept = builder.createState(true);

            builder.addWildcardTransition(start, accept, "name", "string");

            const nfa = builder.build(start);

            expect(nfa.states[start].transitions[0].type).toBe("wildcard");
            expect(nfa.states[start].transitions[0].variable).toBe("name");
        });
    });

    describe("Grammar to NFA Compilation", () => {
        it("should compile a simple string grammar", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "hello-grammar");

            expect(nfa.name).toBe("hello-grammar");
            expect(nfa.states.length).toBeGreaterThan(0);
            expect(nfa.acceptingStates.length).toBeGreaterThan(0);
        });

        it("should compile a grammar with alternatives", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                        ],
                    },
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hi"],
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "greeting");
            const result1 = matchNFA(nfa, ["hello"]);
            const result2 = matchNFA(nfa, ["hi"]);
            const result3 = matchNFA(nfa, ["bye"]);

            expect(result1.matched).toBe(true);
            expect(result2.matched).toBe(true);
            expect(result3.matched).toBe(false);
        });

        it("should compile a grammar with sequence", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                            {
                                type: "string",
                                value: ["world"],
                            },
                        ],
                        value: { type: "literal", value: "hello-world" },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "hello-world");
            const result1 = matchNFA(nfa, ["hello", "world"]);
            const result2 = matchNFA(nfa, ["hello"]);
            const result3 = matchNFA(nfa, ["world"]);

            expect(result1.matched).toBe(true);
            expect(result2.matched).toBe(false);
            expect(result3.matched).toBe(false);
        });

        it("should compile a grammar with wildcards", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                            {
                                type: "wildcard",
                                variable: "name",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: { name: { type: "variable", name: "name" } },
                        },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "hello-name");
            const result = matchNFA(nfa, ["hello", "Alice"]);

            expect(result.matched).toBe(true);
            // actionValue is evaluated from the value expression: { name: $(name) }
            expect(result.actionValue).toEqual({ name: "Alice" });
        });

        it("should compile a grammar with optional parts", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                            {
                                type: "wildcard",
                                variable: "name",
                                typeName: "string",
                                optional: true,
                            },
                        ],
                        value: {
                            type: "object",
                            value: { name: { type: "variable", name: "name" } },
                        },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "optional-name");
            const result1 = matchNFA(nfa, ["hello", "Alice"]);
            const result2 = matchNFA(nfa, ["hello"]);

            expect(result1.matched).toBe(true);
            // actionValue is evaluated from the value expression: { name: $(name) }
            expect(result1.actionValue).toEqual({ name: "Alice" });
            expect(result2.matched).toBe(true);
            // When optional wildcard is not matched, the slot is undefined
            expect(result2.actionValue).toEqual({ name: undefined });
        });

        it("should compile Kleene star )* — zero or more repetitions", () => {
            // Pattern: (um | uh)* help  — zero fillers is fine
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "rules",
                                rules: [
                                    {
                                        parts: [
                                            { type: "string", value: ["um"] },
                                        ],
                                    },
                                    {
                                        parts: [
                                            { type: "string", value: ["uh"] },
                                        ],
                                    },
                                ],
                                optional: true,
                                repeat: true,
                            },
                            { type: "string", value: ["help"] },
                        ],
                        value: { type: "literal", value: true },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "kleene-star");
            // zero repetitions
            expect(matchNFA(nfa, ["help"]).matched).toBe(true);
            // one repetition
            expect(matchNFA(nfa, ["um", "help"]).matched).toBe(true);
            // two repetitions
            expect(matchNFA(nfa, ["uh", "um", "help"]).matched).toBe(true);
            // zero occurrences of the body — must NOT match without "help"
            expect(matchNFA(nfa, ["um"]).matched).toBe(false);
        });

        it("should compile Kleene plus )+ — one or more repetitions", () => {
            // Pattern: (word)+ end  — at least one "word" required
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "rules",
                                rules: [
                                    {
                                        parts: [
                                            { type: "string", value: ["word"] },
                                        ],
                                    },
                                ],
                                repeat: true,
                                // optional is intentionally absent → must match at least once
                            },
                            { type: "string", value: ["end"] },
                        ],
                        value: { type: "literal", value: true },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "kleene-plus");
            // one occurrence
            expect(matchNFA(nfa, ["word", "end"]).matched).toBe(true);
            // two occurrences
            expect(matchNFA(nfa, ["word", "word", "end"]).matched).toBe(true);
            // three occurrences
            expect(matchNFA(nfa, ["word", "word", "word", "end"]).matched).toBe(
                true,
            );
            // zero occurrences — must NOT match
            expect(matchNFA(nfa, ["end"]).matched).toBe(false);
        });

        it("should parse and match )+ syntax end-to-end via loadGrammarRules", () => {
            // Verify the full pipeline: AGR text → parse → NFA → match
            const agr = `<Start> = (ping)+ pong -> true;`;
            const g = loadGrammarRules("test.agr", agr);
            const nfa = compileGrammarToNFA(g, "kleene-plus-e2e");

            expect(matchNFA(nfa, ["ping", "pong"]).matched).toBe(true);
            expect(matchNFA(nfa, ["ping", "ping", "pong"]).matched).toBe(true);
            // zero occurrences — must NOT match
            expect(matchNFA(nfa, ["pong"]).matched).toBe(false);
        });
    });

    describe("NFA Interpreter", () => {
        it("should match simple token sequences", () => {
            const builder = new NFABuilder();
            const s0 = builder.createState(false);
            const s1 = builder.createState(false);
            const s2 = builder.createState(true);

            builder.addTokenTransition(s0, s1, ["hello"]);
            builder.addTokenTransition(s1, s2, ["world"]);

            const nfa = builder.build(s0);
            const result = matchNFA(nfa, ["hello", "world"]);

            expect(result.matched).toBe(true);
            expect(result.tokensConsumed).toBe(2);
        });

        it("should handle epsilon transitions correctly", () => {
            const builder = new NFABuilder();
            const s0 = builder.createState(false);
            const s1 = builder.createState(false);
            const s2 = builder.createState(true);

            builder.addEpsilonTransition(s0, s1);
            builder.addTokenTransition(s1, s2, ["test"]);

            const nfa = builder.build(s0);
            const result = matchNFA(nfa, ["test"]);

            expect(result.matched).toBe(true);
        });

        it("should match wildcard values", () => {
            const builder = new NFABuilder();
            const s0 = builder.createState(false);
            const s1 = builder.createState(true);

            builder.addWildcardTransition(s0, s1, "value", "string");

            const nfa = builder.build(s0);
            const result = matchNFA(nfa, ["anything"]);

            // Raw NFA builder tests matching only (no environment setup)
            expect(result.matched).toBe(true);
        });

        it("should handle number type constraints", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "number",
                                variable: "count",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                count: { type: "variable", name: "count" },
                            },
                        },
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar);
            const result1 = matchNFA(nfa, ["42"]);
            const result2 = matchNFA(nfa, ["not-a-number"]);

            expect(result1.matched).toBe(true);
            expect(result1.actionValue).toEqual({ count: 42 });
            expect(result2.matched).toBe(false);
        });
    });

    describe("NFA Combination", () => {
        it("should combine NFAs in sequence", () => {
            const builder1 = new NFABuilder();
            const s0 = builder1.createState(false);
            const s1 = builder1.createState(true);
            builder1.addTokenTransition(s0, s1, ["hello"]);
            const nfa1 = builder1.build(s0);

            const builder2 = new NFABuilder();
            const s2 = builder2.createState(false);
            const s3 = builder2.createState(true);
            builder2.addTokenTransition(s2, s3, ["world"]);
            const nfa2 = builder2.build(s2);

            const combined = combineNFAs(nfa1, nfa2, "sequence");
            const result = matchNFA(combined, ["hello", "world"]);

            expect(result.matched).toBe(true);
        });

        it("should combine NFAs in choice", () => {
            const builder1 = new NFABuilder();
            const s0 = builder1.createState(false);
            const s1 = builder1.createState(true);
            builder1.addTokenTransition(s0, s1, ["hello"]);
            const nfa1 = builder1.build(s0);

            const builder2 = new NFABuilder();
            const s2 = builder2.createState(false);
            const s3 = builder2.createState(true);
            builder2.addTokenTransition(s2, s3, ["hi"]);
            const nfa2 = builder2.build(s2);

            const combined = combineNFAs(nfa1, nfa2, "choice");
            const result1 = matchNFA(combined, ["hello"]);
            const result2 = matchNFA(combined, ["hi"]);

            expect(result1.matched).toBe(true);
            expect(result2.matched).toBe(true);
        });
    });

    describe("NFA Debugging", () => {
        it("should print NFA structure", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: ["hello"],
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "test-grammar");
            const output = printNFA(nfa);

            expect(output).toContain("test-grammar");
            expect(output).toContain("Start state:");
            expect(output).toContain("Accepting states:");
        });

        it("should print match results", () => {
            const builder = new NFABuilder();
            const s0 = builder.createState(false);
            const s1 = builder.createState(true);
            builder.addTokenTransition(s0, s1, ["test"]);

            const nfa = builder.build(s0);
            const result = matchNFA(nfa, ["test"], true);
            const output = printMatchResult(result, ["test"]);

            expect(output).toContain("SUCCESS");
            expect(output).toContain("Tokens consumed");
        });
    });
});
