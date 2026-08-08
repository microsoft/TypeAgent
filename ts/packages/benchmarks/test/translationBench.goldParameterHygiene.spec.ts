// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    isEmptyGoldPlaceholder,
    stripEmptyGoldPlaceholders,
} from "../src/translationBench/synthesizer/goldParameterHygiene.js";

describe("gold parameter hygiene", () => {
    it("detects empty placeholders without treating false/0 as empty", () => {
        expect(isEmptyGoldPlaceholder("")).toBe(true);
        expect(isEmptyGoldPlaceholder("   ")).toBe(true);
        expect(isEmptyGoldPlaceholder([])).toBe(true);
        expect(isEmptyGoldPlaceholder({})).toBe(true);
        expect(isEmptyGoldPlaceholder(null)).toBe(true);
        expect(isEmptyGoldPlaceholder(undefined)).toBe(true);
        expect(isEmptyGoldPlaceholder(false)).toBe(false);
        expect(isEmptyGoldPlaceholder(0)).toBe(false);
        expect(isEmptyGoldPlaceholder("x")).toBe(false);
        expect(isEmptyGoldPlaceholder(["a"])).toBe(false);
        expect(isEmptyGoldPlaceholder({ a: 1 })).toBe(false);
    });

    it("strips empty placeholders and keeps real values", () => {
        const stripped = stripEmptyGoldPlaceholders({
            repo: "microsoft/TypeScript",
            token: "",
            attachFiles: [],
            extra: {},
            unstar: false,
            count: 0,
        });
        expect(stripped.removed.sort()).toEqual([
            "attachFiles",
            "extra",
            "token",
        ]);
        expect(stripped.parameters).toEqual({
            repo: "microsoft/TypeScript",
            unstar: false,
            count: 0,
        });
        const onlyEmpty = stripEmptyGoldPlaceholders({ token: "", files: [] });
        expect(onlyEmpty.removed.sort()).toEqual(["files", "token"]);
        expect(onlyEmpty.parameters).toBeUndefined();
        const untouched = stripEmptyGoldPlaceholders({ listName: "groceries" });
        expect(untouched.removed).toEqual([]);
        expect(untouched.parameters).toEqual({ listName: "groceries" });
    });

    it("strips nested empty placeholders and empty arrays of empties", () => {
        const stripped = stripEmptyGoldPlaceholders({
            repo: "microsoft/TypeScript",
            nested: { token: "", meta: {} },
            tags: ["", "keep", []],
            deep: [{ a: "" }, { b: "ok" }],
        });
        expect(stripped.parameters).toEqual({
            repo: "microsoft/TypeScript",
            tags: ["keep"],
            deep: [{ b: "ok" }],
        });
        expect(stripped.removed).toEqual(
            expect.arrayContaining([
                "nested.token",
                "nested.meta",
                "nested",
                "tags[0]",
                "tags[2]",
                "deep[0].a",
                "deep[0]",
            ]),
        );
    });
});
