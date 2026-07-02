// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    tokenize,
    tokenizeIdentifier,
    deCamelCase,
    isStopword,
    isGenericVerb,
} from "../src/context/contextSelector/tokenize.js";

describe("contextSelector/tokenize", () => {
    it("lowercases, NFKC-normalizes, and strips punctuation", () => {
        expect(tokenize("Spreadsheet, FORMULA!")).toEqual([
            "spreadsheet",
            "formula",
        ]);
    });

    it("drops stopwords and generic CRUD verbs", () => {
        // "add" (generic verb) and "the"/"to" (stopwords) are dropped.
        expect(tokenize("add the eggs to my grocery")).toEqual([
            "eggs",
            "grocery",
        ]);
        expect(isStopword("the")).toBe(true);
        expect(isGenericVerb("add")).toBe(true);
        expect(isGenericVerb("spreadsheet")).toBe(false);
    });

    it("keeps domain nouns that double as verbs (list, search)", () => {
        // "list" / "search" are app/topic words, not dropped as generic verbs.
        expect(isGenericVerb("list")).toBe(false);
        expect(isGenericVerb("search")).toBe(false);
        expect(tokenize("show my grocery list")).toEqual(["grocery", "list"]);
    });

    it("drops sub-minimum-length tokens", () => {
        expect(tokenize("a i x")).toEqual([]);
    });

    it("preserves protected product / language / ref patterns", () => {
        expect(tokenize("I love C# and C++ and .NET")).toEqual([
            "love",
            "c#",
            "c++",
            ".net",
        ]);
        expect(tokenize("select range A1:B2")).toEqual(["range", "a1:b2"]);
    });

    it("de-camelCases identifiers", () => {
        expect(deCamelCase("addItems")).toBe("add Items");
        expect(deCamelCase("HTMLParser")).toBe("HTML Parser");
        expect(deCamelCase("row_data")).toBe("row data");
        expect(deCamelCase("row-data")).toBe("row data");
    });

    it("tokenizeIdentifier de-camels then drops generic verbs", () => {
        expect(tokenizeIdentifier("addItems")).toEqual(["items"]);
        expect(tokenizeIdentifier("getUserProfile")).toEqual([
            "user",
            "profile",
        ]);
    });

    it("is deterministic and order-preserving", () => {
        const a = tokenize("spreadsheet formula spreadsheet");
        expect(a).toEqual(["spreadsheet", "formula", "spreadsheet"]);
        expect(tokenize("spreadsheet formula spreadsheet")).toEqual(a);
    });

    it("returns [] for empty input", () => {
        expect(tokenize("")).toEqual([]);
        expect(tokenize("   ")).toEqual([]);
    });
});
