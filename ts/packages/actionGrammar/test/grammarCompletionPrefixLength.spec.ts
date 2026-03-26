// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

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
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns first word as completion for partial prefix", () => {
                const result = matchGrammarCompletion(grammar, "pl");
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns remaining words as completion for first word typed", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                // tryPartialStringMatch splits the multi-word part: "play"
                // is consumed (4 chars), trailing space advances to 5.
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns first word for non-matching input", () => {
                const result = matchGrammarCompletion(grammar, "xyz");
                // Nothing consumed; only the first word of the string part is
                // offered so the caller can filter by trailing text.
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns matchedPrefixLength for exact match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                // Exact match now records the full consumed length.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("offers next word for first word fully typed (no space)", () => {
                // "play" fully matched, no trailing space → direction-sensitive
                const result = matchGrammarCompletion(grammar, "play");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for exact match with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play music ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 11,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns second part after nested rule consumed", () => {
                const result = matchGrammarCompletion(grammar, "play");
                // "play" fully matched, no trailing separator → direction-sensitive
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns second part after nested rule with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                // Trailing space commits → not direction-sensitive
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("reports optional separatorMode for partial prefix match", () => {
                // "pl" matches partially → the completion replaces from state.index,
                // so no separator needed (user is typing the keyword)
                const result = matchGrammarCompletion(grammar, "pl");
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns second part for partial second word", () => {
                const result = matchGrammarCompletion(grammar, "play m");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns matchedPrefixLength for complete match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: ["music", "video"],
                    sortCompletions: true,
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                });
            });

            it("returns terminator with matchedPrefixLength tracking wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "play hello");
                // Wildcard consumed "hello" — matchedPrefixLength includes it
                expectMetadata(result, {
                    completions: ["now"],
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });

            it("returns terminator with matchedPrefixLength for trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play hello ");
                expectMetadata(result, {
                    completions: ["now"],
                    matchedPrefixLength: 11,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
            });
        });

        describe("wildcard without terminator", () => {
            const g = `<Start> = play $(name) -> { name: name };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns start rule for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns property completion for separator-only trailing wildcard", () => {
                // The trailing space is not valid wildcard content, so the
                // wildcard can't finalize.  The else-branch produces a
                // property completion instead.  Trailing space advances
                // matchedPrefixLength to 5.
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [
                        {
                            match: {},
                            propertyNames: ["name"],
                        },
                    ],
                });
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
                expectMetadata(result, {
                    completions: ["再生"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns noun completion after CJK verb typed", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                // "再生" is 2 chars; matchedPrefixLength reflects position after verb
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns noun completion after CJK verb with space", () => {
                const result = matchGrammarCompletion(grammar, "再生 ");
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns no completions for exact match", () => {
                const result = matchGrammarCompletion(grammar, "再生音楽");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        describe("CJK single string part", () => {
            // Single string part — only the first word is offered initially.
            // After the first word matches, the remaining words are offered.
            const g = `<Start> [spacing=auto] = 再生 音楽 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("returns first word for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expectMetadata(result, {
                    completions: ["再生"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("returns remaining words for partial CJK prefix", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                // tryPartialStringMatch splits the multi-word part: "再生"
                // is consumed (2 chars), "音楽" remains as the completion.
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 3,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                });
            });

            it("returns terminator after CJK prefix + wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "再生 hello");
                expectMetadata(result, {
                    completions: ["停止"],
                    matchedPrefixLength: 8,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: true,
                    properties: [],
                });
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
                // CJK → CJK in auto mode: separator optional
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                // Latin → CJK in auto mode: different scripts, separator optional
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        describe("separatorMode - wildcard entity", () => {
            // Grammar where the completion is a wildcard entity (not a static string).
            // separatorMode describes the boundary at matchedPrefixLength.
            const g = [
                `import { TrackName };`,
                `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode for 'play' before wildcard", () => {
                const result = matchGrammarCompletion(grammar, "play");
                // matchedPrefixLength=4; boundary "y" → entity needs separator.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [
                        {
                            match: {
                                actionName: "play",
                                parameters: {},
                            },
                            propertyNames: ["parameters.name"],
                        },
                    ],
                });
            });

            it("reports separatorMode for 'play ' before wildcard", () => {
                // Trailing space consumed: matchedPrefixLength advances to 5,
                // separatorMode demoted to "optional".
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: false,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [
                        {
                            match: {
                                actionName: "play",
                                parameters: {},
                            },
                            propertyNames: ["parameters.name"],
                        },
                    ],
                });
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward exact match still returns empty completions", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 10,
                        separatorMode: undefined,
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("partial match forward offers next unmatched word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward offers next unmatched word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("wildcard at end", () => {
                const g = [
                    `import { TrackName };`,
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
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.name"],
                            },
                        ],
                    });
                });

                it("forward on exact match returns empty completions", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 10,
                        separatorMode: undefined,
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("wildcard in middle", () => {
                const g = [
                    `import { TrackName };`,
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 14,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
                });
            });

            describe("wildcard followed by multiple literals", () => {
                const g = [
                    `import { TrackName };`,
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 16,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["right"],
                        matchedPrefixLength: 20,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
                });
            });

            describe("wildcard is last matched part before unmatched literal", () => {
                const g = [
                    `import { TrackName };`,
                    `import { ArtistName };`,
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
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.track"],
                            },
                        ],
                    });
                });

                it("forward on 'play Nocturne' offers 'by'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play Nocturne",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 13,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 5,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward on 'play ' offers next word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 5,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });
            });

            describe("multi-rule with shared prefix and wildcard", () => {
                const g = [
                    `import { TrackName };`,
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
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.name"],
                            },
                        ],
                    });
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
                    expectMetadata(result, {
                        completions: ["songs"],
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.count"],
                            },
                        ],
                    });
                });

                it("forward on 'play 5' offers 'songs'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play 5",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["songs"],
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: true,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 11,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("trailing punctuation commits — backward on 'play music,' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music,",
                        undefined,
                        "backward",
                    );
                    // Trailing comma is a separator in auto mode; commits "music".
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 11,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("no trailing separator — backward on 'play music' backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // No trailing separator; backward backs up to "music".
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 11,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("no trailing separator — backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 11,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("no trailing separator — backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward on 'play' offers 'music' in none mode", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("exact match forward 'playmusic' in none mode", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 9,
                        separatorMode: undefined,
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'playmusic' backs up to 'music'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "playmusic",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["停止"],
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["音楽"],
                        matchedPrefixLength: 2,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 11,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["hello world"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["hello world"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["hello world"],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 12,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 11,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'hello world' backs up (space is literal, not separator)", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["hello world"],
                        matchedPrefixLength: 0,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["world"],
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["hello "],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward on 'hello  ' — literal space + flex-space offers 'world'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  ",
                        undefined,
                        "forward",
                    );
                    // "hello " (literal) + " " (flex-space) = 7 chars consumed.
                    expectMetadata(result, {
                        completions: ["world"],
                        matchedPrefixLength: 7,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["world"],
                        matchedPrefixLength: 7,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward on 'hello world' offers 'next'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 11,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
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
                    expectMetadata(result, {
                        completions: ["world"],
                        matchedPrefixLength: 6,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("forward on 'hello world ' offers 'next'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 12,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
                });

                it("backward on 'hello world ' — trailing separator commits", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    // Trailing space after complete token commits.
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 12,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                        properties: [],
                    });
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
                expectMetadata(result, {
                    completions: ["shuffle", "music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for 'play ' with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["shuffle", "music"],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("forward on 'play shuffle' offers 'music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 12,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'play shuffle' backs up to 'shuffle'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["shuffle", "music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for 'play shuffle ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 13,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive for exact match 'play shuffle music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle music",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 18,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive for exact match (optional skipped) 'play music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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

            it("not direction-sensitive for empty input", () => {
                const result = matchGrammarCompletion(grammar, "");
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive after 'play' (wildcard not yet captured)", () => {
                // "play" matched the string part, wildcard hasn't
                // captured anything yet.  Backward would reconsider
                // the matched keyword.
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [
                        {
                            match: true,
                            propertyNames: [],
                        },
                    ],
                });
            });

            it("direction-sensitive for 'play some song' (wildcard captured)", () => {
                // Exact match with wildcard — backward would back up to
                // the wildcard.
                const result = matchGrammarCompletion(
                    grammar,
                    "play some song",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 14,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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

            it("direction-sensitive for exact match 'play some music'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 15,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for exact match with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 16,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive for 'play some' (two words matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["music", "video"],
                    matchedPrefixLength: 9,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for 'play som' (partial second word)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play som",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["some"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for partial first word 'pla'", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "pla",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // varNumber direction scenarios
        // ================================================================

        describe("varNumber direction", () => {
            const g = `<Start> = set volume $(level) -> { actionName: "setVolume", parameters: { level } };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("direction-sensitive for 'set volume 42' (number matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 13,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'set volume 42' backs up to number slot", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: "spacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [
                        {
                            match: {
                                actionName: "setVolume",
                                parameters: {},
                            },
                            propertyNames: ["parameters.level"],
                        },
                    ],
                });
            });
        });

        // ================================================================
        // Repeat ()+ direction scenarios
        // ================================================================

        describe("repeat ()+ direction", () => {
            const g = `<Start> = play (song)+ now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("direction-sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["now", "song"],
                    matchedPrefixLength: 9,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("backward on 'play song' backs up", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["song"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive for 'play song song' (two iterations)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song song",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["now", "song"],
                    matchedPrefixLength: 14,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("not direction-sensitive for 'play song ' (trailing space commits)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["now", "song"],
                    matchedPrefixLength: 10,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Repeat ()* direction scenarios
        // ================================================================

        describe("repeat ()* direction", () => {
            const g = `<Start> = play (song)* now -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("direction-sensitive for 'play' (zero iterations, but 'play' matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["song", "now"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("direction-sensitive for 'play song' (one iteration matched)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["now", "song"],
                    matchedPrefixLength: 9,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });
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
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 5,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });
        });

        // ================================================================
        // Forward and backward produce same directionSensitive
        // ================================================================

        describe("forward and backward produce same directionSensitive", () => {
            const g = `<Start> = play music -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("both directions agree on direction-sensitivity for 'play'", () => {
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
                expectMetadata(forward, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "spacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    openWildcard: false,
                    properties: [],
                });

                expectMetadata(backward, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
            });

            it("both directions agree on non-direction-sensitivity for 'play '", () => {
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
                expectMetadata(forward, {
                    completions: ["music"],
                    matchedPrefixLength: 5,
                    separatorMode: "optional",
                    closedSet: true,
                    directionSensitive: false,
                    openWildcard: false,
                    properties: [],
                });
                expect(backward).toEqual(forward);
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
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.song"],
                            },
                        ],
                    });
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
                    expectMetadata(result, {
                        completions: ["play", "plays"],
                        matchedPrefixLength: 0,
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                    });
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
                    const expectedProperty = {
                        match: {
                            actionName: "play",
                            parameters: {},
                        },
                        propertyNames: ["parameters.song"],
                    };
                    expectMetadata(forward, {
                        directionSensitive: false,
                        properties: [expectedProperty],
                    });
                    expect(backward).toEqual(forward);
                });

                it("forward offers wildcard for 'plays'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "plays",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 5,
                        directionSensitive: true,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.song"],
                            },
                        ],
                    });
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
                    expectMetadata(result, {
                        completions: ["play", "plays"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                });

                it("partial 'pla' is not direction-sensitive", () => {
                    const result = matchGrammarCompletion(grammar, "pla");
                    // Both branches are only partially matched — no
                    // alternation overlap, category 3b for both.
                    expectMetadata(result, {
                        completions: ["play", "plays"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
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
                    expectMetadata(result, {
                        completions: ["play", "plays"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                });

                it("forward offers wildcard for 'play'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.song"],
                            },
                        ],
                    });
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
                    expectMetadata(result, {
                        completions: ["play", "player", "playing"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
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
                    expectMetadata(result, {
                        completions: ["play", "player"],
                        matchedPrefixLength: 0,
                        closedSet: true,
                        directionSensitive: false,
                    });
                });

                it("partial 'pla' shows both alternatives, not direction-sensitive", () => {
                    const result = matchGrammarCompletion(grammar, "pla");
                    // Completions contain the alternation words only;
                    // the trailing " now" is offered separately after
                    // the alternation resolves.
                    expectMetadata(result, {
                        completions: ["play", "player"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                });

                it("'player' forward offers 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "player",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 6,
                        directionSensitive: true,
                    });
                });

                it("'player' backward backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "player",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["play", "player"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                });

                it("'play n' forward offers 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play n",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 4,
                    });
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
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 5,
                    });
                });
            });
        });

        describe("two-pass backward invariant", () => {
            // The two-pass backward approach guarantees:
            //   completion(input, "backward") === completion(input[0..P], "forward")
            // where P = matchedPrefixLength from the backward result.
            // All fields match, including directionSensitive.
            // These tests verify this invariant across various grammars.

            describe("keyword-only grammar", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play music' equals forward on 'play'", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play music".substring(0, backward.matchedPrefixLength),
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                    expect(backward).toEqual(forward);
                });

                it("backward on 'play' equals forward on ''", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play".substring(0, backward.matchedPrefixLength),
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });
            });

            describe("multi-rule grammar", () => {
                const g = [
                    `<Start> = play music -> "play_music";`,
                    `<Start> = play video -> "play_video";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play music' equals forward on 'play'", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play music".substring(0, backward.matchedPrefixLength),
                        undefined,
                        "forward",
                    );
                    // Backward should re-invoke forward at P=4,
                    // picking up both "music" and "video".
                    expectMetadata(backward, {
                        completions: ["music", "video"],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                    expect(backward).toEqual(forward);
                });
            });

            describe("multi-rule with wildcard and literal", () => {
                const g = [
                    `import { TrackName };`,
                    `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
                    `<Start> = play music -> "play_music";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play' equals forward on ''", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "",
                        undefined,
                        "forward",
                    );
                    // Both should offer "play" at P=0.
                    expectMetadata(backward, {
                        completions: ["play"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });
            });
        });

        describe("non-lossy backward — multi-rule completions", () => {
            // Before the two-pass approach, backward was lossy: each
            // rule independently backed up and only the winning rule's
            // completions survived.  These tests verify that backward
            // now shows ALL rules' completions at the backed-up position.

            describe("three rules with shared prefix", () => {
                const g = [
                    `<Start> = play music -> "play_music";`,
                    `<Start> = play video -> "play_video";`,
                    `<Start> = play audio -> "play_audio";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play music' shows all three alternatives", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // All three rules share prefix "play"; backward
                    // at P=4 should show all three next keywords.
                    expectMetadata(result, {
                        completions: ["music", "video", "audio"],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                });

                it("backward on 'play video' shows all three alternatives", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play video",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["music", "video", "audio"],
                        matchedPrefixLength: 4,
                    });
                });

                it("forward on 'play' already shows all three", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["music", "video", "audio"],
                        matchedPrefixLength: 4,
                    });
                });
            });

            describe("two rules with different prefix lengths", () => {
                const g = [
                    `<Start> = play music now -> "play_music_now";`,
                    `<Start> = play song -> "play_song";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play music' backs up to P=4 with both rules", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "backward",
                    );
                    // Rule 1 backs up from "music" to P=4.
                    // Re-invocation forward on "play" gives both
                    // "music" and "song".
                    expectMetadata(result, {
                        completions: ["music", "song"],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                });
            });
        });

        describe("openWildcard skip — no re-invocation at wildcard boundary", () => {
            // When backward backs up to a position at an ambiguous
            // wildcard boundary (openWildcard=true), re-invocation is
            // skipped because forward on the shorter input re-parses
            // with greedy wildcards that absorb different text.

            describe("wildcard followed by literal", () => {
                const g = [
                    `import { TrackName };`,
                    `<Start> = play $(name:TrackName) right now -> { actionName: "play", parameters: { name } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play hello right now' backs up to 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello right now",
                        undefined,
                        "backward",
                    );
                    // The wildcard captured "hello", "right" matched,
                    // "now" matched.  Backward backs up to "now" at
                    // the keyword boundary — openWildcard=true because
                    // the keyword follows a wildcard.
                    expectMetadata(result, {
                        completions: ["now"],
                        openWildcard: true,
                        directionSensitive: true,
                    });
                });

                it("backward on 'play hello right' finds partial keyword 'now'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello right",
                        undefined,
                        "backward",
                    );
                    // The wildcard absorbed "hello right", but
                    // findPartialKeywordInWildcard sees "right" as the
                    // first word of the keyword "right now" and offers
                    // "now" at P=16 (closest to cursor principle).
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 16,
                        openWildcard: true,
                        directionSensitive: true,
                    });
                });
            });

            describe("wildcard at end with exact match", () => {
                const g = [
                    `import { TrackName };`,
                    `<Start> = play $(name:TrackName) -> { actionName: "play", parameters: { name } };`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play hello' backs up to wildcard property", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "backward",
                    );
                    // "play" matched, wildcard captured "hello".
                    // Backward backs up to offer property completion
                    // for the wildcard slot.
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                        openWildcard: false,
                        properties: [
                            {
                                match: {
                                    actionName: "play",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.name"],
                            },
                        ],
                    });
                });
            });
        });

        describe("backwardEmitted=false — trailing separator commits", () => {
            // When backward falls through to forward behavior (the
            // trailing separator "commits" the match), backwardEmitted
            // remains false.  The result should be identical to forward
            // — same completions, same matchedPrefixLength, and
            // directionSensitive=false.

            describe("keyword grammar with trailing space", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play ' matches forward on 'play '", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["music"],
                        matchedPrefixLength: 5,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });

                it("backward on 'play music ' matches forward on 'play music '", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["now"],
                        matchedPrefixLength: 11,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });
            });

            describe("trailing punctuation commits", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play,' matches forward on 'play,'", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "play,",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "play,",
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["music"],
                        matchedPrefixLength: 5,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });
            });
        });

        describe("separator-only keyword backward", () => {
            // Keywords consisting entirely of separator characters
            // (like "..." which is all punctuation) must not be treated
            // as trailing separators.  Backward should back up and
            // re-offer the keyword.

            describe("punctuation keyword '...'", () => {
                const g = `<Start> = ... done -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on '...' backs up to P=0", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "...",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["..."],
                        matchedPrefixLength: 0,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: false,
                        openWildcard: false,
                    });
                });

                it("forward on '...' offers 'done' at P=3", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "...",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["done"],
                        matchedPrefixLength: 3,
                        separatorMode: "optional",
                        closedSet: true,
                        directionSensitive: true,
                        openWildcard: false,
                    });
                });

                it("backward on '... ' commits (trailing space)", () => {
                    const backward = matchGrammarCompletion(
                        grammar,
                        "... ",
                        undefined,
                        "backward",
                    );
                    const forward = matchGrammarCompletion(
                        grammar,
                        "... ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(backward, {
                        completions: ["done"],
                        matchedPrefixLength: 4,
                        directionSensitive: false,
                    });
                    expect(backward).toEqual(forward);
                });
            });

            describe("multi-dot keyword '...' with second punctuation keyword", () => {
                const g = `<Start> = ... !!! done -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on '... !!!' backs up to '...'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "... !!!",
                        undefined,
                        "backward",
                    );
                    // Should back up to "!!!" at P=3 (re-invoking
                    // forward on "...").
                    expectMetadata(result, {
                        completions: ["!!!"],
                        matchedPrefixLength: 3,
                        directionSensitive: true,
                    });
                });
            });
        });

        describe("two-pass backward with alternation re-opens all branches", () => {
            // When backward backs up past an alternation boundary,
            // re-invocation at the shorter prefix naturally re-opens
            // all alternation branches.

            describe("two rules diverging after shared prefix", () => {
                const g = [
                    `<Start> = set volume up -> "vol_up";`,
                    `<Start> = set volume down -> "vol_down";`,
                    `<Start> = set brightness up -> "bright_up";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'set volume up' backs up to 'set volume'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "set volume up",
                        undefined,
                        "backward",
                    );
                    // Re-invocation forward on "set volume" gives
                    // both "up" and "down".
                    expectMetadata(result, {
                        completions: ["up", "down"],
                        matchedPrefixLength: 10,
                        directionSensitive: true,
                    });
                });

                it("backward on 'set volume' backs up to 'set'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "set volume",
                        undefined,
                        "backward",
                    );
                    // Re-invocation forward on "set" gives both
                    // "volume" and "brightness".
                    expectMetadata(result, {
                        completions: ["volume", "brightness"],
                        matchedPrefixLength: 3,
                        directionSensitive: true,
                    });
                });

                it("backward on 'set' backs up to P=0", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "set",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["set"],
                        matchedPrefixLength: 0,
                        directionSensitive: false,
                    });
                });
            });
        });

        describe("partialKeywordBackup with multiple alternatives (player-like grammar)", () => {
            // Reproduces the issue where findPartialKeywordInWildcard
            // succeeds for one alternative ("by") but blocks other
            // alternatives ("from", "track", "song") from contributing
            // completions at the same position.
            const g = [
                `import { TrackName, ArtistName, AlbumName };`,
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist:ArtistName) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } };`,
                `<Start> = play $(trackName:<TrackPhrase>) from (the)? album $(albumName:AlbumName) -> { actionName: "playTrack", parameters: { trackName, albumName } };`,
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist:ArtistName) from (the)? album $(albumName:AlbumName) -> { actionName: "playTrack", parameters: { trackName, artists: [artist], albumName } };`,
                `<TrackPhrase> = $(trackName:<TrackName>) -> trackName;`,
                `<TrackPhrase> = the <TrackTerm> $(trackName:<TrackName>) -> trackName;`,
                `<TrackPhrase> = <TrackTerm> $(trackName:<TrackName>) -> trackName;`,
                `<TrackPhrase> = $(trackName:<TrackName>) <TrackTerm> -> trackName;`,
                `<TrackTerm> = track | song;`,
                `<TrackName> = $(x:wildcard);`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("backward on 'play first penguin b' shows all keyword alternatives", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play first penguin b",
                    undefined,
                    "backward",
                );
                // "b" partially matches "by" via
                // findPartialKeywordInWildcard. All keywords that
                // could follow the wildcard track phrase at position 19
                // should appear: "by", "from", "track", "song".
                expectMetadata(result, {
                    completions: ["by", "from", "song", "track"],
                    sortCompletions: true,
                    matchedPrefixLength: 19,
                    openWildcard: true,
                    directionSensitive: true,
                });
            });

            it("forward on 'play first penguin ' shows all keyword alternatives", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play first penguin ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["by", "from", "song", "track"],
                    sortCompletions: true,
                    matchedPrefixLength: 19,
                    openWildcard: true,
                    directionSensitive: true,
                });
            });

            it("backward on 'play first penguin z' does not trigger partialKeywordBackup", () => {
                // "z" doesn't prefix any keyword — no partial keyword
                // match, so backward falls back to collecting a
                // regular backward candidate (wildcard start backup).
                const result = matchGrammarCompletion(
                    grammar,
                    "play first penguin z",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["song", "the", "track"],
                    sortCompletions: true,
                    matchedPrefixLength: 4,
                    openWildcard: false,
                    directionSensitive: true,
                });
            });
        });

        describe("partialKeywordBackup with PlayTrackNumberCommand + PlaySpecificTrack", () => {
            // Full player-like grammar including both rule families.
            // Tests whether PlayTrackNumberCommand's (<Item>)?
            // alternatives also contribute at the backed-up position.
            const g = [
                `import { Ordinal, Cardinal, TrackName, ArtistName, AlbumName };`,
                // PlayTrackNumberCommand
                `<Start> = play (the)? $(n:Ordinal) (<Item>)? -> { actionName: "playFromCurrentTrackList", parameters: { trackNumber: n } };`,
                `<Item> = one | cut | <TrackTerm>;`,
                // PlaySpecificTrack (simplified)
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist:ArtistName) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } };`,
                `<Start> = play $(trackName:<TrackPhrase>) from (the)? album $(albumName:AlbumName) -> { actionName: "playTrack", parameters: { trackName, albumName } };`,
                `<TrackPhrase> = $(trackName:<TrackName>) -> trackName;`,
                `<TrackPhrase> = $(trackName:<TrackName>) <TrackTerm> -> trackName;`,
                `<TrackTerm> = track | song;`,
                `<TrackName> = $(x:wildcard);`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'play first penguin' includes both rule families", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play first penguin",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["by", "cut", "from", "one", "song", "track"],
                    sortCompletions: true,
                    matchedPrefixLength: 18,
                    directionSensitive: true,
                    openWildcard: true,
                });
            });

            it("backward on 'play first penguin b' includes both rule families", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play first penguin b",
                    undefined,
                    "backward",
                );
                // All keywords from both rule families appear at
                // position 19 via range candidates, including "one"
                // and "cut" from PlayTrackNumberCommand's (<Item>)?.
                expectMetadata(result, {
                    completions: ["by", "cut", "from", "one", "song", "track"],
                    sortCompletions: true,
                    matchedPrefixLength: 19,
                    directionSensitive: true,
                    openWildcard: true,
                });
            });
        });
    },
);
