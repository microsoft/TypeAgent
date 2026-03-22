// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

describeForEachMatcher(
    "Grammar Matcher - Groups and Recursion",
    (testMatchGrammar) => {
        describe("Repeat GroupExpr", () => {
            it("()* - zero matches", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
            it("()* - one match", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("()* - two matches", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("()+ - zero matches not accepted", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([]);
            });
            it("()+ - one match", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("()+ - two matches", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("()* - alternates in group", () => {
                const g = `<Start> = hello (world | earth)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world earth world"),
                ).toStrictEqual([true]);
            });
            it("()+ - suffix after repeat", () => {
                const g = `<Start> = hello (world)+ end -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world end"),
                ).toStrictEqual([true]);
            });
        });

        describe("Recursive rules", () => {
            // Regression: when a rule has a non-epsilon back-reference to itself,
            // the compiled RulesPart.rules must point to the final populated array,
            // not the empty sentinel assigned before compilation begins.
            // If the sentinel is captured (bug), the recursive match silently fails.
            it("right-recursive rule reference can match multi-token input", () => {
                // <Start> = foo <Start> -> "hit" | bar -> "bar"
                // "foo bar": foo consumes mandatory input, then <Start> matches "bar"
                const g = `
                <Start> = foo <Start> -> "hit"
                        | bar -> "bar";
            `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "hit",
                ]);
            });

            it("right-recursive variable rule can match multi-token input", () => {
                // <Start> = foo $(x:<Start>) -> x | bar -> "bar"
                // "foo bar": foo consumes mandatory input, then $(x:<Start>) captures "bar"
                const g = `
                <Start> = foo $(x:<Start>) -> x
                        | bar -> "bar";
            `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "bar",
                ]);
            });
        });
    },
);
