// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionResult,
    mergeCompletionResults,
} from "../src/constructions/constructionCache.js";

describe("mergeCompletionResults", () => {
    describe("matchedPrefixLength merging", () => {
        it("returns undefined when both are undefined", () => {
            const result = mergeCompletionResults(undefined, undefined);
            expect(result).toBeUndefined();
        });

        it("returns first when second is undefined", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, undefined);
            expect(result).toBe(first);
        });

        it("returns second when first is undefined", () => {
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 3,
            };
            const result = mergeCompletionResults(undefined, second);
            expect(result).toBe(second);
        });

        it("discards shorter-prefix completions when second is longer", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 10,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBe(10);
            expect(result.completions).toEqual(["b"]);
        });

        it("discards shorter-prefix completions when first is longer", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 12,
            };
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 3,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBe(12);
            expect(result.completions).toEqual(["a"]);
        });

        it("merges completions when both have equal matchedPrefixLength", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 5,
            };
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 5,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBe(5);
            expect(result.completions).toEqual(["a", "b"]);
        });

        it("returns undefined matchedPrefixLength when both are missing", () => {
            const first: CompletionResult = {
                completions: ["a"],
            };
            const second: CompletionResult = {
                completions: ["b"],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBeUndefined();
            expect(result.completions).toEqual(["a", "b"]);
        });

        it("discards second when only first has matchedPrefixLength", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 7,
            };
            const second: CompletionResult = {
                completions: ["b"],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBe(7);
            expect(result.completions).toEqual(["a"]);
        });

        it("discards first when only second has matchedPrefixLength", () => {
            const first: CompletionResult = {
                completions: [],
            };
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 4,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.matchedPrefixLength).toBe(4);
            expect(result.completions).toEqual(["b"]);
        });
    });

    describe("completions merging", () => {
        it("merges completions from both results", () => {
            const first: CompletionResult = {
                completions: ["a", "b"],
            };
            const second: CompletionResult = {
                completions: ["c", "d"],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.completions).toEqual(["a", "b", "c", "d"]);
        });

        it("handles empty completions", () => {
            const first: CompletionResult = {
                completions: [],
            };
            const second: CompletionResult = {
                completions: ["c"],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.completions).toEqual(["c"]);
        });
    });

    describe("properties merging", () => {
        it("merges properties from both results", () => {
            const prop1 = {
                actions: [],
                names: ["name1"],
            };
            const prop2 = {
                actions: [],
                names: ["name2"],
            };
            const first: CompletionResult = {
                completions: [],
                properties: [prop1],
            };
            const second: CompletionResult = {
                completions: [],
                properties: [prop2],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.properties).toEqual([prop1, prop2]);
        });

        it("returns first.properties when second has none", () => {
            const prop1 = {
                actions: [],
                names: ["name1"],
            };
            const first: CompletionResult = {
                completions: [],
                properties: [prop1],
            };
            const second: CompletionResult = {
                completions: [],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.properties).toBe(first.properties);
        });

        it("returns second.properties when first has none", () => {
            const prop2 = {
                actions: [],
                names: ["name2"],
            };
            const first: CompletionResult = {
                completions: [],
            };
            const second: CompletionResult = {
                completions: [],
                properties: [prop2],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.properties).toBe(second.properties);
        });

        it("returns undefined properties when neither has them", () => {
            const first: CompletionResult = {
                completions: [],
            };
            const second: CompletionResult = {
                completions: [],
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.properties).toBeUndefined();
        });
    });

    describe("separatorMode merging", () => {
        it("returns undefined when neither has separatorMode", () => {
            const first: CompletionResult = { completions: ["a"] };
            const second: CompletionResult = { completions: ["b"] };
            const result = mergeCompletionResults(first, second)!;
            expect(result.separatorMode).toBeUndefined();
        });

        it("returns first separatorMode when second is undefined", () => {
            const first: CompletionResult = {
                completions: ["a"],
                separatorMode: "spacePunctuation",
            };
            const second: CompletionResult = { completions: ["b"] };
            const result = mergeCompletionResults(first, second)!;
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("returns second separatorMode when first is undefined", () => {
            const first: CompletionResult = { completions: ["a"] };
            const second: CompletionResult = {
                completions: ["b"],
                separatorMode: "spacePunctuation",
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("returns most restrictive when both have separatorMode", () => {
            const first: CompletionResult = {
                completions: ["a"],
                separatorMode: "spacePunctuation",
            };
            const second: CompletionResult = {
                completions: ["b"],
                separatorMode: "optional",
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.separatorMode).toBe("spacePunctuation");
        });

        it("preserves separatorMode when first is undefined result", () => {
            const second: CompletionResult = {
                completions: ["b"],
                separatorMode: "spacePunctuation",
            };
            const result = mergeCompletionResults(undefined, second);
            expect(result).toBe(second);
            expect(result!.separatorMode).toBe("spacePunctuation");
        });
    });

    describe("closedSet merging", () => {
        it("returns undefined when neither has closedSet", () => {
            const first: CompletionResult = { completions: ["a"] };
            const second: CompletionResult = { completions: ["b"] };
            const result = mergeCompletionResults(first, second)!;
            expect(result.closedSet).toBeUndefined();
        });

        it("returns true only when both are true", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: true,
            };
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.closedSet).toBe(true);
        });

        it("returns false when first is true and second is false", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: true,
            };
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when first is false and second is true", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: false,
            };
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when both are false", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: false,
            };
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, second)!;
            expect(result.closedSet).toBe(false);
        });

        it("returns false when only first has closedSet=true and second is undefined", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: true,
            };
            const second: CompletionResult = {
                completions: ["b"],
            };
            const result = mergeCompletionResults(first, second)!;
            // undefined treated as false → true && false = false
            expect(result.closedSet).toBe(false);
        });

        it("returns false when only second has closedSet=true and first is undefined", () => {
            const first: CompletionResult = {
                completions: ["a"],
            };
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: true,
            };
            const result = mergeCompletionResults(first, second)!;
            // undefined treated as false → false && true = false
            expect(result.closedSet).toBe(false);
        });

        it("preserves closedSet when first result is undefined", () => {
            const second: CompletionResult = {
                completions: ["b"],
                closedSet: true,
            };
            const result = mergeCompletionResults(undefined, second);
            expect(result).toBe(second);
            expect(result!.closedSet).toBe(true);
        });

        it("preserves closedSet when second result is undefined", () => {
            const first: CompletionResult = {
                completions: ["a"],
                closedSet: false,
            };
            const result = mergeCompletionResults(first, undefined);
            expect(result).toBe(first);
            expect(result!.closedSet).toBe(false);
        });
    });
});
