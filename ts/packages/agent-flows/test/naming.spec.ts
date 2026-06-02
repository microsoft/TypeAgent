// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    tokenizeForTriggerPhrase,
    slugifyFlowName,
    resolveUniqueActionName,
} from "../src/index.js";

describe("naming", () => {
    describe("tokenizeForTriggerPhrase", () => {
        test("splits camelCase into lowercase tokens", () => {
            expect(tokenizeForTriggerPhrase("boldTest")).toEqual([
                "bold",
                "test",
            ]);
        });

        test("splits on non-alphanumeric runs", () => {
            expect(tokenizeForTriggerPhrase("My Favorite Chart")).toEqual([
                "my",
                "favorite",
                "chart",
            ]);
        });

        test("splits ALLCAPS + leading word boundary correctly", () => {
            expect(tokenizeForTriggerPhrase("HTMLParser")).toEqual([
                "html",
                "parser",
            ]);
        });

        test("strips diacritics", () => {
            expect(tokenizeForTriggerPhrase("naïve")).toEqual(["naive"]);
        });

        test("symbol-only input yields empty array", () => {
            expect(tokenizeForTriggerPhrase("___")).toEqual([]);
        });
    });

    describe("slugifyFlowName", () => {
        test("camelCases a display name", () => {
            expect(slugifyFlowName("Bold Test Box")).toBe("boldTestBox");
        });

        test("falls back to unnamedFlow on symbolic-only input", () => {
            expect(slugifyFlowName("___")).toBe("unnamedFlow");
            expect(slugifyFlowName("")).toBe("unnamedFlow");
        });

        test("prefixes 'flow' when first token begins with a digit", () => {
            expect(slugifyFlowName("1st chart")).toMatch(/^flow/);
        });

        test("truncates absurdly long names", () => {
            const long = "a".repeat(200);
            const slug = slugifyFlowName(long);
            expect(slug.length).toBeLessThanOrEqual(60);
        });
    });

    describe("resolveUniqueActionName", () => {
        test("returns desired when no conflict and not reserved", () => {
            expect(resolveUniqueActionName("foo", new Set())).toBe("foo");
        });

        test("appends 'Flow' when the desired name is reserved", () => {
            expect(
                resolveUniqueActionName("list", new Set(), (n) => n === "list"),
            ).toBe("listFlow");
        });

        test("appends numeric suffix on collision, starting at 2", () => {
            expect(resolveUniqueActionName("foo", new Set(["foo"]))).toBe(
                "foo2",
            );
            expect(
                resolveUniqueActionName("foo", new Set(["foo", "foo2"])),
            ).toBe("foo3");
        });

        test("suffix is appended AFTER the Flow suffix, not before", () => {
            expect(
                resolveUniqueActionName(
                    "list",
                    new Set(["listFlow"]),
                    (n) => n === "list",
                ),
            ).toBe("listFlow2");
        });

        test("skips numeric suffixes that are themselves reserved", () => {
            const reserved = new Set(["foo2"]);
            expect(
                resolveUniqueActionName("foo", new Set(["foo"]), (n) =>
                    reserved.has(n),
                ),
            ).toBe("foo3");
        });
    });
});
