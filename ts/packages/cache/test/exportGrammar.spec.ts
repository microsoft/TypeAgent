// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Construction,
    WildcardMode,
} from "../src/constructions/constructions.js";
import {
    createMatchPart,
    MatchPart,
    MatchSet,
    TransformInfo,
} from "../src/constructions/matchPart.js";
import { MatchConfig } from "../src/constructions/constructionMatch.js";
import { Transforms } from "../src/constructions/transforms.js";
import { convertConstructionsToGrammar } from "../src/grammar/exportGrammar.js";
import { toJsonActions } from "../src/explanation/requestAction.js";
import { loadGrammarRules, matchGrammar } from "action-grammar";
import { getPropertyParser } from "../src/constructions/propertyParser.js";
import { createParsePart } from "../src/constructions/parsePart.js";

const defaultConfig: MatchConfig = {
    enableWildcard: true,
    enableEntityWildcard: false,
    rejectReferences: false,
    partial: false,
};

function makeTransformInfo(
    name: string,
    options?: { namespace?: string; partCount?: number; actionIndex?: number },
): TransformInfo {
    return {
        namespace: options?.namespace ?? "test",
        transformName: name,
        partCount: options?.partCount ?? 1,
        actionIndex: options?.actionIndex,
    };
}

function makeTransforms(
    entries: [transformName: string, text: string, value: any][],
    namespace: string = "test",
): Map<string, Transforms> {
    const transforms = new Transforms();
    for (const [paramName, text, value] of entries) {
        transforms.add(paramName, text, value, true);
    }
    return new Map([[namespace, transforms]]);
}

function matchBoth(construction: Construction, request: string) {
    // Match with construction
    const constructionResults = construction.match(request, defaultConfig);

    // Export to grammar and match
    const grammarText = convertConstructionsToGrammar([construction]);
    let grammarResults: { match: unknown }[] = [];
    if (grammarText !== "") {
        const grammar = loadGrammarRules("test", grammarText);
        grammarResults = matchGrammar(grammar, request);
    }

    return { constructionResults, grammarResults, grammarText };
}

function expectEquivalent(construction: Construction, request: string) {
    const { constructionResults, grammarResults } = matchBoth(
        construction,
        request,
    );

    // Both should match
    expect(constructionResults.length).toBeGreaterThan(0);
    expect(grammarResults.length).toBeGreaterThan(0);

    // The matched action should be the same
    const constructionAction = toJsonActions(
        constructionResults[0].match.actions,
    );
    expect(grammarResults[0].match).toEqual(constructionAction);
}

function expectBothNoMatch(construction: Construction, request: string) {
    const { constructionResults, grammarResults } = matchBoth(
        construction,
        request,
    );
    expect(constructionResults.length).toBe(0);
    expect(grammarResults.length).toBe(0);
}

/** Helper: literal MatchPart that matches a single multi-word phrase. */
function literalPart(phrase: string, name?: string): MatchPart {
    return new MatchPart(
        new MatchSet([phrase], name ?? phrase, true, undefined),
        false,
        WildcardMode.Disabled,
        undefined,
    );
}

describe("exportGrammar equivalence", () => {
    describe("basic literal matching", () => {
        it("matches a single literal part", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                makeTransforms([["fullActionName", "play", "player.play"]]),
            );
            expectEquivalent(construction, "play");
        });

        it("matches multiple literal parts", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                    createMatchPart(["music"], "noun"),
                ],
                makeTransforms([["fullActionName", "play", "player.play"]]),
            );
            expectEquivalent(construction, "play music");
        });

        it("does not match wrong input", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                makeTransforms([["fullActionName", "play", "player.play"]]),
            );
            expectBothNoMatch(construction, "stop");
        });
    });

    describe("multiple alternatives in match set", () => {
        it("matches any alternative", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play", "start", "begin"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                makeTransforms([
                    ["fullActionName", "play", "player.play"],
                    ["fullActionName", "start", "player.play"],
                    ["fullActionName", "begin", "player.play"],
                ]),
            );
            expectEquivalent(construction, "play");
            expectEquivalent(construction, "start");
            expectEquivalent(construction, "begin");
        });
    });

    describe("optional parts", () => {
        it("matches with and without optional part", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["please"], "polite", { optional: true }),
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                makeTransforms([["fullActionName", "play", "player.play"]]),
            );
            expectEquivalent(construction, "play");
            expectEquivalent(construction, "please play");
        });
    });

    describe("transform values", () => {
        it("maps different texts to different values", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play", "pause"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                makeTransforms([
                    ["fullActionName", "play", "player.play"],
                    ["fullActionName", "pause", "player.pause"],
                ]),
            );

            const { constructionResults: cr1, grammarResults: gr1 } = matchBoth(
                construction,
                "play",
            );
            const { constructionResults: cr2, grammarResults: gr2 } = matchBoth(
                construction,
                "pause",
            );

            expect(toJsonActions(cr1[0].match.actions)).toEqual(gr1[0].match);
            expect(toJsonActions(cr2[0].match.actions)).toEqual(gr2[0].match);

            // Values should be different for different inputs
            expect(gr1[0].match).not.toEqual(gr2[0].match);
        });
    });

    describe("wildcard parts", () => {
        it("matches wildcard text", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                    new MatchPart(undefined, false, WildcardMode.Enabled, [
                        makeTransformInfo("parameters.query"),
                    ]),
                ],
                makeTransforms([
                    ["fullActionName", "play", "player.play"],
                    ["parameters.query", "some song", "some song"],
                ]),
            );

            const { constructionResults, grammarResults } = matchBoth(
                construction,
                "play some song",
            );

            expect(constructionResults.length).toBeGreaterThan(0);
            expect(grammarResults.length).toBeGreaterThan(0);

            const constructionAction = toJsonActions(
                constructionResults[0].match.actions,
            );
            expect(grammarResults[0].match).toEqual(constructionAction);
        });
    });

    describe("implicit parameters", () => {
        it("includes implicit action name and matches", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "verb", {
                        transformInfos: [makeTransformInfo("parameters.mode")],
                    }),
                ],
                makeTransforms([["parameters.mode", "play", "normal"]]),
                undefined,
                [{ paramName: "fullActionName", paramValue: "player.play" }],
            );
            expectEquivalent(construction, "play");
        });

        it("includes implicit parameter values", () => {
            const construction = Construction.create(
                [createMatchPart(["mute"], "verb")],
                new Map(),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.setVolume",
                    },
                    { paramName: "parameters.level", paramValue: 0 },
                ],
            );
            expectEquivalent(construction, "mute");
        });
    });

    describe("empty array parameters", () => {
        it("includes empty arrays", () => {
            const construction = Construction.create(
                [createMatchPart(["clear"], "verb")],
                new Map(),
                ["parameters.items"],
                [{ paramName: "fullActionName", paramValue: "list.clear" }],
            );
            expectEquivalent(construction, "clear");
        });
    });

    describe("number parse parts", () => {
        it("matches number values", () => {
            const numberParser = getPropertyParser("number");
            expect(numberParser).toBeDefined();

            const construction = Construction.create(
                [
                    literalPart("set volume to"),
                    createParsePart("parameters.level", numberParser!),
                ],
                new Map(),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.setVolume",
                    },
                ],
            );
            expectEquivalent(construction, "set volume to 50");
            expectEquivalent(construction, "set volume to 0");
        });
    });

    describe("percentage parse parts", () => {
        it("matches percentage values", () => {
            const percentageParser = getPropertyParser("percentage");
            expect(percentageParser).toBeDefined();

            const construction = Construction.create(
                [
                    literalPart("reduce volume by"),
                    createParsePart("parameters.amount", percentageParser!),
                ],
                new Map(),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.reduceVolume",
                    },
                ],
            );
            expectEquivalent(construction, "reduce volume by 25%");
        });
    });

    describe("partial transform failures (Option E)", () => {
        it("still matches when some transforms fail", () => {
            // "play" has a valid transform, "start" does not
            const transforms = makeTransforms([
                ["fullActionName", "play", "player.play"],
                // intentionally no entry for "start"
            ]);

            const construction = Construction.create(
                [
                    createMatchPart(["play", "start"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                ],
                transforms,
            );

            // "play" should match in both — its transform succeeds
            const { constructionResults, grammarResults } = matchBoth(
                construction,
                "play",
            );
            expect(constructionResults.length).toBeGreaterThan(0);
            expect(grammarResults.length).toBeGreaterThan(0);
            expect(grammarResults[0].match).toEqual(
                toJsonActions(constructionResults[0].match.actions),
            );
        });
    });

    describe("wildcard fallback (Option D)", () => {
        it("grammar has wildcard fallback for wildcard-enabled parts", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["rock", "pop"], "genre", {
                        transformInfos: [makeTransformInfo("parameters.genre")],
                        wildcardMode: WildcardMode.Enabled,
                    }),
                ],
                makeTransforms([
                    ["parameters.genre", "rock", "rock"],
                    ["parameters.genre", "pop", "pop"],
                ]),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.setGenre",
                    },
                ],
            );

            // Known match — both should agree
            expectEquivalent(construction, "rock");
            expectEquivalent(construction, "pop");

            // Unknown match — construction uses wildcard fallback, grammar
            // should also match via wildcard alternative
            const { constructionResults, grammarResults } = matchBoth(
                construction,
                "jazz",
            );
            expect(constructionResults.length).toBeGreaterThan(0);
            expect(grammarResults.length).toBeGreaterThan(0);

            // Both should capture the raw text as the value
            const constructionAction = toJsonActions(
                constructionResults[0].match.actions,
            );
            expect(grammarResults[0].match).toEqual(constructionAction);
        });

        it("wildcard fallback followed by non-transformed captured part", () => {
            // Regression test: when a wildcard-enabled part's $(wc) alternative
            // is explored by the tree matcher, the pending wildcard leaks into
            // the next captured rule.  matchStringPartWithWildcard must assign
            // the default string value for single-part rules just like the
            // non-wildcard path does, otherwise finalizeNestedRule throws
            // "No value assign to variable".
            const construction = Construction.create(
                [
                    createMatchPart(["play"], "command", {
                        wildcardMode: WildcardMode.Disabled,
                    }),
                    createMatchPart(["rock", "pop", "jazz"], "genre", {
                        transformInfos: [makeTransformInfo("parameters.genre")],
                        wildcardMode: WildcardMode.Enabled,
                    }),
                    createMatchPart(["tunes"], "music", {
                        wildcardMode: WildcardMode.Disabled,
                    }),
                ],
                makeTransforms([
                    ["parameters.genre", "rock", "rock"],
                    ["parameters.genre", "pop", "pop"],
                    ["parameters.genre", "jazz", "jazz"],
                ]),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.playGenre",
                    },
                ],
            );

            // Known genre — should match via literal alternative
            expectEquivalent(construction, "play rock tunes");
            expectEquivalent(construction, "play pop tunes");

            // Unknown genre — wildcard fallback path
            const { constructionResults, grammarResults } = matchBoth(
                construction,
                "play metal tunes",
            );
            expect(constructionResults.length).toBeGreaterThan(0);
            expect(grammarResults.length).toBeGreaterThan(0);
            const constructionAction = toJsonActions(
                constructionResults[0].match.actions,
            );
            expect(grammarResults[0].match).toEqual(constructionAction);
        });
    });

    describe("multi-part transforms (Option A)", () => {
        it("matches cross-product of multi-part groups", () => {
            const tiMulti = makeTransformInfo("parameters.time", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.time", "morning|8am", "8:00 AM"],
                ["parameters.time", "morning|9am", "9:00 AM"],
                ["parameters.time", "evening|8pm", "8:00 PM"],
            ]);

            const construction = Construction.create(
                [
                    literalPart("set alarm for"),
                    new MatchPart(
                        new MatchSet(
                            ["morning", "evening"],
                            "dayPart",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiMulti],
                    ),
                    literalPart("at"),
                    new MatchPart(
                        new MatchSet(
                            ["8am", "9am", "8pm"],
                            "time",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiMulti],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "calendar.setAlarm",
                    },
                ],
            );

            // Valid combinations should match in both
            const { constructionResults: cr1, grammarResults: gr1 } = matchBoth(
                construction,
                "set alarm for morning at 8am",
            );
            expect(cr1.length).toBeGreaterThan(0);
            expect(gr1.length).toBeGreaterThan(0);
            expect(gr1[0].match).toEqual(toJsonActions(cr1[0].match.actions));

            const { constructionResults: cr2, grammarResults: gr2 } = matchBoth(
                construction,
                "set alarm for evening at 8pm",
            );
            expect(cr2.length).toBeGreaterThan(0);
            expect(gr2.length).toBeGreaterThan(0);
            expect(gr2[0].match).toEqual(toJsonActions(cr2[0].match.actions));
        });

        it("does not match invalid combinations", () => {
            const tiMulti = makeTransformInfo("parameters.time", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.time", "morning|8am", "8:00 AM"],
                // "morning|8pm" has no learned value
            ]);

            const construction = Construction.create(
                [
                    literalPart("alarm"),
                    new MatchPart(
                        new MatchSet(["morning"], "dayPart", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiMulti],
                    ),
                    new MatchPart(
                        new MatchSet(["8am", "8pm"], "time", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiMulti],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "calendar.setAlarm",
                    },
                ],
            );

            // Valid combination
            const { constructionResults: cr1, grammarResults: gr1 } = matchBoth(
                construction,
                "alarm morning 8am",
            );
            expect(cr1.length).toBeGreaterThan(0);
            expect(gr1.length).toBeGreaterThan(0);

            // Invalid combination — grammar should not match it either
            const { grammarResults: gr2 } = matchBoth(
                construction,
                "alarm morning 8pm",
            );
            expect(gr2.length).toBe(0);
        });
    });

    describe("combined features", () => {
        it("handles transform + implicit params + optional", () => {
            const construction = Construction.create(
                [
                    createMatchPart(["please"], "polite", { optional: true }),
                    createMatchPart(["play", "start"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                    createMatchPart(["the"], "article", { optional: true }),
                    new MatchPart(undefined, false, WildcardMode.Enabled, [
                        makeTransformInfo("parameters.query"),
                    ]),
                ],
                makeTransforms([
                    ["fullActionName", "play", "player.play"],
                    ["fullActionName", "start", "player.play"],
                    [
                        "parameters.query",
                        "bohemian rhapsody",
                        "bohemian rhapsody",
                    ],
                ]),
                undefined,
                [{ paramName: "parameters.shuffle", paramValue: false }],
            );

            expectEquivalent(construction, "play bohemian rhapsody");
            expectEquivalent(construction, "please play bohemian rhapsody");
            expectEquivalent(construction, "play the bohemian rhapsody");
        });

        it("handles number parse + transform + implicit action", () => {
            const numberParser = getPropertyParser("number");
            expect(numberParser).toBeDefined();

            const construction = Construction.create(
                [
                    createMatchPart(["play", "start"], "verb", {
                        transformInfos: [makeTransformInfo("fullActionName")],
                    }),
                    createMatchPart(["track"], "noun"),
                    createParsePart("parameters.trackNumber", numberParser!),
                ],
                makeTransforms([
                    ["fullActionName", "play", "player.playFromQueue"],
                    ["fullActionName", "start", "player.playFromQueue"],
                ]),
            );

            expectEquivalent(construction, "play track 5");
            expectEquivalent(construction, "start track 12");
        });
    });

    describe("MatchSet caching correctness (#3)", () => {
        it("produces correct values when same MatchSet is used with different transforms", () => {
            // Two constructions sharing the SAME MatchSet reference but with
            // different transforms.  Before the fix the second construction
            // would silently reuse the first's transformed rule.
            const sharedMatchSet = new MatchSet(
                ["on", "off"],
                "toggle",
                true,
                undefined,
            );

            const c1 = Construction.create(
                [
                    new MatchPart(
                        sharedMatchSet,
                        false,
                        WildcardMode.Disabled,
                        [makeTransformInfo("fullActionName")],
                    ),
                ],
                makeTransforms([
                    ["fullActionName", "on", "light.turnOn"],
                    ["fullActionName", "off", "light.turnOff"],
                ]),
            );

            const c2 = Construction.create(
                [
                    new MatchPart(
                        sharedMatchSet,
                        false,
                        WildcardMode.Disabled,
                        [makeTransformInfo("fullActionName")],
                    ),
                ],
                makeTransforms([
                    ["fullActionName", "on", "fan.turnOn"],
                    ["fullActionName", "off", "fan.turnOff"],
                ]),
            );

            // Export both constructions together into one grammar.
            const grammarText = convertConstructionsToGrammar([c1, c2]);
            const grammar = loadGrammarRules("test", grammarText);

            const results = matchGrammar(grammar, "on");
            // Should produce two matches with different values.
            expect(results.length).toBe(2);

            const values = results.map((r) => r.match);
            const hasLight = values.some(
                (v: any) => v.fullActionName === "light.turnOn",
            );
            const hasFan = values.some(
                (v: any) => v.fullActionName === "fan.turnOn",
            );
            expect(hasLight).toBe(true);
            expect(hasFan).toBe(true);
        });

        it("reuses rule definitions for non-transformed MatchSets", () => {
            // With the same MatchSet and no transforms, both constructions
            // should reuse the same rule definition.
            const sharedMatchSet = new MatchSet(
                ["please"],
                "polite",
                true,
                undefined,
            );

            const c1 = Construction.create(
                [
                    new MatchPart(
                        sharedMatchSet,
                        true,
                        WildcardMode.Disabled,
                        undefined,
                    ),
                    createMatchPart(["play"], "verb"),
                ],
                new Map(),
                undefined,
                [{ paramName: "fullActionName", paramValue: "player.play" }],
            );

            const c2 = Construction.create(
                [
                    new MatchPart(
                        sharedMatchSet,
                        true,
                        WildcardMode.Disabled,
                        undefined,
                    ),
                    createMatchPart(["stop"], "verb"),
                ],
                new Map(),
                undefined,
                [{ paramName: "fullActionName", paramValue: "player.stop" }],
            );

            const grammarText = convertConstructionsToGrammar([c1, c2]);

            // The non-transformed MatchSet "polite" should appear only once
            // as a rule definition, not duplicated.
            const politeDefCount = (
                grammarText.match(/^<polite_\d+>\s*=/gm) || []
            ).length;
            expect(politeDefCount).toBe(1);

            // Both should still match correctly.
            const grammar = loadGrammarRules("test", grammarText);
            const r1 = matchGrammar(grammar, "please play");
            const r2 = matchGrammar(grammar, "please stop");
            expect(r1.length).toBeGreaterThan(0);
            expect(r2.length).toBeGreaterThan(0);
            expect((r1[0].match as any).fullActionName).toBe("player.play");
            expect((r2[0].match as any).fullActionName).toBe("player.stop");
        });
    });

    describe("cross-group decomposition (#1)", () => {
        it("decomposes independent contiguous groups into composite rules", () => {
            // Two independent 2-part groups: time and venue.
            const tiTime = makeTransformInfo("parameters.time", {
                partCount: 2,
            });
            const tiVenue = makeTransformInfo("parameters.venue", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.time", "morning|8am", "8:00 AM"],
                ["parameters.time", "morning|9am", "9:00 AM"],
                ["parameters.time", "evening|8pm", "8:00 PM"],
                ["parameters.venue", "room|101", "Room 101"],
                ["parameters.venue", "room|202", "Room 202"],
            ]);

            const construction = Construction.create(
                [
                    literalPart("book"),
                    new MatchPart(
                        new MatchSet(
                            ["morning", "evening"],
                            "dayPart",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    literalPart("at"),
                    new MatchPart(
                        new MatchSet(
                            ["8am", "9am", "8pm"],
                            "hour",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    literalPart("in"),
                    new MatchPart(
                        new MatchSet(["room"], "place", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                    new MatchPart(
                        new MatchSet(["101", "202"], "number", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "calendar.book",
                    },
                ],
            );

            // Verify all valid combinations match.
            const { constructionResults: cr1, grammarResults: gr1 } = matchBoth(
                construction,
                "book morning at 8am in room 101",
            );
            expect(cr1.length).toBeGreaterThan(0);
            expect(gr1.length).toBeGreaterThan(0);
            expect(gr1[0].match).toEqual(toJsonActions(cr1[0].match.actions));

            const { constructionResults: cr2, grammarResults: gr2 } = matchBoth(
                construction,
                "book evening at 8pm in room 202",
            );
            expect(cr2.length).toBeGreaterThan(0);
            expect(gr2.length).toBeGreaterThan(0);
            expect(gr2[0].match).toEqual(toJsonActions(cr2[0].match.actions));

            // Cross-group combination should also work (morning+room 202).
            const { constructionResults: cr3, grammarResults: gr3 } = matchBoth(
                construction,
                "book morning at 9am in room 202",
            );
            expect(cr3.length).toBeGreaterThan(0);
            expect(gr3.length).toBeGreaterThan(0);
            expect(gr3[0].match).toEqual(toJsonActions(cr3[0].match.actions));
        });

        it("produces fewer Start alternatives than full cross-product", () => {
            const tiTime = makeTransformInfo("parameters.time", {
                partCount: 2,
            });
            const tiVenue = makeTransformInfo("parameters.venue", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.time", "morning|8am", "8:00 AM"],
                ["parameters.time", "morning|9am", "9:00 AM"],
                ["parameters.time", "evening|8pm", "8:00 PM"],
                ["parameters.venue", "room|101", "Room 101"],
                ["parameters.venue", "room|202", "Room 202"],
            ]);

            const construction = Construction.create(
                [
                    literalPart("book"),
                    new MatchPart(
                        new MatchSet(
                            ["morning", "evening"],
                            "dayPart",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    literalPart("at"),
                    new MatchPart(
                        new MatchSet(
                            ["8am", "9am", "8pm"],
                            "hour",
                            true,
                            undefined,
                        ),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    literalPart("in"),
                    new MatchPart(
                        new MatchSet(["room"], "place", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                    new MatchPart(
                        new MatchSet(["101", "202"], "number", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "calendar.book",
                    },
                ],
            );

            const grammarText = convertConstructionsToGrammar([construction]);

            // Without decomposition, 3 time combos × 2 venue combos = 6 Start
            // alternatives.  With decomposition, there should be only 1 Start
            // alternative (referencing composite rules).
            const startAlternatives = grammarText
                .split("\n")
                .filter((line) => /^<Start>/.test(line.trim()));
            // Start definition should appear once.
            expect(startAlternatives.length).toBe(1);

            // Count pipe-separated alternatives in the Start rule.
            // The Start rule uses composite references, so it should have 1
            // alternative (no | separators in the Start definition).
            const startDef = startAlternatives[0];
            const pipeCount = (startDef.match(/\|/g) || []).length;
            expect(pipeCount).toBe(0);

            // Composite rules should exist.
            const compositeRules = grammarText
                .split("\n")
                .filter((line) => /^<multiPart_\d+>/.test(line.trim()));
            expect(compositeRules.length).toBe(2);
        });

        it("does not match invalid within-group combinations", () => {
            const tiTime = makeTransformInfo("parameters.time", {
                partCount: 2,
            });
            const tiVenue = makeTransformInfo("parameters.venue", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.time", "morning|8am", "8:00 AM"],
                // morning|8pm is NOT valid
                ["parameters.venue", "room|101", "Room 101"],
            ]);

            const construction = Construction.create(
                [
                    literalPart("book"),
                    new MatchPart(
                        new MatchSet(["morning"], "dayPart", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    new MatchPart(
                        new MatchSet(["8am", "8pm"], "hour", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiTime],
                    ),
                    literalPart("in"),
                    new MatchPart(
                        new MatchSet(["room"], "place", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                    new MatchPart(
                        new MatchSet(["101"], "number", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiVenue],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "calendar.book",
                    },
                ],
            );

            // Valid: morning 8am + room 101.
            const { grammarResults: gr1 } = matchBoth(
                construction,
                "book morning 8am in room 101",
            );
            expect(gr1.length).toBeGreaterThan(0);

            // Invalid within time group: morning 8pm.
            const { grammarResults: gr2 } = matchBoth(
                construction,
                "book morning 8pm in room 101",
            );
            expect(gr2.length).toBe(0);
        });

        it("falls back to cross-product when groups overlap", () => {
            // Create a construction where two groups' spans would overlap.
            // Group A: parts 0, 2.  Group B: parts 1, 3.
            // Spans A=[0,2], B=[1,3] overlap → can't decompose.
            const tiA = makeTransformInfo("parameters.propA", {
                partCount: 2,
            });
            const tiB = makeTransformInfo("parameters.propB", {
                partCount: 2,
            });

            const transforms = makeTransforms([
                ["parameters.propA", "a1|a2", "valA"],
                ["parameters.propB", "b1|b2", "valB"],
            ]);

            const construction = Construction.create(
                [
                    new MatchPart(
                        new MatchSet(["a1"], "setA1", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiA],
                    ),
                    new MatchPart(
                        new MatchSet(["b1"], "setB1", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiB],
                    ),
                    new MatchPart(
                        new MatchSet(["a2"], "setA2", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiA],
                    ),
                    new MatchPart(
                        new MatchSet(["b2"], "setB2", true, undefined),
                        false,
                        WildcardMode.Disabled,
                        [tiB],
                    ),
                ],
                transforms,
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "test.overlapping",
                    },
                ],
            );

            // Should still produce a correct grammar (via cross-product
            // fallback) even though decomposition isn't possible.
            const { constructionResults, grammarResults } = matchBoth(
                construction,
                "a1 b1 a2 b2",
            );
            expect(constructionResults.length).toBeGreaterThan(0);
            expect(grammarResults.length).toBeGreaterThan(0);
            expect(grammarResults[0].match).toEqual(
                toJsonActions(constructionResults[0].match.actions),
            );

            // Grammar should NOT contain composite multiPart rules (since
            // decomposition was not possible).
            const grammarText = convertConstructionsToGrammar([construction]);
            expect(grammarText).not.toMatch(/<multiPart_\d+>/);
        });
    });

    describe("multi-transform parts (#7)", () => {
        function matchBothExpr(construction: Construction, request: string) {
            const constructionResults = construction.match(
                request,
                defaultConfig,
            );
            const grammarText = convertConstructionsToGrammar([construction], {
                enableValueExpressions: true,
            });
            let grammarResults: { match: unknown }[] = [];
            if (grammarText !== "") {
                const grammar = loadGrammarRules("test", grammarText, {
                    enableValueExpressions: true,
                });
                grammarResults = matchGrammar(grammar, request);
            }
            return { constructionResults, grammarResults, grammarText };
        }

        it("handles a single part with multiple transforms", () => {
            // A single MatchPart that maps the same text to two different
            // properties (e.g., "rock" → genre="rock" and category="music").
            const construction = Construction.create(
                [
                    createMatchPart(["rock", "pop"], "genre", {
                        transformInfos: [
                            makeTransformInfo("genre"),
                            makeTransformInfo("category"),
                        ],
                    }),
                ],
                makeTransforms([
                    ["genre", "rock", "rock"],
                    ["genre", "pop", "pop"],
                    ["category", "rock", "music"],
                    ["category", "pop", "music"],
                ]),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.setGenre",
                    },
                ],
            );

            // Verify both properties are present in the result.
            const { grammarResults } = matchBothExpr(construction, "rock");
            expect(grammarResults.length).toBeGreaterThan(0);
            expect((grammarResults[0].match as any).genre).toBe("rock");
            expect((grammarResults[0].match as any).category).toBe("music");
            expect((grammarResults[0].match as any).fullActionName).toBe(
                "player.setGenre",
            );

            // Also verify "pop"
            const { grammarResults: gr2 } = matchBothExpr(construction, "pop");
            expect(gr2.length).toBeGreaterThan(0);
            expect((gr2[0].match as any).genre).toBe("pop");
            expect((gr2[0].match as any).category).toBe("music");
        });

        it("skips matches where any transform fails in multi-transform", () => {
            // "rock" has both transforms, "jazz" only has genre — should be
            // skipped from the multi-transform rule.
            const construction = Construction.create(
                [
                    createMatchPart(["rock", "jazz"], "genre", {
                        transformInfos: [
                            makeTransformInfo("genre"),
                            makeTransformInfo("category"),
                        ],
                    }),
                ],
                makeTransforms([
                    ["genre", "rock", "rock"],
                    ["genre", "jazz", "jazz"],
                    ["category", "rock", "music"],
                    // no category entry for "jazz"
                ]),
                undefined,
                [
                    {
                        paramName: "fullActionName",
                        paramValue: "player.setGenre",
                    },
                ],
            );

            // "rock" should match — both transforms succeed.
            const { grammarResults: gr1 } = matchBothExpr(construction, "rock");
            expect(gr1.length).toBeGreaterThan(0);

            // "jazz" should not match in grammar — category transform fails.
            const { grammarResults: gr2 } = matchBothExpr(construction, "jazz");
            expect(gr2.length).toBe(0);
        });
    });
});
