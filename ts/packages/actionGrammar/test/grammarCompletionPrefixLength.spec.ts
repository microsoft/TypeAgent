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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns first word as completion for partial prefix", () => {
                const result = matchGrammarCompletion(grammar, "pl");
                expectMetadata(result, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns remaining words as completion for first word typed", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                // tryPartialStringMatch splits the multi-word part: "play"
                // is consumed (4 chars).  Trailing space is not included in
                // matchedPrefixLength — the shell handles it via separator
                // stripping.
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns matchedPrefixLength for exact match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                // Exact match backs up to the last term.
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("offers next word for first word fully typed (no space)", () => {
                // "play" fully matched, no trailing space → direction-sensitive
                const result = matchGrammarCompletion(grammar, "play");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play music ");
                // Trailing separators are stripped in Category 1,
                // so backup succeeds — same as "play music".
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns second part after nested rule consumed", () => {
                const result = matchGrammarCompletion(grammar, "play");
                // "play" fully matched, no trailing separator → direction-sensitive
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns second part after nested rule with trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns second part for partial second word", () => {
                const result = matchGrammarCompletion(grammar, "play m");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns matchedPrefixLength for complete match", () => {
                const result = matchGrammarCompletion(grammar, "play music");
                // Exact match backs up to the last term.
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                // the terminator string.
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                });
            });

            it("returns terminator with matchedPrefixLength tracking wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "play hello");
                // Wildcard consumed "hello" — matchedPrefixLength includes it
                expectMetadata(result, {
                    completions: ["now"],
                    matchedPrefixLength: 10,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("returns terminator with matchedPrefixLength for trailing space", () => {
                const result = matchGrammarCompletion(grammar, "play hello ");
                expectMetadata(result, {
                    completions: ["now"],
                    matchedPrefixLength: 10,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns property completion for separator-only trailing wildcard", () => {
                // The trailing space is not valid wildcard content, so the
                // wildcard can't finalize.  The else-branch produces a
                // property completion instead.
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns noun completion after CJK verb typed", () => {
                const result = matchGrammarCompletion(grammar, "再生");
                // "再生" is 2 chars; matchedPrefixLength reflects position after verb
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("returns noun completion after CJK verb with space", () => {
                const result = matchGrammarCompletion(grammar, "再生 ");
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match backs up to last term", () => {
                const result = matchGrammarCompletion(grammar, "再生音楽");
                // Exact match backs up to the last term.
                expectMetadata(result, {
                    completions: ["音楽"],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                const result = matchGrammarCompletion(grammar, "再生 ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 2,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                });
            });

            it("returns terminator after CJK prefix + wildcard text", () => {
                const result = matchGrammarCompletion(grammar, "再生 hello");
                expectMetadata(result, {
                    completions: ["停止"],
                    matchedPrefixLength: 8,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    afterWildcard: "none",
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

            it("reports optionalSpacePunctuation separatorMode when spacing=optional", () => {
                const result = matchGrammarCompletion(grammar, "play");
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 4,
                    separatorMode: "optionalSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });
        });

        describe("separatorMode - wildcard entity", () => {
            // Grammar where the completion is a wildcard entity (not a static string).
            // separatorMode describes the boundary at matchedPrefixLength.
            const g = `<Start> = play $(name) -> { actionName: "play", parameters: { name } };`;
            const grammar = loadGrammarRules("test.grammar", g);

            it("reports separatorMode for 'play' before wildcard", () => {
                const result = matchGrammarCompletion(grammar, "play");
                // matchedPrefixLength=4; boundary "y" → entity needs separator.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                const result = matchGrammarCompletion(grammar, "play ");
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    // Both directions back up to the last matched word.
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("forward exact match also backs up to last word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music",
                        undefined,
                        "forward",
                    );
                    // Both directions back up to the last matched word.
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });

            describe("wildcard at end", () => {
                const g = `<Start> = play $(name) -> { actionName: "play", parameters: { name } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on exact match backs up to wildcard start with property", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "backward",
                    );
                    // Both directions back up to wildcard start (after "play" = 4)
                    // and offer entity property completions.
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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

                it("forward on exact match also backs up to wildcard property", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "forward",
                    );
                    // Both directions back up to wildcard start.
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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

            describe("wildcard in middle", () => {
                const g = `<Start> = play $(name) now -> { actionName: "play", parameters: { name } };`;
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe("wildcard followed by multiple literals", () => {
                const g = `<Start> = play $(name) right now -> { actionName: "play", parameters: { name } };`;
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe("wildcard is last matched part before unmatched literal", () => {
                const g = `<Start> = play $(track) by $(artist) -> { actionName: "play", parameters: { track, artist } };`;
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe("directionSensitive recompute at backed-up position (regression)", () => {
                // Regression: the directionSensitive recompute for
                // backed-up positions must run independently of
                // range-candidate processing. The old code gated both
                // on processRangeCandidates (which included
                // rangeCandidateGateOpen = !anyAfterWildcard ||
                // partialKeywordBackup). When afterWildcard="all" and no
                // partial keyword backup, the recompute was skipped,
                // leaving a potentially stale directionSensitive.
                //
                // This grammar produces afterWildcard="all" in the
                // backward main loop: backward backs up to "now" which
                // follows a captured wildcard (afterWildcard=true).
                const g = `<Start> = play $(track) now -> { actionName: "play", parameters: { track } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward backs up to 'now' with afterWildcard=\"all\"", () => {
                    const bwd = matchGrammarCompletion(
                        grammar,
                        "play Hello now",
                        undefined,
                        "backward",
                    );
                    // Backward: backs up to "now" (mpl=10, after "play Hello").
                    // afterWildcard=true → afterWildcard="all".
                    // Forward would show "now" at mpl=14 (greedy wildcard).
                    // Results differ → directionSensitive must be true.
                    // Invariant #3 validated by the wrapper.
                    expectMetadata(bwd, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        directionSensitive: true,
                        afterWildcard: "all",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("trailing space — backward on 'play ' offers next word", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });

            describe("multi-rule with shared prefix and wildcard", () => {
                const g = [
                    `<Start> = play $(name) -> { actionName: "play", parameters: { name } };`,
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                const g = `<Start> = play $(count) songs -> { actionName: "play", parameters: { count } };`;
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });
        });

        describe("trailing separator — backward matches forward across spacing modes", () => {
            // Trailing separator after a keyword: backward produces the
            // same result as forward because both directions back up
            // past the separator to the same keyword boundary.

            describe("default (auto) spacing", () => {
                const g = `<Start> = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space — backward on 'play music ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("trailing punctuation — backward on 'play music,' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music,",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("backward on 'play ' matches forward (first keyword + trailing space)", () => {
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
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                    expect(backward).toEqual(forward);
                });

                it("backward on 'play,' matches forward (first keyword + trailing punctuation)", () => {
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
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                    });
                    expect(backward).toEqual(forward);
                });
            });

            describe("spacing=required", () => {
                const g = `<Start> [spacing=required] = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space — backward on 'play music ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "spacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });

            describe("spacing=optional", () => {
                const g = `<Start> [spacing=optional] = play music now -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space — backward on 'play music ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play music ",
                        undefined,
                        "backward",
                    );
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 10,
                        separatorMode: "optionalSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "optionalSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });

            describe("spacing=none", () => {
                // In none mode, whitespace and punctuation are literal
                // content, not separators — backward should always work.
                const g = `<Start> [spacing=none] = play music -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space — backward on 'play ' still backs up", () => {
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
                        afterWildcard: "none",
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
                        afterWildcard: "none",
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
                    // Exact match backs up to the last term.
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                    // Both directions back up to the last term.
                    expectMetadata(result, {
                        completions: ["music"],
                        matchedPrefixLength: 4,
                        separatorMode: "none",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });

            describe("auto spacing with CJK", () => {
                const g = `<Start> [spacing=auto] = 再生 音楽 停止 -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("trailing space — backward on CJK '再生 音楽 ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "再生 音楽 ",
                        undefined,
                        "backward",
                    );
                    // Trailing space; should offer "停止".
                    expectMetadata(result, {
                        completions: ["停止"],
                        matchedPrefixLength: 5,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });
            });
        });

        describe("escaped space in last term", () => {
            // An escaped space (\ ) makes the space part of the literal
            // token content.  The trailing separator check should NOT
            // treat such a space as a separator boundary.

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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("trailing separator — backward on 'hello world ' acts like forward", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    // The space after "hello world" IS a real separator.
                    // Should offer "next".
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 11,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        afterWildcard: "none",
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
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        matchedPrefixLength: 6,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("backward on 'hello  ' — real trailing separator", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello  ",
                        undefined,
                        "backward",
                    );
                    // "hello " (literal) consumed 6 chars.  The extra
                    // space at position 6 is a real separator beyond the
                    // match.
                    expectMetadata(result, {
                        completions: ["world"],
                        matchedPrefixLength: 6,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        matchedPrefixLength: 11,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [],
                    });
                });

                it("backward on 'hello world ' — trailing separator", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "hello world ",
                        undefined,
                        "backward",
                    );
                    // Trailing space after complete token.
                    expectMetadata(result, {
                        completions: ["next"],
                        matchedPrefixLength: 11,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("direction-sensitive for 'play ' with trailing space", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["shuffle", "music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("direction-sensitive for 'play shuffle ' (trailing space)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 12,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match 'play shuffle music' backs up to last term", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play shuffle music",
                    undefined,
                    "forward",
                );
                // Exact match backs up to the last term.
                expectMetadata(result, {
                    completions: ["music"],
                    matchedPrefixLength: 12,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match (optional skipped) 'play music' backs up", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play music",
                    undefined,
                    "forward",
                );
                // Category 1 backs up to last term + Category 2
                // offers the optional part.
                expectMetadata(result, {
                    completions: ["shuffle", "music"],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: true,
                            propertyNames: [],
                        },
                    ],
                });
            });

            it("exact match 'play some song' backs up to wildcard property", () => {
                // Exact match with wildcard — both directions back up
                // to the wildcard.
                const result = matchGrammarCompletion(
                    grammar,
                    "play some song",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: true,
                            propertyNames: [],
                        },
                    ],
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

            it("exact match 'play some music' backs up to last term", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music",
                    undefined,
                    "forward",
                );
                // Exact match backs up to last term for matching rule;
                // non-matching rule also contributes via Category 3b.
                expectMetadata(result, {
                    completions: ["music", "video"],
                    matchedPrefixLength: 9,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("exact match with trailing space backs up", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play some music ",
                    undefined,
                    "forward",
                );
                // Rule 1 (play some music): Category 1, trailing
                // separator stripped → backs up to mpl=9.
                // Rule 2 (play some video): Category 3b at mpl=9.
                expectMetadata(result, {
                    completions: ["music", "video"],
                    matchedPrefixLength: 9,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
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

            it("exact match 'set volume 42' backs up to number slot", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "forward",
                );
                // Exact match backs up to the number slot.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
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

            it("backward on 'set volume 42' backs up to number slot", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "set volume 42",
                    undefined,
                    "backward",
                );
                // Both directions back up to number slot.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 10,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("direction-sensitive for 'play song ' (trailing space)", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play song ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["now", "song"],
                    matchedPrefixLength: 9,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                // directionSensitive is true because P=5 > 0 (something
                // was matched); minPrefixLength is a caller-supplied
                // floor, not a property of the result.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 5,
                    separatorMode: undefined,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [],
                });

                expectMetadata(backward, {
                    completions: ["play"],
                    matchedPrefixLength: 0,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: false,
                    afterWildcard: "none",
                    properties: [],
                });
            });

            it("both directions agree for 'play '", () => {
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
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "none",
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
                        afterWildcard: "none",
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
                        afterWildcard: "none",
                    });
                });

                it("trailing space — both directions offer wildcard", () => {
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
                    // Trailing space.
                    // Both directions offer the wildcard property.
                    const expectedProperty = {
                        match: {
                            actionName: "play",
                            parameters: {},
                        },
                        propertyNames: ["parameters.song"],
                    };
                    expectMetadata(forward, {
                        directionSensitive: true,
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

                it("trailing space 'play ' narrows the choice", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play ",
                        undefined,
                        "forward",
                    );
                    // Trailing space — only "play" branch
                    // survives; "player" is eliminated.
                    expectMetadata(result, {
                        completions: ["now"],
                        matchedPrefixLength: 4,
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

                it("backward on 'play music' matches forward on 'play'", () => {
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

                it("backward on 'play music' matches forward on 'play'", () => {
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
                    `<Start> = play $(name) -> { actionName: "play", parameters: { name } };`,
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
                    // All three rules share prefix "play"; both directions
                    // back up to P=4, showing all three next keywords.
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

        describe("backward with wildcard rule cleared by keyword rule", () => {
            // When a wildcard rule's backward candidate is cleared by
            // a longer keyword match from another rule, range candidates
            // from the wildcard rule should still be processed at the
            // surviving keyword rule's position.

            describe("wildcard rule + keyword rule, trailing space", () => {
                const g = [
                    `<Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };`,
                    `<Start> = play beautiful music -> "play_beautiful_music";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play beautiful ' — range candidate anchors at 14", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful ",
                        undefined,
                        "backward",
                    );
                    // Rule B: "play beautiful" matches (14 chars), offers "music".
                    // Rule A: wildcard-at-EOI range candidate adds "by" at
                    // mpl=14.
                    expectMetadata(result, {
                        completions: ["music", "by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });

                it("backward on 'play beautiful' — no trailing space, backs up", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful",
                        undefined,
                        "backward",
                    );
                    // No trailing separator — backward should back up
                    // to "beautiful" at position 4.  Both rules produce
                    // candidates at this position.
                    expectMetadata(result, {
                        completions: ["beautiful"],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
                        properties: [
                            {
                                match: {
                                    actionName: "playBy",
                                    parameters: {},
                                },
                                propertyNames: ["parameters.song"],
                            },
                        ],
                    });
                });
            });

            describe("wildcard rule + keyword rule, no trailing space", () => {
                const g = [
                    `<Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };`,
                    `<Start> = play something good -> "play_something_good";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play something ' — range candidate anchors at 14", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play something ",
                        undefined,
                        "backward",
                    );
                    // Rule B: "play something" matched (14 chars),
                    // offers "good".  Rule A: range candidate adds "by"
                    // at mpl=14.
                    expectMetadata(result, {
                        completions: ["good", "by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });
            });

            describe("range candidates survive when fixed candidate is cleared", () => {
                // When backward's fixed candidate is cleared but range
                // candidates exist, the range candidates should still
                // be processed.
                const g = [
                    `<Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };`,
                    `<Start> = play nice by heart -> "play_nice_by_heart";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play nice by' — keyword rule wins, range candidate from wildcard rule adds 'by'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play nice by",
                        undefined,
                        "backward",
                    );
                    // Rule B: "play nice by" fully matched, backs up
                    // to "by" at position 9.
                    // Rule A: wildcard captured "nice", "by" matched
                    // as keyword — backward backs up to "by" at
                    // position 9 (afterWildcard=true → afterWildcard).
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 9,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });
            });
        });

        // ============================================================
        // Phase 2 separator-only gap — merge vs displace
        //
        // When Phase 2's anchor (input.length or partial keyword
        // position) differs from maxPrefixLength, the gap between
        // mpl and anchor determines whether existing Cat 2 candidates
        // are preserved (merge) or replaced (displace):
        //
        //   Separator-only gap → merge (Cat 2 at EOI)
        //   Non-separator gap  → displace (Cat 3b fallback)
        // ============================================================
        describe("Phase 2 separator-only gap — merge vs displace", () => {
            describe("Cat 3b displace — non-separator gap", () => {
                // Rule A: play $(song) by $(artist) — wildcard
                // Rule B: play some video             — keyword
                //
                // Input: "play beautiful "
                // Rule B: Cat 3b at mpl=4 ("some" doesn't match "beautiful")
                // Rule A: EOI candidate at anchor=15
                // Gap "beautiful " (11 chars) has non-separator content → displace
                const g = `
                    <Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };
                    <Start> = play some video -> "playSomeVideo";
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'play beautiful ' — displaces Cat 3b 'video'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful ",
                        undefined,
                        "forward",
                    );
                    // "video" from Cat 3b (mpl=4) is displaced by
                    // EOI candidate "by" (raw anchor=15, stripped to 14).
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe("Cat 2 merge — separator-only gap (trailing space)", () => {
                // Rule A: play $(song) by $(artist) — wildcard
                // Rule B: play beautiful music       — keyword
                //
                // Input: "play beautiful "
                // Rule B: Cat 2 at mpl=14 (offers "music")
                // Rule A: EOI candidate at anchor=15
                // Gap " " (1 char space) is separator-only → merge
                const g = [
                    `<Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };`,
                    `<Start> = play beautiful music -> "playBeautifulMusic";`,
                ].join("\n");
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'play beautiful ' — merges Cat 2 'music' with 'by'", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful ",
                        undefined,
                        "forward",
                    );
                    expectMetadata(result, {
                        completions: ["music", "by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });

                it("forward on 'play beautiful' — no gap, both at mpl=14", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful",
                        undefined,
                        "forward",
                    );
                    // No trailing space → anchor=14=mpl, natural merge.
                    expectMetadata(result, {
                        completions: ["music", "by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });
            });

            describe("Cat 2 merge — separator-only gap (trailing punctuation)", () => {
                // Punctuation is also a separator character.
                const g = `
                    <Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };
                    <Start> = play beautiful music -> "playBeautifulMusic";
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'play beautiful,' — punctuation gap triggers merge", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful,",
                        undefined,
                        "forward",
                    );
                    // Comma is punctuation (\p{P}), so gap is
                    // separator-only → merge.
                    expectMetadata(result, {
                        completions: ["music", "by"],
                        matchedPrefixLength: 14,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "some",
                        properties: [],
                    });
                });
            });

            describe("Cat 3b displace — large content gap", () => {
                // When Cat 3b candidates are far from the anchor,
                // the gap contains real unmatched content → displace.
                const g = `
                    <Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };
                    <Start> = play something entirely different -> "playDifferent";
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'play beautiful song ' — 3b 'something' at mpl=4 displaced by 'by' at 20", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play beautiful song ",
                        undefined,
                        "forward",
                    );
                    // Rule B: Cat 3b, only matched "play" (mpl=4),
                    // stopped at "something". Gap "beautiful song "
                    // contains non-separator content → displaced.
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 19,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });

            describe("Cat 1 property candidate displaced by EOI anchor", () => {
                // When a Cat 1 exact-match candidate backs up to a
                // wildcard property slot at a lower P, the EOI anchor
                // from another rule displaces it (non-separator gap).
                const g = `
                    <Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };
                    <Start> = play $(song) -> { actionName: "play", parameters: { song } };
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                it("forward on 'play hello ' — keyword 'by' and property completion coexist", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello ",
                        undefined,
                        "forward",
                    );
                    // Rule A: wildcard-at-EOI → offers "by" via Phase 2/3
                    // Rule B: wildcard captured "hello", Cat 1 exact
                    // match backs up to property slot at P=4.  Phase 2
                    // displaces (gap "hello " contains non-separator
                    // content), so only "by" survives.
                    expectMetadata(result, {
                        completions: ["by"],
                        matchedPrefixLength: 10,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "all",
                        properties: [],
                    });
                });
            });
        });

        describe("afterWildcard AND-merge — cross-rule wildcard + literal", () => {
            // Regression test: when a wildcard rule and a literal keyword
            // rule both produce string completions at the same
            // matchedPrefixLength, afterWildcard must be "some" (not "all").
            //
            // Before the AND-merge fix, afterWildcard was OR-merged across
            // candidates, so the literal keyword's completion ("beautiful")
            // was tagged as slidable ("all").  After the shell slid the
            // anchor forward (e.g. "play b" → "play book "), the stale
            // "beautiful" entry remained in the trie and reappeared at the
            // next word boundary.
            const g = `
                <Start> = play $(song) by $(artist) -> { actionName: "playBy", parameters: { song, artist } };
                <Start> = play beautiful music -> "playBeautifulMusic";
            `;
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'play b' — only wildcard rule at this mpl, afterWildcard=\"all\"", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play b",
                    undefined,
                    "forward",
                );
                // Rule A (wildcard): "b" absorbed into $(song),
                //   Phase 2/3 sets anchor at mpl=6, offers "by".
                // Rule B (literal): "b" partial-matches "beautiful"
                //   at mpl=4, which is shorter — discarded.
                // Only wildcard candidates survive → afterWildcard="all".
                expectMetadata(result, {
                    completions: ["by"],
                    matchedPrefixLength: 6,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("forward on 'play beautiful' — mixed merge, afterWildcard=\"some\"", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play beautiful",
                    undefined,
                    "forward",
                );
                // Rule B: matched "play beautiful" (14 chars), offers
                //   "music" (non-wildcard keyword completion).
                // Rule A: wildcard-at-EOI, Phase 2 offers "by"
                //   (after-wildcard completion).
                // Both at mpl=14.  Mixed → afterWildcard="some".
                expectMetadata(result, {
                    completions: ["music", "by"],
                    matchedPrefixLength: 14,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "some",
                    properties: [],
                });
            });

            it("forward on 'play hello' — only wildcard rule contributes, afterWildcard=\"all\"", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play hello",
                    undefined,
                    "forward",
                );
                // Rule A: wildcard absorbed "hello", offers "by"
                //   (afterWildcard="all").
                // Rule B: "hello" doesn't match "beautiful" — no
                //   contribution at this prefix length.
                // Only wildcard candidates → afterWildcard="all".
                expectMetadata(result, {
                    completions: ["by"],
                    matchedPrefixLength: 10,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });

        describe("afterWildcard skip — no re-invocation at wildcard boundary", () => {
            // When backward backs up to a position at an ambiguous
            // wildcard boundary (afterWildcard="all"), re-invocation is
            // skipped because forward on the shorter input re-parses
            // with greedy wildcards that absorb different text.

            describe("wildcard followed by literal", () => {
                const g = [
                    `<Start> = play $(name) right now -> { actionName: "play", parameters: { name } };`,
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
                    // the keyword boundary — afterWildcard="all" because
                    // the keyword follows a wildcard.
                    expectMetadata(result, {
                        completions: ["now"],
                        afterWildcard: "all",
                        directionSensitive: true,
                    });
                });

                it("backward on 'play hello right' backs up to wildcard", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello right",
                        undefined,
                        "backward",
                    );
                    // Full keyword word "right" at EOI — the partial
                    // keyword position equals state.index, so backward
                    // falls through to collectBackwardCandidate which
                    // backs up to the wildcard start.
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        separatorMode: "autoSpacePunctuation",
                        closedSet: false,
                        directionSensitive: true,
                        afterWildcard: "none",
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

            describe("wildcard at end with exact match", () => {
                const g = `<Start> = play $(name) -> { actionName: "play", parameters: { name } };`;
                const grammar = loadGrammarRules("test.grammar", g);

                it("backward on 'play hello' backs up to wildcard property", () => {
                    const result = matchGrammarCompletion(
                        grammar,
                        "play hello",
                        undefined,
                        "backward",
                    );
                    // "play" matched, wildcard captured "hello".
                    // Both directions back up to offer property completion
                    // for the wildcard slot.
                    expectMetadata(result, {
                        completions: [],
                        matchedPrefixLength: 4,
                        directionSensitive: true,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: false,
                        afterWildcard: "none",
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
                        separatorMode: "autoSpacePunctuation",
                        closedSet: true,
                        directionSensitive: true,
                        afterWildcard: "none",
                    });
                });

                it("backward on '... ' (trailing space)", () => {
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
                        matchedPrefixLength: 3,
                        directionSensitive: true,
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
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } };`,
                `<Start> = play $(trackName:<TrackPhrase>) from (the)? album $(albumName) -> { actionName: "playTrack", parameters: { trackName, albumName } };`,
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist) from (the)? album $(albumName) -> { actionName: "playTrack", parameters: { trackName, artists: [artist], albumName } };`,
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
                    matchedPrefixLength: 18,
                    afterWildcard: "all",
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
                    matchedPrefixLength: 18,
                    afterWildcard: "all",
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
                    matchedPrefixLength: 4,
                    afterWildcard: "none",
                    directionSensitive: true,
                });
            });
        });

        describe("partialKeywordBackup with PlayTrackNumberCommand + PlaySpecificTrack", () => {
            // Full player-like grammar including both rule families.
            // Tests whether PlayTrackNumberCommand's (<Item>)?
            // alternatives also contribute at the backed-up position.
            const g = [
                `import { Ordinal, Cardinal };`,
                // PlayTrackNumberCommand
                `<Start> = play (the)? $(n:Ordinal) (<Item>)? -> { actionName: "playFromCurrentTrackList", parameters: { trackNumber: n } };`,
                `<Item> = one | cut | <TrackTerm>;`,
                // PlaySpecificTrack (simplified)
                `<Start> = play $(trackName:<TrackPhrase>) by $(artist) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } };`,
                `<Start> = play $(trackName:<TrackPhrase>) from (the)? album $(albumName) -> { actionName: "playTrack", parameters: { trackName, albumName } };`,
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
                    matchedPrefixLength: 18,
                    directionSensitive: true,
                    afterWildcard: "all",
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
                    matchedPrefixLength: 18,
                    directionSensitive: true,
                    afterWildcard: "all",
                });
            });
        });
        describe("full player grammar — play This Train b", () => {
            // Exact replica of the real playerSchema.agr grammar
            // (minus import/type annotation).  Verifies that the
            // partial keyword recovery works end-to-end with all
            // competing alternatives.
            const g = [
                `import { Ordinal, Cardinal };`,
                `<Start> = <Pause> | <Resume> | <Next> | <PlayCommand> | <SelectDevice>;`,
                `<Pause> = pause -> { actionName: "pause" }`,
                `       | pause music -> { actionName: "pause" }`,
                `       | pause the music -> { actionName: "pause" };`,
                `<Resume> = resume -> { actionName: "resume" }`,
                `         | resume music -> { actionName: "resume" }`,
                `         | resume the music -> { actionName: "resume" };`,
                `<Next> = next -> { actionName: "next" }`,
                `       | skip -> { actionName: "next" }`,
                `       | skip <TrackTerm> -> { actionName: "next" };`,
                `<PlayCommand> = <PlayTrackNumberCommand> | <PlaySpecificTrack>;`,
                `<PlayTrackNumberCommand> = play (the)? $(n:Ordinal) (<Item>)? -> { actionName: "playFromCurrentTrackList", parameters: { trackNumber: n } }`,
                `| play track $(n:Cardinal) -> { actionName: "playFromCurrentTrackList", parameters: { trackNumber: n } }`,
                `| play track #$(n:number) -> { actionName: "playFromCurrentTrackList", parameters: { trackNumber: n } };`,
                `<Item> = one | cut | <TrackTerm>;`,
                `<TrackTerm> = track | song;`,
                `<TrackPhrase> = $(trackName:<TrackName>) -> trackName`,
                `             | the <TrackTerm> $(trackName:<TrackName>) -> trackName`,
                `             | <TrackTerm> $(trackName:<TrackName>) -> trackName`,
                `             | $(trackName:<TrackName>) <TrackTerm> -> trackName;`,
                `<PlaySpecificTrack> = play $(trackName:<TrackPhrase>) by $(artist:<ArtistName>) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } }`,
                `| play $(trackName:<TrackPhrase>) from (the)? album $(albumName:<AlbumName>) -> { actionName: "playTrack", parameters: { trackName, albumName } }`,
                `| play $(trackName:<TrackPhrase>) by $(artist:<ArtistName>) from (the)? album $(albumName:<AlbumName>) -> { actionName: "playTrack", parameters: { trackName, artists: [artist], albumName } };`,
                `<SelectDevice> = select $(deviceName:<DeviceName>) -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| select (the)? $(deviceName:<DeviceName>) device -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| switch to $(deviceName:<DeviceName>) -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| switch to (the)? $(deviceName:<DeviceName>) device -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| use (the)? $(deviceName:<DeviceName>) device -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| use device $(deviceName:<DeviceName>) -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| play on $(deviceName:<DeviceName>) -> { actionName: "selectDevice", parameters: { deviceName } }`,
                `| play on (the)? $(deviceName:<DeviceName>) device -> { actionName: "selectDevice", parameters: { deviceName } };`,
                `<TrackName> = $(x:wildcard);`,
                `<ArtistName> = $(x:wildcard);`,
                `<AlbumName> = $(x:wildcard);`,
                `<DeviceName> = $(x:wildcard);`,
            ].join("\n");
            const grammar = loadGrammarRules("test.grammar", g);

            it("forward on 'play This Train b' anchors at partial keyword", () => {
                const result = matchGrammarCompletion(
                    grammar,
                    "play This Train b",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["by", "one", "cut", "track", "song", "from"],
                    matchedPrefixLength: 15,
                });
            });
        });
    },
);
