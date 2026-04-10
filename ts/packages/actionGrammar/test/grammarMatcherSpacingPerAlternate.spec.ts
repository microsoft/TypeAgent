// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

describeForEachMatcher(
    "Grammar Matcher - Per-Alternate Spacing Mode",
    (testMatchGrammar) => {
        describe("one alternate with [spacing=none], other uses default", () => {
            const g = `<Start> = hello world -> "spaced" | [spacing=none] foo bar -> "nospace";`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("default alternate matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "spaced",
                ]);
            });
            it("default alternate does not match without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
            it("none alternate matches without space", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                    "nospace",
                ]);
            });
            it("none alternate does not match with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([]);
            });
        });

        describe("per-alternate overrides definition-level spacing", () => {
            // Definition uses spacing=none, but one alternate overrides to required
            const g = `<Start> [spacing=none] = ab cd -> "none" | [spacing=required] ef gh -> "required";`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("definition-level none: matches without space", () => {
                expect(testMatchGrammar(grammar, "abcd")).toStrictEqual([
                    "none",
                ]);
            });
            it("definition-level none: rejects with space", () => {
                expect(testMatchGrammar(grammar, "ab cd")).toStrictEqual([]);
            });
            it("per-alternate required: matches with space", () => {
                expect(testMatchGrammar(grammar, "ef gh")).toStrictEqual([
                    "required",
                ]);
            });
            it("per-alternate required: rejects without space", () => {
                expect(testMatchGrammar(grammar, "efgh")).toStrictEqual([]);
            });
        });

        describe("per-alternate [spacing=optional]", () => {
            const g = `<Start> = hello world -> "auto" | [spacing=optional] foo bar -> "optional";`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("optional alternate matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "optional",
                ]);
            });
            it("optional alternate matches without space", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                    "optional",
                ]);
            });
        });

        describe("multiple alternates with different spacing modes", () => {
            const g = `
                <Start> =
                    [spacing=none] ab cd -> "none"
                  | [spacing=optional] ef gh -> "optional"
                  | [spacing=required] ij kl -> "required";
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("none: adjacent matches", () => {
                expect(testMatchGrammar(grammar, "abcd")).toStrictEqual([
                    "none",
                ]);
            });
            it("none: spaced rejected", () => {
                expect(testMatchGrammar(grammar, "ab cd")).toStrictEqual([]);
            });
            it("optional: adjacent matches", () => {
                expect(testMatchGrammar(grammar, "efgh")).toStrictEqual([
                    "optional",
                ]);
            });
            it("optional: spaced matches", () => {
                expect(testMatchGrammar(grammar, "ef gh")).toStrictEqual([
                    "optional",
                ]);
            });
            it("required: spaced matches", () => {
                expect(testMatchGrammar(grammar, "ij kl")).toStrictEqual([
                    "required",
                ]);
            });
            it("required: adjacent rejected", () => {
                expect(testMatchGrammar(grammar, "ijkl")).toStrictEqual([]);
            });
        });

        describe("per-alternate spacing with variables", () => {
            const g = `<Start> = play $(x) -> x | [spacing=none] stop $(y:number) -> y;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("default alternate captures variable with space", () => {
                expect(testMatchGrammar(grammar, "play song")).toStrictEqual([
                    "song",
                ]);
            });
            it("none alternate captures variable without space", () => {
                expect(testMatchGrammar(grammar, "stop5")).toStrictEqual([5]);
            });
            it("none alternate rejects variable with space", () => {
                expect(testMatchGrammar(grammar, "stop 5")).toStrictEqual([]);
            });
        });

        describe("per-alternate spacing with rule references", () => {
            const g = `
                <Inner> = (yes | no) -> "inner";
                <Start> = ask <Inner> -> "auto" | [spacing=none] ask<Inner> -> "none";
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("auto alternate matches with space", () => {
                expect(testMatchGrammar(grammar, "ask yes")).toStrictEqual([
                    "auto",
                ]);
            });
            it("none alternate matches without space", () => {
                expect(testMatchGrammar(grammar, "askyes")).toStrictEqual([
                    "none",
                ]);
            });
        });

        describe("per-alternate [spacing=auto] is same as no annotation", () => {
            // Explicit [spacing=auto] on an alternate should behave
            // identically to having no annotation at all.
            const g = `<Start> = hello world -> "default" | [spacing=auto] foo bar -> "auto";`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("auto alternate matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "auto",
                ]);
            });
            it("auto alternate rejects without space (Latin)", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([]);
            });
        });
    },
);
