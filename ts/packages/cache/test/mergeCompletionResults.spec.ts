// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionResult,
    mergeCompletionResults,
} from "../src/constructions/constructionCache.js";

// Helpers for per-group CompletionResult access
function flatCompletions(result: CompletionResult): string[] {
    return result.groups.flatMap((g) => g.completions);
}

describe("mergeCompletionResults", () => {
    // Infinity as prefixLength disables the EOI-wildcard preference
    // logic (matchedLen >= Infinity is never true), letting tests
    // exercise merge behavior without EOI guard interference.
    describe("matchedPrefixLength merging", () => {
        it("returns undefined when both are undefined", () => {
            const result = mergeCompletionResults(
                undefined,
                undefined,
                Infinity,
            );
            expect(result).toBeUndefined();
        });

        it("returns first when second is undefined", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, undefined, Infinity);
            expect(result).toBe(first);
        });

        it("returns second when first is undefined", () => {
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 3,
            };
            const result = mergeCompletionResults(undefined, second, Infinity);
            expect(result).toBe(second);
        });

        it("discards shorter-prefix completions when second is longer", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 10,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBe(10);
            expect(flatCompletions(result)).toEqual(["b"]);
        });

        it("discards shorter-prefix completions when first is longer", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 12,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 3,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBe(12);
            expect(flatCompletions(result)).toEqual(["a"]);
        });

        it("merges completions when both have equal matchedPrefixLength", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBe(5);
            expect(flatCompletions(result)).toEqual(["a", "b"]);
        });

        it("returns undefined matchedPrefixLength when both are missing", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBeUndefined();
            expect(flatCompletions(result)).toEqual(["a", "b"]);
        });

        it("discards second when only first has matchedPrefixLength", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 7,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBe(7);
            expect(flatCompletions(result)).toEqual(["a"]);
        });

        it("discards first when only second has matchedPrefixLength", () => {
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 4,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.matchedPrefixLength).toBe(4);
            expect(flatCompletions(result)).toEqual(["b"]);
        });
    });

    describe("completions merging", () => {
        it("merges completions from both results", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a", "b"],
                        separatorMode: "space",
                    },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["c", "d"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(flatCompletions(result)).toEqual(["a", "b", "c", "d"]);
        });

        it("handles empty completions", () => {
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["c"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(flatCompletions(result)).toEqual(["c"]);
        });
    });

    describe("properties merging", () => {
        it("merges properties from both results", () => {
            const prop1 = {
                actions: [],
                names: ["name1"],
                separatorMode: "autoSpacePunctuation" as const,
            };
            const prop2 = {
                actions: [],
                names: ["name2"],
                separatorMode: "autoSpacePunctuation" as const,
            };
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
                properties: [prop1],
            };
            const second: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
                properties: [prop2],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.properties).toEqual([prop1, prop2]);
        });

        it("returns first.properties when second has none", () => {
            const prop1 = {
                actions: [],
                names: ["name1"],
                separatorMode: "autoSpacePunctuation" as const,
            };
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
                properties: [prop1],
            };
            const second: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.properties).toBe(first.properties);
        });

        it("returns second.properties when first has none", () => {
            const prop2 = {
                actions: [],
                names: ["name2"],
                separatorMode: "autoSpacePunctuation" as const,
            };
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
                properties: [prop2],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.properties).toBe(second.properties);
        });

        it("returns undefined properties when neither has them", () => {
            const first: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.properties).toBeUndefined();
        });
    });

    describe("per-group separatorMode preservation", () => {
        it("preserves per-group separatorMode when merging same-length results", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "spacePunctuation",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "optionalSpace",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            // Groups are concatenated, each preserving its own separatorMode.
            expect(result.groups.length).toBe(2);
            expect(result.groups[0].separatorMode).toBe("spacePunctuation");
            expect(result.groups[1].separatorMode).toBe("optionalSpace");
        });

        it("preserves separatorMode when first is undefined result", () => {
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "spacePunctuation",
                    },
                ],
            };
            const result = mergeCompletionResults(undefined, second, Infinity);
            expect(result).toBe(second);
            expect(result!.groups[0].separatorMode).toBe("spacePunctuation");
        });
    });

    describe("closedSet merging", () => {
        it("returns undefined when neither has closedSet", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.closedSet).toBeUndefined();
        });

        it("returns true only when both are true", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.closedSet).toBe(true);
        });

        it("returns false when first is true and second is false", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when first is false and second is true", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: false,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when both are false", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: false,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when only first has closedSet=true and second is undefined", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            // undefined treated as false → true && false = false
            expect(result.closedSet).toBe(false);
        });

        it("returns false when only second has closedSet=true and first is undefined", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            // undefined treated as false → false && true = false
            expect(result.closedSet).toBe(false);
        });

        it("preserves closedSet when first result is undefined", () => {
            const second: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                closedSet: true,
            };
            const result = mergeCompletionResults(undefined, second, Infinity);
            expect(result).toBe(second);
            expect(result!.closedSet).toBe(true);
        });

        it("preserves closedSet when second result is undefined", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, undefined, Infinity);
            expect(result).toBe(first);
            expect(result!.closedSet).toBe(false);
        });
    });

    describe("open wildcard at EOI — prefer anchored result", () => {
        it("keeps shorter anchored result when longer is afterWildcard at EOI", () => {
            const anchored: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["by"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 16,
                afterWildcard: "all",
            };
            const eoi: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["track", "song"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 17,
                afterWildcard: "all",
            };
            // prefixLength=17: eoi is at EOI, anchored is inside input
            const result = mergeCompletionResults(anchored, eoi, 17)!;
            expect(flatCompletions(result)).toEqual(["by"]);
            expect(result.matchedPrefixLength).toBe(16);
        });

        it("keeps shorter anchored result regardless of argument order", () => {
            const anchored: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["by"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 16,
                afterWildcard: "all",
            };
            const eoi: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["track", "song"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 17,
                afterWildcard: "all",
            };
            // Reversed argument order
            const result = mergeCompletionResults(eoi, anchored, 17)!;
            expect(flatCompletions(result)).toEqual(["by"]);
            expect(result.matchedPrefixLength).toBe(16);
        });

        it("still prefers longer when both are below EOI", () => {
            const shorter: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 5,
                afterWildcard: "all",
            };
            const longer: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["b"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 10,
                afterWildcard: "all",
            };
            const result = mergeCompletionResults(shorter, longer, 20)!;
            expect(flatCompletions(result)).toEqual(["b"]);
            expect(result.matchedPrefixLength).toBe(10);
        });

        it("still prefers longer when longer is at EOI but shorter has no completions", () => {
            const shorter: CompletionResult = {
                groups: [
                    { name: "test", completions: [], separatorMode: "space" },
                ],
                matchedPrefixLength: 0,
            };
            const eoi: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["track"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 17,
                afterWildcard: "all",
            };
            const result = mergeCompletionResults(shorter, eoi, 17)!;
            expect(flatCompletions(result)).toEqual(["track"]);
            expect(result.matchedPrefixLength).toBe(17);
        });

        it('still prefers longer when afterWildcard is "none"', () => {
            const anchored: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["by"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 16,
            };
            const eoi: CompletionResult = {
                groups: [
                    {
                        name: "test",
                        completions: ["track"],
                        separatorMode: "space",
                    },
                ],
                matchedPrefixLength: 17,
                afterWildcard: "none",
            };
            const result = mergeCompletionResults(anchored, eoi, 17)!;
            expect(flatCompletions(result)).toEqual(["track"]);
            expect(result.matchedPrefixLength).toBe(17);
        });
    });

    // ── Gap 7: cross-layer per-group separatorMode preservation ──────

    describe("per-group separatorMode preservation through merge", () => {
        it("preserves different separatorMode values across merged groups", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "grammar-keywords",
                        completions: ["play", "stop"],
                        separatorMode: "spacePunctuation",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "grammar-entities",
                        completions: ["rock", "jazz"],
                        separatorMode: "autoSpacePunctuation",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.groups).toHaveLength(2);
            const kw = result.groups.find((g) => g.name === "grammar-keywords");
            const ent = result.groups.find(
                (g) => g.name === "grammar-entities",
            );
            expect(kw).toBeDefined();
            expect(ent).toBeDefined();
            expect(kw!.separatorMode).toBe("spacePunctuation");
            expect(ent!.separatorMode).toBe("autoSpacePunctuation");
        });

        it("keeps optionalSpacePunctuation and none groups intact when merging", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "optional-group",
                        completions: ["タワー"],
                        separatorMode: "optionalSpacePunctuation",
                    },
                ],
                matchedPrefixLength: 3,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "none-group",
                        completions: ["suffix"],
                        separatorMode: "none",
                    },
                ],
                matchedPrefixLength: 3,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.groups).toHaveLength(2);
            expect(
                result.groups.find((g) => g.name === "optional-group")!
                    .separatorMode,
            ).toBe("optionalSpacePunctuation");
            expect(
                result.groups.find((g) => g.name === "none-group")!
                    .separatorMode,
            ).toBe("none");
        });

        it("discards shorter-prefix groups while preserving winner's per-group modes", () => {
            const shorter: CompletionResult = {
                groups: [
                    {
                        name: "short",
                        completions: ["a"],
                        separatorMode: "none",
                    },
                ],
                matchedPrefixLength: 3,
            };
            const longer: CompletionResult = {
                groups: [
                    {
                        name: "long-kw",
                        completions: ["b"],
                        separatorMode: "spacePunctuation",
                    },
                    {
                        name: "long-ent",
                        completions: ["c"],
                        separatorMode: "autoSpacePunctuation",
                    },
                ],
                matchedPrefixLength: 7,
            };
            const result = mergeCompletionResults(shorter, longer, Infinity)!;
            expect(result.matchedPrefixLength).toBe(7);
            expect(result.groups).toHaveLength(2);
            expect(
                result.groups.find((g) => g.name === "long-kw")!.separatorMode,
            ).toBe("spacePunctuation");
            expect(
                result.groups.find((g) => g.name === "long-ent")!.separatorMode,
            ).toBe("autoSpacePunctuation");
            // shorter group is discarded
            expect(
                result.groups.find((g) => g.name === "short"),
            ).toBeUndefined();
        });

        it("handles all six SeparatorMode values in a single merge", () => {
            const first: CompletionResult = {
                groups: [
                    {
                        name: "g-space",
                        completions: ["a"],
                        separatorMode: "space",
                    },
                    {
                        name: "g-spacePunct",
                        completions: ["b"],
                        separatorMode: "spacePunctuation",
                    },
                    {
                        name: "g-optSpace",
                        completions: ["c"],
                        separatorMode: "optionalSpace",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                groups: [
                    {
                        name: "g-optSpacePunct",
                        completions: ["d"],
                        separatorMode: "optionalSpacePunctuation",
                    },
                    {
                        name: "g-none",
                        completions: ["e"],
                        separatorMode: "none",
                    },
                    {
                        name: "g-auto",
                        completions: ["f"],
                        separatorMode: "autoSpacePunctuation",
                    },
                ],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, second, Infinity)!;
            expect(result.groups).toHaveLength(6);

            const modes = result.groups.map((g) => ({
                name: g.name,
                mode: g.separatorMode,
            }));
            expect(modes).toContainEqual({
                name: "g-space",
                mode: "space",
            });
            expect(modes).toContainEqual({
                name: "g-spacePunct",
                mode: "spacePunctuation",
            });
            expect(modes).toContainEqual({
                name: "g-optSpace",
                mode: "optionalSpace",
            });
            expect(modes).toContainEqual({
                name: "g-optSpacePunct",
                mode: "optionalSpacePunctuation",
            });
            expect(modes).toContainEqual({
                name: "g-none",
                mode: "none",
            });
            expect(modes).toContainEqual({
                name: "g-auto",
                mode: "autoSpacePunctuation",
            });
        });
    });
});
