// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

describeForEachMatcher(
    "Grammar Matcher - Punctuation as Separator",
    (testMatchGrammar) => {
        // In "auto" and "optional" modes a punctuation character adjacent to a
        // flex-space position — at the end of the preceding literal or at the
        // start of the following literal — satisfies the separator requirement;
        // no additional separator is required in the input.
        // In "required" mode at least one separator character must always be
        // present in the input, regardless of adjacent literal content.
        describe("auto mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma satisfies the flex-space; no extra separator needed
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                // extra separator also accepted
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                // literal comma must be present
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma satisfies the flex-space from the following side
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation trailing boundary", () => {
                // Use a wildcard to consume the remaining input so finalizeState
                // does not reject trailing non-separator content. isBoundarySatisfied
                // is what determines whether the boundary after the comma passes.
                const g = `<Start> = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // trailing comma is a sufficient boundary; wildcard captures rest
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
        });
        describe("required mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> [spacing=required] = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma alone does not satisfy the boundary; a separator in the
                // input is still required
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> [spacing=required] = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
                // comma is consumed by the required separator, leaving nothing
                // to match the leading comma of the next literal
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation trailing boundary", () => {
                const g = `<Start> [spacing=required] = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // separator must come from the input after the comma
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
        });
        describe("optional mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> [spacing=optional] = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> [spacing=optional] = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
            });
            it("punctuation trailing boundary", () => {
                const g = `<Start> [spacing=optional] = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
        });
    },
);
