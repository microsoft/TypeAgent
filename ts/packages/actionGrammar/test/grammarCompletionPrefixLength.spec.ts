// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - matchedPrefixLength",
    (matchGrammarCompletion) => {
        describe("single string part", () => {
            // All words in one string part — when no leading words match,
            // matchedPrefixLength is 0 and only the first word is offered
            // as a completion.  When leading words match, matchedPrefixLength
            // advances and only the remaining words are offered.
            const g = `<Start> = play music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns first word as completion for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns first word as completion for partial prefix", () => {
                const result = matchGrammarCompletion(grammar, "pl");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns remaining words as completion for first word typed", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                // tryPartialStringMatch splits the multi-word part: "play"
                // is consumed (4 chars), trailing space advances to 5.
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns first word for non-matching input", () => {
                const result = matchGrammarCompletion(grammar, "xyz");
                // Nothing consumed; only the first word of the string part is
                // offered so the caller can filter by trailing text.
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns matchedPrefixLength for exact match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                // Exact match now records the full consumed length.
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });

            it("offers next word for first word fully typed (no space)", () => {
                // "play" fully matched, no trailing space → direction-sensitive
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not direction-sensitive for exact match with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play music ");
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(11);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("multi-part via nested rule", () => {
            // Nested rule creates separate parts, so matchedPrefixLength
            // reflects the position after the consumed nested rule.
            const g = [
                `<Start> = $(v:<Verb>) music -> true;`,
                `<Verb> = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns nested rule text for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns second part after nested rule consumed", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                // "play" fully matched, no trailing separator → direction-sensitive
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("returns second part after nested rule with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(5);
                // Trailing space commits → not direction-sensitive
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("reports optional separatorMode for partial prefix match", () => {
                // "pl" matches partially → the completion replaces from state.index,
                // so no separator needed (user is typing the keyword)
                const result = matchGrammarCompletion(grammar, "pl");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns second part for partial second word", () => {
                const result = matchGrammarCompletion(grammar, "play m");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("returns matchedPrefixLength for complete match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });
        });

        describe("multiple rules with shared prefix", () => {
            // Multiple rules that share a prefix via nested rules
            const g = [
                `<Start> = $(v:<Verb>) music -> "play_music";`,
                `<Start> = $(v:<Verb>) video -> "play_video";`,
                `<Verb> = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns both completions after shared prefix", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                expect(result.completions.sort()).toEqual(["music", "video"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("wildcard with terminator", () => {
            // Wildcard between string parts: "play $(name) now"
            const g = `<Start> = play $(name) now -> { name: name };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns wildcard property (not terminator) when only separator follows wildcard start", () => {
                // "play " — the trailing space is only a separator, not valid
                // wildcard content, so the wildcard can't finalize and we fall
                // through to the property-completion path instead of offering
                // the terminator string.  Trailing space advances to 5.
                const result = matchGrammarCompletion(grammar, "play ");
                expect(result.completions).toEqual([]);
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns terminator with matchedPrefixLength tracking wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "play hello");
                expect(result.completions).toEqual(["now"]);
                expect(result.properties).toEqual([]);
                // Wildcard consumed "hello" — matchedPrefixLength includes it
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(true);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("returns terminator with matchedPrefixLength for trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play hello ");
                expect(result.completions).toEqual(["now"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(11);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(true);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("wildcard without terminator", () => {
            const g = `<Start> = play $(name) -> { name: name };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns start rule for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns property completion for separator-only trailing wildcard", () => {
                // The trailing space is not valid wildcard content, so the
                // wildcard can't finalize.  The else-branch produces a
                // property completion instead.  Trailing space advances
                // matchedPrefixLength to 5.
                const result = matchGrammarCompletion(grammar, "play ");
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("CJK multi-part with nested rule", () => {
            // CJK requires multi-part grammar for meaningful matchedPrefixLength
            const g = [
                `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
                `<Verb> [spacing=auto] = 再生 -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns verb for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["再生"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns noun completion after CJK verb typed", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                expect(result.completions).toEqual(["音楽"]);
                expect(result.properties).toEqual([]);
                // "再生" is 2 chars; matchedPrefixLength reflects position after verb
                expect(result.matchedPrefixLength).toBe(2);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns noun completion after CJK verb with space", () => {
                const result = matchGrammarCompletion(grammar, "再生 ");
                expect(result.completions).toEqual(["音楽"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(3);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns no completions for exact match", () => {
                const result = matchGrammarCompletion(grammar, "再生音楽");
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });
        });

        describe("CJK single string part", () => {
            // Single string part — only the first word is offered initially.
            // After the first word matches, the remaining words are offered.
            const g = `<Start> [spacing=auto] = 再生 音楽 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns first word for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["再生"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns remaining words for partial CJK prefix", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                // tryPartialStringMatch splits the multi-word part: "再生"
                // is consumed (2 chars), "音楽" remains as the completion.
                expect(result.completions).toEqual(["音楽"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(2);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("CJK wildcard", () => {
            const g = `<Start> [spacing=auto] = 再生 $(name) 停止 -> { name: name };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns property completion when only separator follows CJK wildcard start", () => {
                // Same as the Latin case: trailing space is a separator, not
                // valid wildcard content, so the terminator isn't offered.
                // Trailing space advances matchedPrefixLength to 3.
                const result = matchGrammarCompletion(grammar, "再生 ");
                expect(result.completions).toEqual([]);
                expect(result.properties).toBeDefined();
                expect(result.properties!.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(3);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("returns terminator after CJK prefix + wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "再生 hello");
                expect(result.completions).toEqual(["停止"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(8);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(true);
                expect(result.separatorMode).toBe("optional");
            });
        });

        describe("separatorMode - CJK multi-part", () => {
            // CJK grammar: "再生" → "音楽" does NOT require a space separator
            const g = [
                `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
                `<Verb> [spacing=auto] = 再生 -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode for CJK '再生' → '音楽'", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                expect(result.completions).toEqual(["音楽"]);
                expect(result.properties).toEqual([]);
                // CJK → CJK in auto mode: separator optional
                expect(result.matchedPrefixLength).toBe(2);
                expect(result.separatorMode).toBe("optional");
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
            });
        });

        describe("separatorMode - mixed scripts", () => {
            // Latin followed by CJK: no separator needed in auto mode
            const g = [
                `<Start> [spacing=auto] = $(v:<Verb>) 音楽 -> true;`,
                `<Verb> [spacing=auto] = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode for Latin 'play' → CJK '音楽'", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual(["音楽"]);
                expect(result.properties).toEqual([]);
                // Latin → CJK in auto mode: different scripts, separator optional
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("optional");
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
            });
        });

        describe("separatorMode - spacing=required", () => {
            const g = [
                `<Start> [spacing=required] = $(v:<Verb>) music -> true;`,
                `<Verb> [spacing=required] = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode when spacing=required", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("spacePunctuation");
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
            });
        });

        describe("separatorMode - spacing=optional", () => {
            const g = [
                `<Start> [spacing=optional] = $(v:<Verb>) music -> true;`,
                `<Verb> [spacing=optional] = play -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports optional separatorMode when spacing=optional", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.separatorMode).toBe("optional");
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
            });
        });

        describe("separatorMode - wildcard entity", () => {
            // Grammar where the completion is a wildcard entity (not a static string).
            // separatorMode describes the boundary at matchedPrefixLength.
            const g = [
                `entity TrackName;`,
                `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode for 'play' before wildcard", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expect(result.completions).toEqual([]);
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(4);
                // matchedPrefixLength=4; boundary "y" → entity needs separator.
                expect(result.separatorMode).toBe("spacePunctuation");
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
            });

            it("reports separatorMode for 'play ' before wildcard", () => {
                // Trailing space consumed: matchedPrefixLength advances to 5,
                // separatorMode demoted to "optional".
                const result = matchGrammarCompletion(grammar, "play ");
                expect(result.completions).toEqual([]);
                expect(result.properties?.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.separatorMode).toBe("optional");
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
            });
        });

        describe("backward direction", () => {
            describe("all-literal single string part", () => {
                const g = `<Start> = play music -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("exact match backward offers last literal word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // Backward backs up to the last matched word "music"
                    // and re-offers it as a completion.
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward exact match still returns empty completions", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(10);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBeUndefined();
                });
            });

            describe("three-word single string part", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("partial match backward offers last matched word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // Backward: "play" and "music" matched, so it backs
                    // up to offer "music" (the last matched word).
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("partial match forward offers next unmatched word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(10);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("multi-part via nested rule", () => {
                const g = [
                    `<Start> = $(v:<Verb>) music now -> true;`,
                    `<Verb> = play -> true;`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward backs up to last matched literal", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // "play" matched the verb rule, "music" matched the
                    // second word. Backward backs up to "music".
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward offers next unmatched word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(10);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("wildcard at end", () => {
                const g = [
                    `entity TrackName;`,
                    `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on exact match backs up to wildcard start with property", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "backward",
                    );
                    // Backward: backs up to wildcard start (after "play" = 4)
                    // and offers entity property completions.
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties?.length).toBeGreaterThan(0);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(false);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward on exact match returns empty completions", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(10);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBeUndefined();
                });
            });

            describe("wildcard in middle", () => {
                const g = [
                    `entity TrackName;`,
                    `<Start> = play $(name:TrackName) now -> { actionName: "play", parameters: { name } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on exact match backs up to last literal 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello now",
                        undefined,
                        "backward",
                    );
                    // Backward: the wildcard was captured mid-match when
                    // "now" matched, so "now" is the last matched part.
                    // Backward backs up to offer "now" (not the wildcard).
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(10);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward offers 'now' (greedy wildcard alternative)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello now",
                        undefined,
                        "forward",
                    );
                    // The wildcard greedily consumed "hello now", so the
                    // "now" string part is still unmatched — it appears
                    // as a completion at the same prefix length.
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(14);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("wildcard followed by multiple literals", () => {
                const g = [
                    `entity TrackName;`,
                    `<Start> = play $(name:TrackName) right now -> { actionName: "play", parameters: { name } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward backs up to last literal 'now', not to wildcard", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello right now",
                        undefined,
                        "backward",
                    );
                    // "play" at 0, wildcard "hello" captured at 4-10,
                    // "right" at 10, "now" at 16.
                    // Backward should back up to the LAST literal "now".
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(16);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward on exact match offers greedy wildcard alternative", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello right now",
                        undefined,
                        "forward",
                    );
                    // Greedy wildcard consumed "hello right now", so
                    // "right" is still unmatched as an alternative.
                    expect(result.completions).toEqual(["right"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(20);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("wildcard is last matched part before unmatched literal", () => {
                const g = [
                    `entity TrackName;`,
                    `entity ArtistName;`,
                    `<Start> = play $(track:TrackName) by $(artist:ArtistName) -> { actionName: "play", parameters: { track, artist } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play Nocturne' backs up to wildcard $(track)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play Nocturne",
                        undefined,
                        "backward",
                    );
                    // "play" matched, $(track) captured "Nocturne",
                    // "by" is unmatched.  Backward should back up to
                    // the wildcard — the last matched item — and offer
                    // property completions for $(track).
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties?.length).toBeGreaterThan(0);
                    expect(result.properties![0].propertyNames).toContain(
                        "parameters.track",
                    );
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(false);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward on 'play Nocturne' offers 'by'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play Nocturne",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["by"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(13);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("backward on partial input backs up to first word", () => {
                const g = `<Start> = play music -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on empty input offers first word (same as forward)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "",
                        undefined,
                        "backward",
                    );
                    // Nothing matched — nothing to back up to, so
                    // backward falls through to forward and offers "play".
                    expect(result.completions).toEqual(["play"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'play' (no trailing space) backs up to 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    // No trailing space — backward backs up to offer
                    // "play" at position 0 (reconsider the first word).
                    expect(result.completions).toEqual(["play"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("trailing space commits — backward on 'play ' offers next word (same as forward)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "backward",
                    );
                    // Trailing space is a commit signal — direction no
                    // longer matters.  Should offer "music" at position 5,
                    // same as forward.
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(5);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("forward on 'play ' offers next word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(5);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on partial 'pl' still offers 'play' (no complete token to reconsider)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "pl",
                        undefined,
                        "backward",
                    );
                    // "pl" is a partial prefix of "play".  No word was
                    // fully matched, so backward has nothing to back up
                    // to — falls through to forward and offers "play".
                    expect(result.completions).toEqual(["play"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'play no' (partial second word) still offers 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play no",
                        undefined,
                        "backward",
                    );
                    // "play" fully matched but "no" doesn't fully match
                    // "now".  There is remaining unmatched input beyond
                    // the separator, so backward falls through to forward
                    // and offers "now".
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("multi-rule with shared prefix and wildcard", () => {
                const g = [
                    `entity TrackName;`,
                    `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
                    `<Start> = play music -> "play_music";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play music' offers both literal and property at same position", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // Both rules back up to position 4: the all-literal
                    // rule offers "music", the wildcard rule offers a
                    // property completion.
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties?.length).toBeGreaterThan(0);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(false);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("varNumber part backward", () => {
                const g = [
                    `<Start> = play $(count) songs -> { actionName: "play", parameters: { count } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play 5 songs' backs up to number slot", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play 5 songs",
                        undefined,
                        "backward",
                    );
                    // "play" matched (string), 5 matched (number),
                    // "songs" matched (string).  The last matched part
                    // is the string "songs".  Backward backs up to offer
                    // "songs" at position 6.
                    expect(result.completions).toEqual(["songs"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'play 5' backs up to number slot (property)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play 5",
                        undefined,
                        "backward",
                    );
                    // "play" matched, 5 matched as the number part.
                    // Backward backs up to the number slot and offers
                    // a property completion for $(count).
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties?.length).toBeGreaterThan(0);
                    expect(result.properties![0].propertyNames).toContain(
                        "parameters.count",
                    );
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(false);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("forward on 'play 5' offers 'songs'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play 5",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["songs"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(true);
                    expect(result.separatorMode).toBe("optional");
                });
            });
        });

        describe("trailing separator commits token across spacing modes", () => {
            // Trailing separator neutralizes backward direction.
            // The specific separator characters depend on the spacing mode.

            describe("default (auto) spacing", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space commits — backward on 'play music ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    // Trailing space commits "music"; should offer "now".
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("trailing punctuation commits — backward on 'play music,' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music,",
                        undefined,
                        "backward",
                    );
                    // Trailing comma is a separator in auto mode; commits "music".
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("no trailing separator — backward on 'play music' backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // No trailing separator; backward backs up to "music".
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("spacing=required", () => {
                const g = [
                    `<Start> [spacing=required] = play music now -> true;`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space commits — backward acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("no trailing separator — backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });
            });

            describe("spacing=optional", () => {
                const g = [
                    `<Start> [spacing=optional] = play music now -> true;`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space commits — backward acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["now"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("no trailing separator — backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });
            });

            describe("spacing=none", () => {
                // In none mode, whitespace and punctuation are literal
                // content, not separators — backward should always work.
                const g = [`<Start> [spacing=none] = play music -> true;`].join(
                    "\n",
                );
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space does NOT commit — backward on 'play ' still backs up", () => {
                    // "play " does not match "playmusic" in none mode,
                    // so "play" is the only matched word.  Space is not a
                    // separator in none mode, so backward is not neutralized.
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["play"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("none");
                });

                it("forward on 'play' offers 'music' in none mode", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("none");
                });

                it("exact match forward 'playmusic' in none mode", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toHaveLength(0);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(9);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBeUndefined();
                });

                it("backward on 'playmusic' backs up to 'music'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["music"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("none");
                });
            });

            describe("auto spacing with CJK", () => {
                const g = [
                    `<Start> [spacing=auto] = 再生 音楽 停止 -> true;`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space commits — backward on CJK '再生 音楽 ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "再生 音楽 ",
                        undefined,
                        "backward",
                    );
                    // Trailing space commits; should offer "停止".
                    expect(result.completions).toEqual(["停止"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("no trailing separator — backward on CJK '再生音楽' backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "再生音楽",
                        undefined,
                        "backward",
                    );
                    // CJK auto mode: no separator between chars, so no
                    // trailing separator.  Backward backs up to "音楽".
                    expect(result.completions).toEqual(["音楽"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(2);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });
            });
        });

        describe("escaped space in last term", () => {
            // An escaped space (\ ) makes the space part of the literal
            // token content.  The trailing separator check should NOT
            // treat such a space as a commit signal.

            describe("default (auto) spacing — single segment with literal space", () => {
                // "hello\ world" parses as one segment: "hello world"
                // The rule has two tokens: ["hello world", "next"]
                const g = `<Start> = hello\\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'hello world' offers 'next'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("backward on 'hello world' (no trailing separator) backs up to 'hello world'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "backward",
                    );
                    // "hello world" is one token — no trailing separator
                    // after it, so backward should back up.
                    expect(result.completions).toEqual(["hello world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("forward on partial 'hello ' (mid-token literal space) still matches", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello ",
                        undefined,
                        "forward",
                    );
                    // "hello " is a partial match of the "hello world"
                    // token — forward should offer "hello world".
                    expect(result.completions).toEqual(["hello world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on partial 'hello ' (mid-token literal space) falls through to forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello ",
                        undefined,
                        "backward",
                    );
                    // "hello " is a partial match of the single segment
                    // "hello world".  No complete segment was matched,
                    // so backward falls through to forward and offers
                    // "hello world".
                    expect(result.completions).toEqual(["hello world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("trailing separator after complete token — backward on 'hello world ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    // The space after "hello world" IS a real separator.
                    // Should commit and offer "next".
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(12);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });
            });

            describe("spacing=none — literal space is never a separator", () => {
                const g = `<Start> [spacing=none] = hello\\ world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'hello world' offers 'next' (tokens directly adjacent)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "forward",
                    );
                    // In none mode, "hello world" and "next" are adjacent:
                    // matched input would be "hello worldnext".
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("none");
                });

                it("backward on 'hello world' backs up (space is literal, not separator)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toEqual(["hello world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("none");
                });
            });
        });

        describe("literal space followed by flex-space", () => {
            // Grammar source: `hello\  world` — escaped space then
            // unescaped whitespace.  Parser produces segments
            // ["hello ", "world"]: first segment ends with literal
            // space, then a flex-space boundary before "world".
            //
            // The regex merges the literal and flex-space: the pattern
            // is approximately `hello\ [\s\p{P}]*world`.  When input is
            // "hello " the regex matches "hello " as segment 1 completely
            // and passes through the zero-width flex-space — so the
            // matcher treats this as a segment boundary, not a mid-token
            // partial.

            describe("default (auto) spacing", () => {
                const g = `<Start> = hello\\  world next -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'hello ' — first segment fully matched, offers second segment", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello ",
                        undefined,
                        "forward",
                    );
                    // "hello " matches segment 1 exactly; flex-space
                    // consumed zero chars.  Offers "world".
                    expect(result.completions).toEqual(["world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'hello ' — literal space consumed, backs up to 'hello '", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello ",
                        undefined,
                        "backward",
                    );
                    // The literal space IS part of the first segment.
                    // The regex consumed it as token content, so there is
                    // no trailing separator beyond the match — backward
                    // backs up to offer "hello " at position 0.
                    expect(result.completions).toEqual(["hello "]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("forward on 'hello  ' — literal space + flex-space offers 'world'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  ",
                        undefined,
                        "forward",
                    );
                    // "hello " (literal) + " " (flex-space) = 7 chars consumed.
                    expect(result.completions).toEqual(["world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(7);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'hello  ' — real trailing separator commits", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  ",
                        undefined,
                        "backward",
                    );
                    // "hello " (literal) consumed 6 chars.  The extra
                    // space at position 6 is a real separator beyond the
                    // match — commits the segment, acts like forward.
                    expect(result.completions).toEqual(["world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(7);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("forward on 'hello world' offers 'next'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(11);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("spacePunctuation");
                });

                it("backward on 'hello world' backs up to 'world' at segment boundary", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "backward",
                    );
                    // Full token matched.  Backward backs up to
                    // "world" at position 6 (after "hello ").
                    expect(result.completions).toEqual(["world"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("forward on 'hello world ' offers 'next'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(12);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });

                it("backward on 'hello world ' — trailing separator commits", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    // Trailing space after complete token commits.
                    expect(result.completions).toEqual(["next"]);
                    expect(result.properties).toEqual([]);
                    expect(result.matchedPrefixLength).toBe(12);
                    expect(result.directionSensitive).toBe(false);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                    expect(result.separatorMode).toBe("optional");
                });
            });
        });

        describe("optional part ()? scenarios", () => {
            const g = `<Start> = play (shuffle)? music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("offers both optional and required after 'play'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["shuffle", "music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not sensitive for 'play ' with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["shuffle", "music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("forward on 'play shuffle' offers 'music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(12);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("backward on 'play shuffle' backs up to 'shuffle'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "backward",
                );
                expect(result.completions).toContain("shuffle");
                expect(result.completions).toContain("music");
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not sensitive for 'play shuffle ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle ",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["music"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(13);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("sensitive for exact match 'play shuffle music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle music",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(18);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });

            it("sensitive for exact match (optional skipped) 'play music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });
        });

        // ================================================================
        // Wildcard grammar direction scenarios
        // ================================================================

        describe("wildcard grammar direction", () => {
            const g = [
                `<Start> = play $(song:<Song>) -> true;`,
                `<Song> = $(x:wildcard);`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("not sensitive for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expect(result.completions).toEqual(["play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("sensitive after 'play' (wildcard not yet captured)", () => {
                // "play" matched the string part, wildcard hasn't
                // captured anything yet.  Backward would reconsider
                // the matched keyword.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties!.length).toBeGreaterThan(0);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
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
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(14);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });
        });

        // ================================================================
        // Category 3b direction scenarios
        // ================================================================

        describe("Category 3b partial match direction", () => {
            const g = [
                `<Start> = play some music -> true;`,
                `<Start> = play some video -> true;`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for exact match 'play some music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(15);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });

            it("not sensitive for exact match with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music ",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(16);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });

            it("sensitive for 'play some' (two words matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["music", "video"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(9);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not sensitive for 'play som' (partial second word)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play som",
                    undefined,
                    "forward",
                );
                // "some" appears twice (one per rule)
                expect(result.completions).toEqual(["some", "some"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not sensitive for partial first word 'pla'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "pla",
                    undefined,
                    "forward",
                );
                // "play" appears twice (one per rule)
                expect(result.completions).toEqual(["play", "play"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(0);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        // ================================================================
        // varNumber direction scenarios
        // ================================================================

        describe("varNumber direction", () => {
            const g = `<Start> = set volume $(level) -> { actionName: "setVolume", parameters: { level } };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'set volume 42' (number matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "forward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(13);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });

            it("backward on 'set volume 42' backs up to number slot", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "backward",
                );
                expect(result.completions).toHaveLength(0);
                expect(result.properties!.length).toBeGreaterThan(0);
                expect(result.properties![0].propertyNames).toContain(
                    "parameters.level",
                );
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(false);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        // ================================================================
        // Repeat ()+ direction scenarios
        // ================================================================

        describe("repeat ()+ direction", () => {
            const g = `<Start> = play (song)+ now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["now", "song"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(9);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("backward on 'play song' backs up", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "backward",
                );
                expect(result.completions).toEqual(["song", "song"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("sensitive for 'play song song' (two iterations)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song song",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["now", "song"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(14);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("not sensitive for 'play song ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song ",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["now", "song"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(10);
                expect(result.directionSensitive).toBe(false);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("optional");
            });
        });

        // ================================================================
        // Repeat ()* direction scenarios
        // ================================================================

        describe("repeat ()* direction", () => {
            const g = `<Start> = play (song)* now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("sensitive for 'play' (zero iterations, but 'play' matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["song", "now"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(4);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });

            it("sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expect(result.completions).toEqual(["now", "song"]);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(9);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBe("spacePunctuation");
            });
        });

        // ================================================================
        // minPrefixLength with backward direction
        // ================================================================

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
                // to "music" at position 4, which is below the minimum,
                // so completions are filtered out.
                expect(result.completions).toHaveLength(0);
                expect(result.properties).toEqual([]);
                expect(result.matchedPrefixLength).toBe(5);
                expect(result.directionSensitive).toBe(true);
                expect(result.closedSet).toBe(true);
                expect(result.openWildcard).toBe(false);
                expect(result.separatorMode).toBeUndefined();
            });
        });

        // ================================================================
        // Forward and backward produce same directionSensitive
        // ================================================================

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
                expect(forward.completions).toEqual(["music"]);
                expect(forward.properties).toEqual([]);
                expect(forward.matchedPrefixLength).toBe(4);
                expect(forward.closedSet).toBe(true);
                expect(forward.openWildcard).toBe(false);
                expect(forward.separatorMode).toBe("spacePunctuation");

                expect(backward.directionSensitive).toBe(true);
                expect(backward.completions).toEqual(["play"]);
                expect(backward.properties).toEqual([]);
                expect(backward.matchedPrefixLength).toBe(0);
                expect(backward.closedSet).toBe(true);
                expect(backward.openWildcard).toBe(false);
                expect(backward.separatorMode).toBe("optional");
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
                expect(forward.completions).toEqual(["music"]);
                expect(forward.properties).toEqual([]);
                expect(forward.matchedPrefixLength).toBe(5);
                expect(forward.closedSet).toBe(true);
                expect(forward.openWildcard).toBe(false);
                expect(forward.separatorMode).toBe("optional");

                expect(backward.directionSensitive).toBe(false);
                expect(backward.completions).toEqual(["music"]);
                expect(backward.properties).toEqual([]);
                expect(backward.matchedPrefixLength).toBe(5);
                expect(backward.closedSet).toBe(true);
                expect(backward.openWildcard).toBe(false);
                expect(backward.separatorMode).toBe("optional");
            });
        });

        // ============================================================
        // Alternation-prefix overlap before wildcard
        //
        // When one branch of an alternation fully matches and a sibling
        // is a partial match, backward should re-open the alternation
        // instead of advancing into the wildcard.
        // ============================================================
        describe("alternation-prefix overlap before wildcard", () => {
            describe("(play|plays) $(song:wildcard)", () => {
                const g = `<Start> = (play | plays) $(song:wildcard) -> { actionName: "play", parameters: { song } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward offers wildcard property for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    // "play" branch matches fully; forward advances to
                    // the wildcard <song> and offers property completion.
                    expect(result.completions).toEqual([]);
                    expect(result.properties).toHaveLength(1);
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.openWildcard).toBe(false);
                });

                it("backward re-opens alternation for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    // Backward backs up to the matched "play" at mpl=0.
                    // The sibling "plays" branch independently offers
                    // "plays" at mpl=0 via category 3b.
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("plays");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                    expect(result.openWildcard).toBe(false);
                });

                it("trailing space commits — both directions offer wildcard", () => {
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
                    // Trailing space commits the alternation choice.
                    // Both directions offer the wildcard property.
                    expect(forward.properties).toHaveLength(1);
                    expect(backward.properties).toHaveLength(1);
                    expect(forward.directionSensitive).toBe(false);
                    expect(backward.directionSensitive).toBe(false);
                });

                it("forward offers wildcard for 'plays'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "plays",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual([]);
                    expect(result.properties).toHaveLength(1);
                    expect(result.matchedPrefixLength).toBe(5);
                    expect(result.directionSensitive).toBe(true);
                });

                it("backward on 'plays' backs up to 'plays'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "plays",
                        undefined,
                        "backward",
                    );
                    // "plays" only matches the "plays" branch; "play"
                    // also matches (shorter), but mpl from "plays"
                    // backward (0) should show both alternatives.
                    expect(result.completions).toContain("plays");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                });

                it("partial 'pla' is not direction-sensitive", () => {
                    const result = matchGrammarCompletion(grammar, "pla");
                    // Both branches are only partially matched — no
                    // alternation overlap, category 3b for both.
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("plays");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                });
            });

            describe("(play|plays) $(song:wildcard) by $(artist:wildcard)", () => {
                const g = `<Start> = (play | plays) $(song:wildcard) by $(artist:wildcard) -> { actionName: "play", parameters: { song, artist } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward re-opens alternation for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("plays");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                });

                it("forward offers wildcard for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toEqual([]);
                    expect(result.properties).toHaveLength(1);
                    expect(result.matchedPrefixLength).toBe(4);
                });
            });

            describe("three-way overlap: (play|player|playing) $(song:wildcard)", () => {
                const g = `<Start> = (play | player | playing) $(song:wildcard) -> { actionName: "play", parameters: { song } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play' shows all three alternatives", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("player");
                    expect(result.completions).toContain("playing");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                });
            });

            describe("(play|player) now — keyword-only alternation", () => {
                const g = `<Start> = (play | player) now -> { actionName: "play" };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward offers 'now' after 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    // "play" branch fully matches → Category 2, next
                    // part is " now".
                    expect(result.completions).toContain("now");
                    expect(result.matchedPrefixLength).toBe(4);
                    expect(result.directionSensitive).toBe(true);
                });

                it("backward re-opens alternation for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    // Backward backs up to the matched "play" keyword
                    // at mpl=0, showing both alternatives.
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("player");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                    expect(result.closedSet).toBe(true);
                });

                it("partial 'pla' shows both alternatives, not direction-sensitive", () => {
                    const result = matchGrammarCompletion(grammar, "pla");
                    // Completions contain the alternation words only;
                    // the trailing " now" is offered separately after
                    // the alternation resolves.
                    expect(result.completions).toContain("play");
                    expect(result.completions).toContain("player");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(false);
                });

                it("'player' forward offers 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "player",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toContain("now");
                    expect(result.matchedPrefixLength).toBe(6);
                    expect(result.directionSensitive).toBe(true);
                });

                it("'player' backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "player",
                        undefined,
                        "backward",
                    );
                    expect(result.completions).toContain("player");
                    expect(result.matchedPrefixLength).toBe(0);
                    expect(result.directionSensitive).toBe(true);
                });

                it("'play n' forward offers 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play n",
                        undefined,
                        "forward",
                    );
                    expect(result.completions).toContain("now");
                    expect(result.matchedPrefixLength).toBe(4);
                });

                it("trailing space 'play ' commits the choice", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "forward",
                    );
                    // Trailing space commits — only "play" branch
                    // survives; "player" is eliminated.
                    expect(result.completions).toContain("now");
                    expect(result.matchedPrefixLength).toBe(5);
                });
            });
        });
    },
);
