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

        it("takes max of matchedPrefixLength when both are defined", () => {
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
            expect(result.completions).toEqual(["a", "b"]);
        });

        it("takes max of matchedPrefixLength (first is larger)", () => {
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

        it("uses the defined value when only first has matchedPrefixLength", () => {
            const first: CompletionResult = {
                completions: ["a"],
                matchedPrefixLength: 7,
            };
            const second: CompletionResult = {
                completions: ["b"],
            };
            const result = mergeCompletionResults(first, second)!;
            // max(7, 0) = 7
            expect(result.matchedPrefixLength).toBe(7);
        });

        it("uses the defined value when only second has matchedPrefixLength", () => {
            const first: CompletionResult = {
                completions: [],
            };
            const second: CompletionResult = {
                completions: ["b"],
                matchedPrefixLength: 4,
            };
            const result = mergeCompletionResults(first, second)!;
            // max(0, 4) = 4
            expect(result.matchedPrefixLength).toBe(4);
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
});
