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

        describe("Wildcard leaking into captured nested rule", () => {
            it("wildcard sibling does not prevent default value in following captured rule", () => {
                // Regression: when the wildcard alternative $(wc)->wc in
                // <Genre> is explored, the pending wildcard leaks into
                // <Suffix>.  matchStringPartWithWildcard must assign the
                // default string value for single-part rules (just like the
                // non-wildcard path) to avoid "No value assign to variable".
                const g = `
                    <Start> = $(v0:<Genre>) $(v1:<Suffix>)
                            -> { genre: v0, suffix: v1 };
                    <Genre> = rock -> "rock"
                            | pop -> "pop"
                            | $(wc) -> wc;
                    <Suffix> = tunes;
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                // Literal genre — may match via both literal and wildcard
                // paths; verify at least one result is correct.
                const rockResults = testMatchGrammar(grammar, "rock tunes");
                expect(rockResults).toContainEqual({
                    genre: "rock",
                    suffix: "tunes",
                });

                // Unknown genre — wildcard path, wc captures "metal",
                // then <Suffix> must still produce its default value.
                expect(testMatchGrammar(grammar, "metal tunes")).toStrictEqual([
                    { genre: "metal", suffix: "tunes" },
                ]);
            });

            it("wildcard with preceding literal and trailing captured rule", () => {
                // Same pattern but with a non-captured literal part before
                // the wildcard rule, matching the exportGrammar output shape.
                const g = `
                    <Start> = play $(v0:<Genre>) $(v1:<Suffix>)
                            -> { genre: v0, suffix: v1 };
                    <Genre> = rock -> "rock"
                            | $(wc) -> wc;
                    <Suffix> = tunes;
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                const rockResults = testMatchGrammar(
                    grammar,
                    "play rock tunes",
                );
                expect(rockResults).toContainEqual({
                    genre: "rock",
                    suffix: "tunes",
                });

                expect(
                    testMatchGrammar(grammar, "play metal tunes"),
                ).toStrictEqual([{ genre: "metal", suffix: "tunes" }]);
            });
        });

        describe("Default value for single-part captured sub-rules", () => {
            it("single string part produces default value (non-wildcard path)", () => {
                // <Verb> = play; is captured as $(v:<Verb>) — no wildcard
                // anywhere, so the non-wildcard path in
                // matchStringPartWithoutWildcard must assign the default.
                const g = `
                    <Start> = $(v:<Verb>) -> v;
                    <Verb> = play;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "play")).toStrictEqual([
                    "play",
                ]);
            });

            it("single string part with multiple alternatives (non-wildcard)", () => {
                const g = `
                    <Start> = $(v:<Action>) -> v;
                    <Action> = play | pause | stop;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "play")).toStrictEqual([
                    "play",
                ]);
                expect(testMatchGrammar(grammar, "pause")).toStrictEqual([
                    "pause",
                ]);
                expect(testMatchGrammar(grammar, "stop")).toStrictEqual([
                    "stop",
                ]);
            });

            it("single number part produces default value (non-wildcard path)", () => {
                // <Num> has a single $(n:number) part and no explicit value.
                // The number variable capture provides the rule's value.
                const g = `
                    <Start> = set $(v:<Num>) -> v;
                    <Num> = $(n:number);
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "set 42")).toStrictEqual([42]);
            });

            it("single wildcard part produces default value (no explicit ->)", () => {
                // <Any> has a single $(wc) part and no explicit value.
                // The wildcard variable capture provides the rule's value.
                const g = `
                    <Start> = find $(v:<Any>) -> v;
                    <Any> = $(wc);
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "find something"),
                ).toStrictEqual(["something"]);
            });

            it("single number part in captured sub-rule with wildcard sibling", () => {
                // Ensures the wildcard path for number parts also works
                // when a pending wildcard leaks from a sibling rule.
                const g = `
                    <Start> = $(v0:<Label>) $(v1:<Count>)
                            -> { label: v0, count: v1 };
                    <Label> = items -> "items"
                            | $(wc) -> wc;
                    <Count> = $(n:number);
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                // Known label — non-wildcard path
                expect(testMatchGrammar(grammar, "items 5")).toContainEqual({
                    label: "items",
                    count: 5,
                });

                // Unknown label — wildcard leaks into <Count>
                expect(testMatchGrammar(grammar, "widgets 10")).toStrictEqual([
                    { label: "widgets", count: 10 },
                ]);
            });
        });
    },
);
