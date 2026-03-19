// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - directionSensitive",
    (matchGrammarCompletion) => {
        describe("single string part", () => {
            const g = `<Start> = play music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("not sensitive for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.directionSensitive).toBe(false);
            });

            it("not sensitive for partial first word 'pl'", () => {
                const result = matchGrammarCompletion(grammar, "pl");
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for first word fully typed 'play'", () => {
                // "play" fully matched — backward would back up to it.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play ' with trailing space", () => {
                // Trailing space commits — backward same as forward.
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for exact match 'play music'", () => {
                // Exact match with lastMatchedPartInfo — backward would
                // back up to "music".
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for exact match with trailing space 'play music '", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive when backward on exact match", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "backward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("multi-part via nested rule", () => {
            const g = [
                `<Start> = $(v:<Verb>) music -> true;`,
                `<Verb> = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("not sensitive for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive after nested rule consumed 'play'", () => {
                // "play" consumed the nested rule — backward could
                // reconsider it.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });
        });

        describe("wildcard grammar", () => {
            const g = [
                `<Start> = play $(song:<Song>) -> true;`,
                `<Song> = $(x:wildcard);`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("not sensitive for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.directionSensitive).toBe(false);
            });

            it("not sensitive after 'play' (wildcard not yet captured)", () => {
                // "play" matched the string part, but the nested wildcard
                // rule hasn't captured anything yet.  The nested rule
                // creates a fresh state without lastMatchedPartInfo.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for 'play some song' (wildcard captured)", () => {
                // Exact match with wildcard — backward would back up to
                // the wildcard.
                const result = matchGrammarCompletion(
                    grammar,
                    "play some song",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("Category 3b: partial match with direction", () => {
            const g = [
                `<Start> = play some music -> true;`,
                `<Start> = play some video -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play some music' (multi-word fully matched, no trailing space)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play some music ' (trailing space)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for 'play some' (two words matched, Category 3b)", () => {
                // "play some" partially matches both rules — "some" is
                // fully matched without trailing space, so backward would
                // back up.
                const result = matchGrammarCompletion(
                    grammar,
                    "play some",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play som' (trailing space commits 'play')", () => {
                // "play" fully matched but the space after it commits
                // that word (trailing separator).  "som" is a partial
                // match of "some" with no fully matched words at that
                // position.  So couldBackUp is false.
                const result = matchGrammarCompletion(
                    grammar,
                    "play som",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("not sensitive for partial first word 'pla'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "pla",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });
        });

        describe("varNumber part", () => {
            const g = `<Start> = set volume $(level) -> { actionName: "setVolume", parameters: { level } };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'set volume 42' (number matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("sensitive backward on 'set volume 42'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "backward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("optional part ()?", () => {
            const g = `<Start> = play (shuffle)? music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play' (optional not yet consumed)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play ' with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for 'play shuffle' (optional consumed, no trailing space)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("backward on 'play shuffle' backs up to 'shuffle'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "backward",
                );
                // Backward should back up to offer "shuffle" instead of
                // the next word "music".
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play shuffle ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });

            it("sensitive for exact match 'play shuffle music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle music",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("sensitive for exact match (optional skipped) 'play music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("repeat part ()+", () => {
            const g = `<Start> = play (song)+ now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("backward on 'play song' backs up", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "backward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("sensitive for 'play song song' (two iterations matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song song",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("not sensitive for 'play song ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song ",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(false);
            });
        });

        describe("repeat part ()*", () => {
            const g = `<Start> = play (song)* now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play' (zero iterations, but 'play' matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("spacing=none with backward", () => {
            const g = `<Start> [spacing=none] = play music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play' (couldBackUp always true in none mode)", () => {
                // In none mode, whitespace is not a separator, so
                // couldBackUp is always true when words match.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("backward on 'play' backs up to offer 'play'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "backward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("sensitive for 'playmusic' (exact match, none mode)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "playmusic",
                    undefined,
                    "forward",
                );
                expect(result.directionSensitive).toBe(true);
            });

            it("backward on 'playmusic' backs up to 'music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "playmusic",
                    undefined,
                    "backward",
                );
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("minPrefixLength with backward direction", () => {
            const g = [
                `<Start> = play music -> true;`,
                `<Start> = stop music -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward respects minPrefixLength", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    5,
                    "backward",
                );
                // minPrefixLength=5 means only completions at position ≥5
                // are relevant.  Backward on "play music" would back up
                // to "music" at position 4 (or 5 with space), which should
                // still be valid since 5 ≥ 5.
                expect(result.directionSensitive).toBe(true);
            });
        });

        describe("forward and backward produce same directionSensitive", () => {
            const g = `<Start> = play music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("both directions agree on sensitivity for 'play'", () => {
                const forward = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                const backward = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "backward",
                );
                expect(forward.directionSensitive).toBe(true);
                expect(backward.directionSensitive).toBe(true);
            });

            it("both directions agree on non-sensitivity for 'play '", () => {
                const forward = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                const backward = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "backward",
                );
                expect(forward.directionSensitive).toBe(false);
                expect(backward.directionSensitive).toBe(false);
            });
        });
    },
);
