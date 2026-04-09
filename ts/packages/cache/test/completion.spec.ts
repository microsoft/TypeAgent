// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Construction,
    WildcardMode,
} from "../src/constructions/constructions.js";
import {
    CompletionResult,
    ConstructionCache,
    MatchOptions,
} from "../src/constructions/constructionCache.js";
import {
    createMatchPart,
    MatchPart,
    MatchSet,
    TransformInfo,
} from "../src/constructions/matchPart.js";

// Helpers for backward-compat access to per-group CompletionResult
function flatCompletions(result: CompletionResult): string[] {
    return result.groups.flatMap((g) => g.completions);
}
function firstSepMode(result: CompletionResult) {
    return result.groups.length > 0
        ? result.groups[0].separatorMode
        : undefined;
}

function makeTransformInfo(name: string): TransformInfo {
    return {
        namespace: "test",
        transformName: name,
        partCount: 1,
    };
}

function createEntityPart(name: string, transformName: string): MatchPart {
    return new MatchPart(undefined, false, WildcardMode.Entity, [
        makeTransformInfo(transformName),
    ]);
}

function createWildcardEnabledPartWithMatches(
    matches: string[],
    name: string,
    transformName: string,
): MatchPart {
    const matchSet = new MatchSet(matches, name, true, undefined);
    return new MatchPart(matchSet, false, WildcardMode.Enabled, [
        makeTransformInfo(transformName),
    ]);
}

function makeCache(
    constructions: Construction[],
    namespace: string[] = ["test"],
): ConstructionCache {
    const cache = new ConstructionCache("test");
    for (const c of constructions) {
        cache.addConstruction(namespace, c, true);
    }
    return cache;
}

const defaultOptions: MatchOptions = { namespaceKeys: ["test"] };

describe("ConstructionCache.completion()", () => {
    describe("empty prefix", () => {
        it("returns first non-optional parts from all constructions", () => {
            const c1 = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const c2 = Construction.create(
                [createMatchPart(["stop"], "verb")],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion("", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual(["play", "stop"]);
            expect(result!.matchedPrefixLength).toBe(0);
            expect(result!.closedSet).toBe(true);
        });
        it("returns empty string prefix as undefined", () => {
            const cache = new ConstructionCache("test");
            const result = cache.completion("", defaultOptions);
            expect(result).toBeUndefined();
        });

        it("skips optional leading parts", () => {
            const optionalPart = createMatchPart(["please"], "polite", {
                optional: true,
            });
            const verbPart = createMatchPart(["play"], "verb");
            const c = Construction.create([optionalPart, verbPart], new Map());
            const cache = makeCache([c]);
            const result = cache.completion("", defaultOptions);
            expect(result).toBeDefined();
            // Should return the first non-optional part's completions
            expect(flatCompletions(result!)).toEqual(["play"]);
        });
    });

    describe("matchedPrefixLength", () => {
        it("returns matchedPrefixLength matching the consumed prefix", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toContain("song");
            // The matcher consumes "play" (4 chars); the trailing space
            // is consumed as a trailing separator → matchedPrefixLength=5.
            expect(result!.matchedPrefixLength).toBe(5);
        });

        it("returns matchedPrefixLength for partial single-part match", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            // "pl" partially matches "play"
            const result = cache.completion("pl", defaultOptions);
            expect(result).toBeDefined();
            if (flatCompletions(result!).length > 0) {
                expect(result!.matchedPrefixLength).toBeGreaterThanOrEqual(0);
            }
        });

        it("discards shorter-prefix completions when longer exists", () => {
            // Construction 1: "play song" (two parts)
            const c1 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song", "track"], "noun"),
                ],
                new Map(),
            );
            // Construction 2: "play" (one part only, so exact match)
            const c2 = Construction.create(
                [createMatchPart(["play"], "verb2")],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            // "play " is an exact match for c2, but partial for c1
            // c2 is exact → matchedPrefixLength = "play ".length = 5
            // c1 partial on second part → matchedPrefixLength = 5
            // Both should have the same prefix length
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(result!.matchedPrefixLength).toBe(5);
        });
    });

    describe("closedSet", () => {
        it("is true when all completions are from literal match parts", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song", "album"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(result!.closedSet).toBe(true);
        });

        it("is false when entity wildcard properties are involved", () => {
            const verbPart = createMatchPart(["play"], "verb");
            const entityPart = createEntityPart("entity", "songName");
            const c = Construction.create([verbPart, entityPart], new Map());
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(result!.closedSet).toBe(false);
        });

        it("is false when wildcard-enabled part with property names is next", () => {
            const verbPart = createMatchPart(["play"], "verb");
            const wildcardPart = createWildcardEnabledPartWithMatches(
                ["rock", "pop"],
                "genre",
                "genreName",
            );
            const c = Construction.create([verbPart, wildcardPart], new Map());
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            // The wildcard-enabled part has both completions AND property names
            // Property names → closedSet becomes false
            expect(result!.closedSet).toBe(false);
            // Should still include the literal completions from the matchSet
            expect(flatCompletions(result!).sort()).toEqual(["pop", "rock"]);
        });
    });

    describe("separatorMode", () => {
        it("returns spacePunctuation when prefix ends with word char and completion starts with word char", () => {
            // "play" ends with 'y' (Latin), "song" starts with 's' (Latin)
            // → both are word-boundary scripts → needs separator
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            // The matcher consumes "play" (4 chars). Construction cache
            // defers per-item separator resolution to the shell.
            expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
        });

        it("returns spacePunctuation between adjacent word characters", () => {
            // Use a two-word single match part to get adjacent word chars
            // "play" followed by completions starting with 's'
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            // "play" is 4 chars, no trailing space.
            // If partial matching consumes "play" (4 chars), the next part "song" starts
            // with 's'. Last prefix char is 'y' — both Latin → spacePunctuation
            const result = cache.completion("play", defaultOptions);
            expect(result).toBeDefined();
            if (
                flatCompletions(result!).length > 0 &&
                result!.matchedPrefixLength === 4
            ) {
                // Construction cache defers resolution → autoSpacePunctuation
                expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
            }
        });

        it("returns optional between non-word chars", () => {
            // Prefix ends with punctuation, completions start with letter
            // "!" is not a word-boundary script
            const c = Construction.create(
                [
                    createMatchPart(["hey!"], "exclaim"),
                    createMatchPart(["world"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("hey! ", defaultOptions);
            if (result && flatCompletions(result).length > 0) {
                // Construction cache defers resolution → autoSpacePunctuation
                expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
            }
        });

        it("returns spacePunctuation between adjacent digits", () => {
            // Both '3' and '4' are digits → needsSeparatorInAutoMode
            const c = Construction.create(
                [
                    createMatchPart(["item3"], "first"),
                    createMatchPart(["4ever"], "second"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("item3", defaultOptions);
            if (
                result &&
                flatCompletions(result).length > 0 &&
                result.matchedPrefixLength === 5
            ) {
                // Construction cache defers resolution → autoSpacePunctuation
                expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
            }
        });
    });

    describe("completions content", () => {
        it("returns next part completions for partial match", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song", "album", "track"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual([
                "album",
                "song",
                "track",
            ]);
        });

        it("returns empty completions for exact match with no remaining parts", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            // Exact match — nothing left to complete
            const result = cache.completion("play", defaultOptions);
            expect(result).toBeDefined();
            // Exact match advances maxPrefixLength to requestPrefix.length
            expect(result!.matchedPrefixLength).toBe(4);
            expect(flatCompletions(result!)).toEqual([]);
        });

        it("returns completions from multiple constructions with same prefix length", () => {
            const c1 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const c2 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["album"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual(["album", "song"]);
        });
    });

    describe("properties", () => {
        it("returns property names for entity wildcard parts", () => {
            const verbPart = createMatchPart(["play"], "verb");
            const entityPart = createEntityPart("entity", "songName");
            const c = Construction.create([verbPart, entityPart], new Map());
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(result!.properties).toBeDefined();
            expect(result!.properties!.length).toBeGreaterThan(0);
            expect(result!.properties![0].names).toContain("songName");
        });
    });

    describe("namespace filtering", () => {
        it("filters completions by namespace keys", () => {
            // Use distinct match-set names to prevent merging across
            // namespaces (same name + canBeMerged → shared MatchSet).
            const c1 = Construction.create(
                [createMatchPart(["play"], "verb1", { canBeMerged: false })],
                new Map(),
            );
            const c2 = Construction.create(
                [createMatchPart(["stop"], "verb2", { canBeMerged: false })],
                new Map(),
            );
            const cache = new ConstructionCache("test");
            cache.addConstruction(["ns1"], c1, true);
            cache.addConstruction(["ns2"], c2, true);

            const r1 = cache.completion("", { namespaceKeys: ["ns1"] });
            expect(r1).toBeDefined();
            expect(flatCompletions(r1!)).toEqual(["play"]);

            const r2 = cache.completion("", { namespaceKeys: ["ns2"] });
            expect(r2).toBeDefined();
            expect(flatCompletions(r2!)).toEqual(["stop"]);
        });

        it("returns completions from all namespaces when no filter", () => {
            const c1 = Construction.create(
                [createMatchPart(["play"], "verb1", { canBeMerged: false })],
                new Map(),
            );
            const c2 = Construction.create(
                [createMatchPart(["stop"], "verb2", { canBeMerged: false })],
                new Map(),
            );
            const cache = new ConstructionCache("test");
            cache.addConstruction(["ns1"], c1, true);
            cache.addConstruction(["ns2"], c2, true);

            const result = cache.completion("", {});
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual(["play", "stop"]);
        });

        it("returns no completions for empty namespace keys", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("", {
                namespaceKeys: [],
            });
            // Empty namespace keys → no constructions match → no completions.
            expect(result).toBeUndefined();
        });
    });

    describe("progressive prefix matching", () => {
        // Tests for progressive prefix lengths against a "play" + "song"
        // construction.  The match engine supports intra-part partial
        // matching — a prefix like "p" returns completions from the
        // first unmatched part (matchedPrefixLength=0) and the caller
        // (UI) filters by the remaining text, matching the grammar
        // matcher's behaviour.

        let cache: ConstructionCache;
        beforeEach(() => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            cache = makeCache([c]);
        });

        it("prefix 'p' — partial prefix returns first part completions", () => {
            const result = cache.completion("p", defaultOptions);
            expect(result).toBeDefined();
            // "p" doesn't fully match "play" but the partial match
            // succeeds and returns the first part's candidates.
            // The caller filters by the remaining text ("p").
            expect(flatCompletions(result!)).toContain("play");
            expect(result!.matchedPrefixLength).toBe(0);
            expect(result!.closedSet).toBe(true);
        });

        it("prefix 'pl' — partial prefix returns first part completions", () => {
            const result = cache.completion("pl", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toContain("play");
            expect(result!.matchedPrefixLength).toBe(0);
        });

        it("prefix 'play' — first part fully matched, offers second part", () => {
            const result = cache.completion("play", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toEqual(["song"]);
            expect(result!.matchedPrefixLength).toBe(4);
            expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
            expect(result!.closedSet).toBe(true);
        });

        it("prefix 'play ' — trailing space consumed, still offers second part", () => {
            const result = cache.completion("play ", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toEqual(["song"]);
            // Trailing space consumed → matchedPrefixLength advances to 5.
            // Construction cache defers per-item separator resolution
            // to the shell.
            expect(result!.matchedPrefixLength).toBe(5);
            expect(firstSepMode(result!)).toBe("autoSpacePunctuation");
        });

        it("prefix 'play s' — partial intra-part on second part, returns completions", () => {
            const result = cache.completion("play s", defaultOptions);
            expect(result).toBeDefined();
            // "play" is fully matched (4 chars), " s" remains as
            // partial prefix for the second part.
            expect(flatCompletions(result!)).toContain("song");
            expect(result!.matchedPrefixLength).toBe(4);
        });

        it("prefix 'play song' — exact full match, empty completions", () => {
            const result = cache.completion("play song", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toEqual([]);
            expect(result!.matchedPrefixLength).toBe(9);
            expect(result!.closedSet).toBe(true);
        });
    });

    describe("multiple alternatives in a single part", () => {
        it("offers all alternatives when first part is fully matched", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play", "start"], "verb"),
                    createMatchPart(["song", "track", "album"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);

            const r1 = cache.completion("play", defaultOptions);
            expect(r1).toBeDefined();
            expect(flatCompletions(r1!).sort()).toEqual([
                "album",
                "song",
                "track",
            ]);

            const r2 = cache.completion("start", defaultOptions);
            expect(r2).toBeDefined();
            expect(flatCompletions(r2!).sort()).toEqual([
                "album",
                "song",
                "track",
            ]);
        });
    });

    describe("case insensitivity", () => {
        it("matches prefix case-insensitively", () => {
            const c = Construction.create(
                [
                    createMatchPart(["Play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("PLAY", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!)).toEqual(["song"]);
            expect(result!.matchedPrefixLength).toBe(4);
        });
    });

    describe("multi-part constructions", () => {
        it("completes third part after matching first two", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["the"], "article"),
                    createMatchPart(["song", "album"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play the ", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual(["album", "song"]);
        });

        it("returns merged match set completions after merge", () => {
            // Two constructions with same structure merge their match sets
            const c1 = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const c2 = Construction.create(
                [createMatchPart(["stop"], "verb")],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            // After merge, the match set should contain both "play" and "stop"
            const result = cache.completion("", defaultOptions);
            expect(result).toBeDefined();
            expect(flatCompletions(result!).sort()).toEqual(["play", "stop"]);
        });
    });

    describe("wildcard completions", () => {
        describe("entity wildcard after literal", () => {
            it("returns property completion for entity wildcard", () => {
                const verbPart = createMatchPart(["play"], "verb");
                const entityPart = createEntityPart("entity", "songName");
                const c = Construction.create(
                    [verbPart, entityPart],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion("play", defaultOptions);
                expect(result).toBeDefined();
                expect(result!.properties).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("songName");
                expect(result!.closedSet).toBe(false);
                expect(result!.matchedPrefixLength).toBe(4);
            });

            it("returns property completion with trailing space", () => {
                const verbPart = createMatchPart(["play"], "verb");
                const entityPart = createEntityPart("entity", "songName");
                const c = Construction.create(
                    [verbPart, entityPart],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion("play ", defaultOptions);
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("songName");
            });

            it("consumes trailing wildcard text as exact match", () => {
                const verbPart = createMatchPart(["play"], "verb");
                const entityPart = createEntityPart("entity", "songName");
                const c = Construction.create(
                    [verbPart, entityPart],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion("play my song", defaultOptions);
                expect(result).toBeDefined();
                // Wildcard consumes "my song" → exact match, no completions.
                expect(flatCompletions(result!)).toEqual([]);
                expect(result!.matchedPrefixLength).toBe(12);
            });
        });

        describe("wildcard in middle of construction", () => {
            // Mirrors the grammar test:
            //   play $(trackName:wildcard) by $(artist:wildcard)
            let cache: ConstructionCache;
            beforeEach(() => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createEntityPart("track", "trackName"),
                        createMatchPart(["by"], "prep"),
                        createEntityPart("artist", "artist"),
                    ],
                    new Map(),
                );
                cache = makeCache([c]);
            });

            it("after prefix, returns property completion for first wildcard", () => {
                const result = cache.completion("play", defaultOptions);
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("trackName");
                expect(result!.closedSet).toBe(false);
                expect(result!.matchedPrefixLength).toBe(4);
            });

            it("after prefix with space, returns property for wildcard", () => {
                const result = cache.completion("play ", defaultOptions);
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("trackName");
            });

            it("after wildcard text, returns next literal as completion", () => {
                // Grammar behavior: after "play some song", the
                // wildcard consumed "some song" and "by" is the next
                // completion.
                const result = cache.completion(
                    "play some song",
                    defaultOptions,
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("by");
                expect(result!.matchedPrefixLength).toBe(14);
            });

            it("after wildcard text and literal, returns property for second wildcard", () => {
                const result = cache.completion(
                    "play some song by",
                    defaultOptions,
                );
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("artist");
                expect(result!.closedSet).toBe(false);
            });

            it("complete input is an exact match", () => {
                const result = cache.completion(
                    "play some song by john",
                    defaultOptions,
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toEqual([]);
                expect(result!.matchedPrefixLength).toBe(22);
            });

            it("multi-word wildcard text is consumed", () => {
                const result = cache.completion(
                    "play a really long track name by",
                    defaultOptions,
                );
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("artist");
            });
        });

        describe("wildcard-enabled with matches in middle", () => {
            it("advances past wildcard-enabled part when literal matches", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createWildcardEnabledPartWithMatches(
                            ["rock", "pop"],
                            "genre",
                            "genreName",
                        ),
                        createMatchPart(["music"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                // "rock" matches the wildcard-enabled part literally,
                // so the matcher advances past it to offer "music".
                const result = cache.completion("play rock ", defaultOptions);
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("music");
            });

            it("offers wildcard-enabled part completions when literal doesn't match", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createWildcardEnabledPartWithMatches(
                            ["rock", "pop"],
                            "genre",
                            "genreName",
                        ),
                        createMatchPart(["music"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                // "play " — second part (wildcard-enabled) offers its
                // literal matches and property names.
                const result = cache.completion("play ", defaultOptions);
                expect(result).toBeDefined();
                expect(flatCompletions(result!).sort()).toEqual([
                    "pop",
                    "rock",
                ]);
                expect(result!.closedSet).toBe(false);
            });

            it("advances past wildcard-enabled part with non-matching text to offer next literal", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createWildcardEnabledPartWithMatches(
                            ["rock", "pop"],
                            "genre",
                            "genreName",
                        ),
                        createMatchPart(["music"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                // "jazz" doesn't match "rock"/"pop" literally, but
                // the wildcard-enabled part can consume it as wildcard
                // text. The next literal "music" is offered.
                const result = cache.completion("play jazz ", defaultOptions);
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("music");
            });
        });

        describe("construction starting with wildcard", () => {
            it("returns property completion for leading wildcard on empty prefix", () => {
                const c = Construction.create(
                    [
                        createEntityPart("track", "trackName"),
                        createMatchPart(["by"], "prep"),
                        createEntityPart("artist", "artist"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion("", defaultOptions);
                expect(result).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("trackName");
            });

            it("after wildcard text, returns next literal as completion", () => {
                const c = Construction.create(
                    [
                        createEntityPart("track", "trackName"),
                        createMatchPart(["by"], "prep"),
                        createEntityPart("artist", "artist"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion("some song", defaultOptions);
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("by");
            });
        });
    });

    describe("backward direction", () => {
        describe("literal-only construction", () => {
            it("backs up to last part start on exact match", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Backs up to last part start ("play" consumed 4
                // chars; the space is a separator, not part of any
                // match part).
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(4);
            });

            it("backs up to last part start for single-part construction", () => {
                const c = Construction.create(
                    [createMatchPart(["play"], "verb")],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Single part — backs up to 0 (the start of the only part).
                expect(flatCompletions(result!)).toContain("play");
                expect(result!.matchedPrefixLength).toBe(0);
            });

            it("forward exact match still returns empty completions", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "forward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toEqual([]);
                expect(result!.matchedPrefixLength).toBe(9);
            });
        });

        describe("multi-alternative last part", () => {
            it("offers all alternatives from last part on backward", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song", "track", "album"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!).sort()).toEqual([
                    "album",
                    "song",
                    "track",
                ]);
                expect(result!.matchedPrefixLength).toBe(4);
            });
        });

        describe("entity wildcard at end", () => {
            it("backward on exact match offers property completions", () => {
                const verbPart = createMatchPart(["play"], "verb");
                const entityPart = createEntityPart("entity", "songName");
                const c = Construction.create(
                    [verbPart, entityPart],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play my song",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Backward backs up to last part start and offers
                // property completions for the entity wildcard.
                expect(result!.properties).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("songName");
                expect(result!.closedSet).toBe(false);
            });

            it("forward on exact match with wildcard returns empty", () => {
                const verbPart = createMatchPart(["play"], "verb");
                const entityPart = createEntityPart("entity", "songName");
                const c = Construction.create(
                    [verbPart, entityPart],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play my song",
                    defaultOptions,
                    "forward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toEqual([]);
                expect(result!.matchedPrefixLength).toBe(12);
            });
        });

        describe("wildcard in middle", () => {
            it("backward on full match backs up to last wildcard part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createEntityPart("track", "trackName"),
                        createMatchPart(["by"], "prep"),
                        createEntityPart("artist", "artist"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play some song by john",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Last part is the artist entity — backward offers
                // property completions for it.
                expect(result!.properties).toBeDefined();
                expect(result!.properties!.length).toBeGreaterThan(0);
                expect(result!.properties![0].names).toContain("artist");
                expect(result!.closedSet).toBe(false);
            });
        });

        describe("partial match backs up to previous part", () => {
            it("backward on 'play' (no trailing space) backs up to 'play'", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // No trailing space — backward backs up to offer
                // "play" at position 0.
                expect(flatCompletions(result!)).toContain("play");
                expect(result!.matchedPrefixLength).toBe(0);
            });

            it("trailing space commits — backward on 'play ' offers next part (same as forward)", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play ",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Trailing space is a commit signal — direction no
                // longer matters.  Should offer "song" same as forward.
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(5);
            });

            it("forward on 'play ' offers next part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play ",
                    defaultOptions,
                    "forward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(5);
            });
        });

        describe("partial match with three parts", () => {
            it("backward on 'play song' (2 of 3 parts matched) backs up to 'song'", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                        createMatchPart(["now"], "adv"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(4);
            });

            it("forward on 'play song' (2 of 3 parts matched) offers 'now'", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                        createMatchPart(["now"], "adv"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "forward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("now");
                expect(result!.matchedPrefixLength).toBe(9);
            });
        });

        describe("trailing optional skipped", () => {
            it("backward skips trailing optional and backs up to last real part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                        createMatchPart(["now"], "adv", { optional: true }),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                // "play song" matches parts 0 and 1; part 2 is
                // optional and skipped (matchedStarts[2] = -1).
                // Backward should skip the optional and back up to
                // "song" (the last real match), not to -1.
                const result = cache.completion(
                    "play song",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(4);
            });
        });

        describe("trailing separator commits token", () => {
            // The cache uses /[\s\p{P}]$/u to detect trailing
            // separators — both whitespace and punctuation commit.

            it("trailing punctuation commits — backward on 'play,' offers next part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play,",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Trailing comma is a separator — commits "play".
                // Should offer "song" same as forward.
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(5);
            });

            it("trailing period commits — backward on 'play.' offers next part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play.",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("song");
                expect(result!.matchedPrefixLength).toBe(5);
            });

            it("no trailing separator — backward on 'play' backs up", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                expect(flatCompletions(result!)).toContain("play");
                expect(result!.matchedPrefixLength).toBe(0);
            });

            it("mid-input trailing separator — backward on 'play song,' offers next part", () => {
                const c = Construction.create(
                    [
                        createMatchPart(["play"], "verb"),
                        createMatchPart(["song"], "noun"),
                        createMatchPart(["now"], "adv"),
                    ],
                    new Map(),
                );
                const cache = makeCache([c]);
                const result = cache.completion(
                    "play song,",
                    defaultOptions,
                    "backward",
                );
                expect(result).toBeDefined();
                // Trailing comma after second word commits "song".
                expect(flatCompletions(result!)).toContain("now");
                expect(result!.matchedPrefixLength).toBe(10);
            });
        });
    });

    describe("directionSensitive", () => {
        it("false for empty prefix", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("", defaultOptions);
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(false);
        });

        it("false for partial first word (no matched parts)", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("pla", defaultOptions, "forward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(false);
        });

        it("true for fully matched first word without trailing space", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play", defaultOptions, "forward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(true);
        });

        it("false when trailing space commits the word", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play ", defaultOptions, "forward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(false);
        });

        it("true for exact multi-part match without trailing space", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion(
                "play song",
                defaultOptions,
                "backward",
            );
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(true);
        });

        it("false for exact multi-part match with trailing space", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion(
                "play song ",
                defaultOptions,
                "backward",
            );
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(false);
        });

        it("both directions agree on sensitivity", () => {
            const c = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c]);
            const fwd = cache.completion(
                "play song",
                defaultOptions,
                "forward",
            );
            const bwd = cache.completion(
                "play song",
                defaultOptions,
                "backward",
            );
            expect(fwd).toBeDefined();
            expect(bwd).toBeDefined();
            expect(fwd!.directionSensitive).toBe(true);
            expect(bwd!.directionSensitive).toBe(true);
        });

        it("single-part construction is sensitive when fully matched", () => {
            const c = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const cache = makeCache([c]);
            const result = cache.completion("play", defaultOptions, "backward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(true);
        });

        it("multiple constructions: sensitive wins over non-sensitive at same prefix length", () => {
            // c1 has two parts — "play song" at position 4 is
            // direction-sensitive (has parts to back up to).
            const c1 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            // c2 is a single-part construction that only matches
            // at prefix length 0.  It won't compete at length 4.
            const c2 = Construction.create(
                [createMatchPart(["stop"], "verb")],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion("play", defaultOptions, "forward");
            expect(result).toBeDefined();
            // c1 matches at 4 > c2's 0 — c1 wins, which IS sensitive.
            expect(result!.directionSensitive).toBe(true);
        });

        it("multiple constructions at same prefix length: any sensitive makes result sensitive", () => {
            // Two constructions that both match "play" at prefix 4.
            // One continues to "song", the other to "video".
            // Both have matched parts → both flag directionSensitive.
            const c1 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const c2 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["video"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion("play", defaultOptions, "forward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(true);
        });

        it("longer match resets directionSensitive from shorter sensitive match", () => {
            // c1 matches "play" at 4 (sensitive) but c2 matches
            // "play song" at 9 (also sensitive).  When maxPrefixLength
            // advances from 4→9, directionSensitive is reset and
            // re-evaluated at the longer match.
            const c1 = Construction.create(
                [createMatchPart(["play"], "verb")],
                new Map(),
            );
            const c2 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                    createMatchPart(["now"], "adv"),
                ],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion(
                "play song",
                defaultOptions,
                "forward",
            );
            expect(result).toBeDefined();
            // c2 dominates at prefix length 9.
            expect(result!.directionSensitive).toBe(true);
            expect(flatCompletions(result!)).toContain("now");
        });

        it("not sensitive when trailing space commits across all constructions", () => {
            const c1 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["song"], "noun"),
                ],
                new Map(),
            );
            const c2 = Construction.create(
                [
                    createMatchPart(["play"], "verb"),
                    createMatchPart(["video"], "noun"),
                ],
                new Map(),
            );
            const cache = makeCache([c1, c2]);
            const result = cache.completion("play ", defaultOptions, "forward");
            expect(result).toBeDefined();
            expect(result!.directionSensitive).toBe(false);
        });
    });
});
