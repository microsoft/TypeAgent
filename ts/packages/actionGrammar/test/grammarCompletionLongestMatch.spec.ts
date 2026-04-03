// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - longest match property",
    (matchGrammarCompletion) => {
        describe("three sequential parts", () => {
            // Verifies that after matching 2 of 3 parts, completion is the 3rd part.
            const g = [
                `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) -> { a, b, c };`,
                `<A> = first -> "a";`,
                `<B> = second -> "b";`,
                `<C> = third -> "c";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("completes first part for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toContain("first");
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes second part after first matched", () => {
                const result = matchGrammarCompletion(grammar, "first");
                expect(result.completions).toContain("second");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes second part after first matched with space", () => {
                const result = matchGrammarCompletion(grammar, "first ");
                expect(result.completions).toContain("second");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes third part after first two matched", () => {
                const result = matchGrammarCompletion(grammar, "first second");
                expect(result.completions).toContain("third");
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes third part after first two matched with space", () => {
                const result = matchGrammarCompletion(grammar, "first second ");
                expect(result.completions).toContain("third");
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match backs up to last term", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "first second third",
                );
                // Exact match backs up to the last term.
                expectMetadata(result, {
                    completions: ["third"],
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("backward: exact match also backs up to last term", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "first second third",
                    undefined,
                    "backward",
                );
                // Category 1 is direction-agnostic — backward
                // produces the same result as forward.
                expectMetadata(result, {
                    completions: ["third"],
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("partial prefix of third part completes correctly", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "first second th",
                );
                expect(result.completions).toContain("third");
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("four sequential parts", () => {
            const g = [
                `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) $(d:<D>) -> { a, b, c, d };`,
                `<A> = alpha -> "a";`,
                `<B> = bravo -> "b";`,
                `<C> = charlie -> "c";`,
                `<D> = delta -> "d";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("completes delta after three parts matched", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "alpha bravo charlie",
                );
                expect(result.completions).toContain("delta");
                expectMetadata(result, {
                    matchedPrefixLength: 19,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes charlie after two parts matched", () => {
                const result = matchGrammarCompletion(grammar, "alpha bravo");
                expect(result.completions).toContain("charlie");
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("competing rules - longer match wins", () => {
            // Two rules: short (2 parts) and long (3 parts).
            // When first two parts match, the short rule is a full match (no
            // completion) and the long rule offers completion for the third part.
            const g = [
                `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) -> { a, b, c };`,
                `<A> = alpha -> "a";`,
                `<B> = bravo -> "b";`,
                `<C> = charlie -> "c";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("short rule is exact match; long rule offers completion", () => {
                const result = matchGrammarCompletion(grammar, "alpha bravo");
                // Short rule matches exactly, no completion from it.
                // Long rule matches alpha + bravo and offers "charlie".
                expect(result.completions).toContain("charlie");
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("both rules offer completions at same depth for first part", () => {
                const result = matchGrammarCompletion(grammar, "alpha");
                // Both rules need "bravo" next.
                expect(result.completions).toContain("bravo");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("competing rules - different next parts at same depth", () => {
            // Two rules that share a prefix but diverge after.
            const g = [
                `<Start> = $(a:<A>) suffix_x -> "rx";`,
                `<Start> = $(a:<A>) suffix_y -> "ry";`,
                `<A> = prefix -> "a";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers both alternatives after shared prefix", () => {
                const result = matchGrammarCompletion(grammar, "prefix");
                expect(result.completions).toContain("suffix_x");
                expect(result.completions).toContain("suffix_y");
                expectMetadata(result, {
                    matchedPrefixLength: 6,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match backs up and shows alternatives", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "prefix suffix_x",
                );
                // Rule 1 (suffix_x) matches exactly and backs up to
                // position 6 (after "prefix"). Both suffix_x and suffix_y
                // are offered at this position.
                expectMetadata(result, {
                    completions: ["suffix_x", "suffix_y"],
                    matchedPrefixLength: 6,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("optional part followed by required part", () => {
            const g = [
                `<Start> = $(a:<A>) $(b:<B>)? $(c:<C>) -> { a, c };`,
                `<A> = begin -> "a";`,
                `<B> = middle -> "b";`,
                `<C> = finish -> "c";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers both optional and skip alternatives after first part", () => {
                const result = matchGrammarCompletion(grammar, "begin");
                // Should offer "middle" (optional) and "finish" (skipping optional)
                expect(result.completions).toContain("middle");
                expect(result.completions).toContain("finish");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("offers finish after optional part matched", () => {
                const result = matchGrammarCompletion(grammar, "begin middle");
                expect(result.completions).toContain("finish");
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("longest path wins for 'finish' completion when optional is matched", () => {
                // When "begin middle" is typed:
                //   - Through-optional path: matches "begin" + "middle",
                //     offers "finish" at matchedPrefixLength=12.
                //   - Skip-optional path: matches "begin" (index=5),
                //     offers "finish" at matchedPrefixLength=5 — but this
                //     is filtered out because a longer match (12) exists.
                const result = matchGrammarCompletion(grammar, "begin middle");
                expect(result.completions).toContain("finish");
                expectMetadata(result, {
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("completion after number variable", () => {
            const g = [
                `<Start> = set volume $(n:number) percent -> { volume: n };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("completes 'percent' after number matched", () => {
                const result = matchGrammarCompletion(grammar, "set volume 50");
                expect(result.completions).toContain("percent");
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes 'percent' after number with space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 50 ",
                );
                expect(result.completions).toContain("percent");
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match backs up to last term", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 50 percent",
                );
                // Exact match backs up to last term "percent".
                expectMetadata(result, {
                    completions: ["percent"],
                    matchedPrefixLength: 13,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("multiple alternatives in nested rule", () => {
            // After matching a prefix, the nested rule has multiple alternatives
            // for the next part, all at the same depth.
            const g = [
                `<Start> = play $(g:<Genre>) -> { genre: g };`,
                `<Genre> = rock -> "rock";`,
                `<Genre> = pop -> "pop";`,
                `<Genre> = jazz -> "jazz";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers all genre alternatives after 'play'", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toContain("rock");
                expect(result.completions).toContain("pop");
                expect(result.completions).toContain("jazz");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("all alternatives offered even with partial trailing text", () => {
                const result = matchGrammarCompletion(grammar, "play r");
                // All genre alternatives are reported after the longest
                // complete match "play"; the caller filters by "r".
                expect(result.completions).toContain("rock");
                expect(result.completions).toContain("pop");
                expect(result.completions).toContain("jazz");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("all alternatives offered with 'p' trailing text", () => {
                const result = matchGrammarCompletion(grammar, "play p");
                // All are reported; caller filters by "p".
                expect(result.completions).toContain("pop");
                expect(result.completions).toContain("rock");
                expect(result.completions).toContain("jazz");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("closedSet=true for first string part on empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toContain("play");
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match backs up and shows all alternatives", () => {
                const result = matchGrammarCompletion(grammar, "play rock");
                // Exact match backs up to position 4 (after "play"),
                // showing all alternatives: rock, pop, jazz.
                expectMetadata(result, {
                    completions: ["rock", "pop", "jazz"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("wildcard between string parts - longest match", () => {
            // Grammar: verb WILDCARD terminator
            // Completion should offer terminator only after wildcard captures text.
            const g = [
                `<Start> = play $(name) by $(artist) -> { name, artist };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers wildcard property after 'play'", () => {
                const result = matchGrammarCompletion(grammar, "play");
                // Wildcard is next, should have property completion
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                });
            });

            it("offers 'by' terminator after wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "play hello");
                expect(result.completions).toContain("by");
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("offers artist wildcard property after 'by'", () => {
                const result = matchGrammarCompletion(grammar, "play hello by");
                // After "by", the next part is the artist wildcard
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "all",
                });
            });
        });

        describe("deep nesting - three levels of rules", () => {
            const g = [
                `<Start> = $(x:<Outer>) done -> { x };`,
                `<Outer> = $(y:<Inner>) -> y;`,
                `<Inner> = deep -> "deep";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("completes 'deep' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toContain("deep");
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes 'done' after deeply nested match", () => {
                const result = matchGrammarCompletion(grammar, "deep");
                expect(result.completions).toContain("done");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("repeat group (+) completion", () => {
            // Grammar with ()+ repeat group using inline alternatives
            const g = `<Start> = hello (world | earth)+ done -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers 'hello' for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toContain("hello");
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("offers repeat alternatives after 'hello'", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                // After "hello", the ()+ group requires at least one match
                expect(result.completions).toContain("world");
                expect(result.completions).toContain("earth");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("offers 'done' and repeat alternatives after first repeat match", () => {
                const result = matchGrammarCompletion(grammar, "hello world");
                // After one repeat match, can repeat or proceed to "done"
                expect(result.completions).toContain("done");
                // Also should offer repeat alternatives
                expect(
                    result.completions.includes("world") ||
                        result.completions.includes("earth"),
                ).toBe(true);
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("offers 'done' after two repeat matches", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "hello world earth",
                );
                expect(result.completions).toContain("done");
                expectMetadata(result, {
                    matchedPrefixLength: 17,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("partial prefix vs longest match interaction", () => {
            // Test that partial prefix matching from a shorter rule does not
            // interfere with the longest match from a longer rule.
            //
            // Rule 1's string part "beta gamma" partially matches "beta" in the
            // remaining text, while Rule 2 fully matches "beta" as a separate
            // nested rule and offers "gamma" from the longer match.
            //
            // Both completions may appear because they're valid for different
            // interpretations. The key property is that matchedPrefixLength
            // reflects the longest consumed prefix.
            const g = [
                `<Start> = $(a:<A>) beta gamma -> "r1";`,
                `<Start> = $(a:<A>) $(b:<B>) gamma -> "r2";`,
                `<A> = alpha -> "a";`,
                `<B> = beta -> "b";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("matchedPrefixLength reflects longest consumed prefix", () => {
                const result = matchGrammarCompletion(grammar, "alpha beta");
                // Rule 2 matches alpha + beta = 10 chars.
                // matchedPrefixLength should be at least 10 (from the longest match).
                expect(result.matchedPrefixLength).toBeGreaterThanOrEqual(10);
                // "gamma" must appear as completion from the longer match.
                expect(result.completions).toContain("gamma");
                expectMetadata(result, {
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("shorter partial prefix completion also appears (known behavior)", () => {
                const result = matchGrammarCompletion(grammar, "alpha beta");
                // Rule 1 may produce "beta gamma" via isPartialPrefixOfStringPart
                // since "beta" is a prefix of "beta gamma". This is expected:
                // both rules produce valid completions for the input.
                // We verify maxPrefixLength is from the longest match.
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("case insensitive matching for completions", () => {
            const g = [
                `<Start> = $(a:<A>) World -> { a };`,
                `<A> = Hello -> "hello";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("completes after case-insensitive match", () => {
                const result = matchGrammarCompletion(grammar, "hello");
                expect(result.completions).toContain("World");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("completes after uppercase input", () => {
                const result = matchGrammarCompletion(grammar, "HELLO");
                expect(result.completions).toContain("World");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("partial prefix is case insensitive", () => {
                const result = matchGrammarCompletion(grammar, "hello WO");
                expect(result.completions).toContain("World");
                expectMetadata(result, {
                    matchedPrefixLength: 5,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("no spurious completions from unrelated rules", () => {
            // Two completely different rules. Only the matching one should
            // produce completions.
            const g = [
                `<Start> = play $(g:<Genre>) -> { action: "play", genre: g };`,
                `<Start> = stop $(r:<Reason>) -> { action: "stop", reason: r };`,
                `<Genre> = rock -> "rock";`,
                `<Reason> = now -> "now";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("only matching rule offers completions for 'play'", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toContain("rock");
                expect(result.completions).not.toContain("now");
                expect(result.completions).not.toContain("stop");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("only matching rule offers completions for 'stop'", () => {
                const result = matchGrammarCompletion(grammar, "stop");
                expect(result.completions).toContain("now");
                expect(result.completions).not.toContain("rock");
                expect(result.completions).not.toContain("play");
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("all first parts offered for unrelated input", () => {
                const result = matchGrammarCompletion(grammar, "dance");
                // Nothing consumed; all first string parts from every rule
                // are offered at prefixLength 0.  The caller filters by
                // the trailing text "dance".
                expect(result.completions.sort()).toEqual(["play", "stop"]);
                expectMetadata(result, {
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("completion with entity wildcard", () => {
            // Entity wildcards should produce property completions, not string
            // completions, and matchedPrefixLength should indicate where the
            // entity value begins.
            const g = [
                `import { SongName };`,
                `<Start> = play $(song:SongName) next -> { song };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("entity wildcard produces property completion", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                });
            });

            it("string terminator after entity text", () => {
                const result = matchGrammarCompletion(grammar, "play mysong");
                expect(result.completions).toContain("next");
                expectMetadata(result, {
                    matchedPrefixLength: 11,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });

        describe("completion at boundary between consumed and remaining", () => {
            // Verify that trailing separators (spaces) don't affect
            // which part is offered for completion.
            const g = [
                `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
                `<A> = one -> "a";`,
                `<B> = two -> "b";`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("same completion with and without trailing space", () => {
                const r1 = matchGrammarCompletion(grammar, "one");
                const r2 = matchGrammarCompletion(grammar, "one ");
                const r3 = matchGrammarCompletion(grammar, "one  ");
                expect(r1.completions).toEqual(r2.completions);
                expect(r2.completions).toEqual(r3.completions);
                expect(r1.completions).toContain("two");
                expect(r1.separatorMode).toBe("spacePunctuation");
                expect(r2.separatorMode).toBe("spacePunctuation");
                expect(r3.separatorMode).toBe("spacePunctuation");
                expect(r1.closedSet).toBe(true);
                expect(r2.closedSet).toBe(true);
                expect(r3.closedSet).toBe(true);
                expect(r1.afterWildcard).toBe("none");
                expect(r2.afterWildcard).toBe("none");
                expect(r3.afterWildcard).toBe("none");
                expect(r1.properties).toEqual([]);
                expect(r2.properties).toEqual([]);
                expect(r3.properties).toEqual([]);
            });

            it("matchedPrefixLength does not include trailing whitespace", () => {
                const r1 = matchGrammarCompletion(grammar, "one");
                const r2 = matchGrammarCompletion(grammar, "one ");
                const r3 = matchGrammarCompletion(grammar, "one  ");
                // matchedPrefixLength stays at 3 regardless of trailing space.
                expect(r1.matchedPrefixLength).toBe(3);
                expect(r2.matchedPrefixLength).toBe(3);
                expect(r3.matchedPrefixLength).toBe(3);
                // directionSensitive: true (P > 0)
                expect(r1.directionSensitive).toBe(true);
                expect(r2.directionSensitive).toBe(true);
                expect(r3.directionSensitive).toBe(true);
            });
        });

        describe("closedSet flag - exhaustiveness", () => {
            describe("mixed string and entity at same prefix length", () => {
                // Two rules sharing "play" prefix: one leads to string
                // completion ("shuffle"), one to entity property.
                // Both completions should be present regardless of rule order.

                it("entity rule first, string rule second", () => {
                    const g = [
                        `import { SongName };`,
                        `<Start> = play $(song:SongName) -> { action: "search", song };`,
                        `<Start> = play shuffle -> { action: "shuffle" };`,
                    ].join("\n");
                    const grammar = loadGrammarRules("test.grammar", g);
                    const result = matchGrammarCompletion(grammar, "play");
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.completions).toContain("shuffle");
                    expect(result.properties).toBeDefined();
                    expect(result.properties!.length).toBeGreaterThan(0);
                    expectMetadata(result, {
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
                    });
                });

                it("string rule first, entity rule second", () => {
                    const g = [
                        `import { SongName };`,
                        `<Start> = play shuffle -> { action: "shuffle" };`,
                        `<Start> = play $(song:SongName) -> { action: "search", song };`,
                    ].join("\n");
                    const grammar = loadGrammarRules("test.grammar", g);
                    const result = matchGrammarCompletion(grammar, "play");
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.completions).toContain("shuffle");
                    expect(result.properties).toBeDefined();
                    expect(result.properties!.length).toBeGreaterThan(0);
                    expectMetadata(result, {
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
                    });
                });
            });

            describe("competing rules - longer match resets closedSet", () => {
                const g = [
                    `import { SongName };`,
                    `<Start> = $(a:<A>) $(song:SongName) -> { a, song };`,
                    `<Start> = $(a:<A>) $(b:<B>) finish -> { a, b };`,
                    `<A> = alpha -> "a";`,
                    `<B> = bravo -> "b";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("closedSet reflects longest prefix length result", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "alpha bravo",
                    );
                    // Rule 2 matches alpha+bravo (11 chars) and offers "finish"
                    // (string → closedSet=true).
                    // Rule 1 matches alpha (5 chars) and offers entity
                    // (closedSet=false) — but this is at a shorter prefix
                    // length so it's discarded.
                    expect(result.completions).toContain("finish");
                    expectMetadata(result, {
                        matchedPrefixLength: 11,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });
        });

        describe("afterWildcard flag — ambiguous wildcard boundary", () => {
            const g = [
                `<Start> = play $(name) by $(artist) -> { name, artist };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            describe("forward: wildcard finalized at end-of-input", () => {
                it('afterWildcard="all" for single-word wildcard before keyword', () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                    );
                    expect(result.completions).toContain("by");
                    expectMetadata(result, {
                        matchedPrefixLength: 10,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });

                it('afterWildcard="all" for multi-word wildcard before keyword', () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play my favorite song",
                    );
                    expect(result.completions).toContain("by");
                    expectMetadata(result, {
                        matchedPrefixLength: 21,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });

                it('afterWildcard="all" for ambiguous keyword boundary', () => {
                    // "play hello by" is ambiguous: "by" could be part of
                    // the track name or the keyword delimiter.  The grammar
                    // produces both interpretations at prefix length 13.
                    // The definite-keyword path produces a property
                    // candidate (not a string), so it doesn't suppress
                    // afterWildcard — the "by" string completion is from
                    // the wildcard path and is slidable.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello by",
                    );
                    expectMetadata(result, {
                        matchedPrefixLength: 13,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "all",
                    });
                });

                it('afterWildcard="all" persists with trailing separator', () => {
                    // "play hello by " — still ambiguous: "by " could be
                    // part of the track name in one interpretation.
                    // The definite-keyword path produces a property
                    // candidate (not a string), so afterWildcard stays
                    // true — the "by" string completion is wildcard-stable.
                    //
                    // Phase B2: the gap between mpl=13 and anchor=14 is
                    // a single trailing space (separator-only), so the
                    // existing Cat 2 candidate (property completion for
                    // $(artist)) is preserved.  The separator in the gap
                    // has been consumed → separatorMode demoted to
                    // "optional".  closedSet=false because the property
                    // slot is open-ended.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello by ",
                    );
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 13,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [
                            {
                                match: { name: "hello" },
                                propertyNames: ["artist"],
                            },
                        ],
                    });
                });
            });

            describe("backward: wildcard start is definite", () => {
                it('afterWildcard="none" for backward to wildcard start', () => {
                    // Backward on "play hello" backs up to the wildcard
                    // start (position 4) — that position is definite,
                    // not ambiguous, so afterWildcard must be "none".
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
                    });
                });

                it('afterWildcard="none" for backward to wildcard start with multi-word', () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play my favorite song",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
                    });
                });
            });

            describe("backward: keyword after captured wildcard is ambiguous", () => {
                it('afterWildcard="all" for backward to keyword after captured wildcard', () => {
                    // "play something by" backward: the $(artist) wildcard
                    // is unfilled.  Backward should back up to "by" (the
                    // last keyword), not offer $(artist).  Position is
                    // ambiguous because the $(track) wildcard could absorb
                    // more text, so afterWildcard must be "all".
                    const result = matchGrammarCompletion(
                        grammar,
                        "play something by",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toContain("by");
                    expectMetadata(result, {
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });

                it("forward offers property completion for unfilled wildcard after keyword", () => {
                    // "play something by" forward: should offer property
                    // completion for $(artist) at the end, not back up.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play something by",
                    );
                    expect(result.properties).toBeDefined();
                    expect(result.properties!.length).toBeGreaterThan(0);
                    expectMetadata(result, {
                        matchedPrefixLength: 17,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "all",
                    });
                });

                it('afterWildcard="all" for backward after multi-word wildcard and keyword', () => {
                    // "play my favorite song by" backward: backs up to
                    // "by" at the boundary of "my favorite song".  The
                    // wildcard could absorb "by" as part of the track name.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play my favorite song by",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toContain("by");
                    expectMetadata(result, {
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe('backward: "play hello by " — property fallback', () => {
                it("backward: offers property completion via Category 3a fallback", () => {
                    // When tryCollectBackwardCandidate returns false for
                    // a property candidate, the engine falls back to
                    // collectPropertyCandidate so the $(artist) slot
                    // is still offered.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello by ",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 13,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [
                            {
                                match: { name: "hello" },
                                propertyNames: ["artist"],
                            },
                        ],
                    });
                });
            });
        });

        describe("partial keyword after wildcard — 'play Never b'", () => {
            const g = [
                `<Start> = play $(name) by $(artist) -> { name, artist };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward: offers 'by' with afterWildcard=\"all\"", () => {
                const result = matchGrammarCompletion(grammar, "play Never b");
                expect(result.completions).toContain("by");
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: offers 'by' (partial keyword wins over wildcard start)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play Never b",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("by");
                expectMetadata(result, {
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("forward: partial keyword with multi-word wildcard", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play my favorite song b",
                );
                expect(result.completions).toContain("by");
                expectMetadata(result, {
                    matchedPrefixLength: 21,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: partial keyword with multi-word wildcard", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play my favorite song b",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("by");
                expectMetadata(result, {
                    matchedPrefixLength: 21,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });

        describe("partial keyword after wildcard — spacing=none", () => {
            const g = [
                `<Start> [spacing=none] = play $(name) playedby $(artist) -> { name, artist };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward: partial keyword prefix in none mode", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "playNeverp",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("playedby");
                expectMetadata(result, {
                    matchedPrefixLength: 9,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: longer partial keyword prefix in none mode", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "playNeverplayedb",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("playedby");
                expectMetadata(result, {
                    matchedPrefixLength: 9,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: multi-word wildcard with partial keyword in none mode", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "playMyFavSongplayedb",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("playedby");
                expectMetadata(result, {
                    matchedPrefixLength: 13,
                    separatorMode: "none",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });
    },
);
