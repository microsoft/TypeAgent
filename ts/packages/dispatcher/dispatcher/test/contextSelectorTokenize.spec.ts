// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    tokenize,
    tokenizeIdentifier,
    deCamelCase,
    stem,
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
        // "add" (generic verb) and "the"/"to" (stopwords) dropped; "eggs"->"egg".
        expect(tokenize("add the eggs to my grocery")).toEqual([
            "egg",
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
        expect(tokenizeIdentifier("addItems")).toEqual(["item"]); // items -> item
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

    it("stems plurals so conversation words match singular schema keywords", () => {
        // The exact gap that broke the vampire E2E: plural convo vs singular keyword.
        expect(tokenize("vampires and coffins")).toEqual(["vampire", "coffin"]);
        expect(stem("items")).toBe("item");
        expect(stem("cells")).toBe("cell");
        expect(stem("spreadsheets")).toBe("spreadsheet");
        expect(stem("movies")).toBe("movie"); // -ie singular, not "movy"
        expect(stem("boxes")).toBe("box");
        expect(stem("dishes")).toBe("dish");
        expect(stem("glasses")).toBe("glass");
    });

    it("stemmer avoids mangling non-plural -s endings and short tokens", () => {
        expect(stem("address")).toBe("address"); // ss guard
        expect(stem("status")).toBe("status"); // us guard
        expect(stem("analysis")).toBe("analysis"); // is guard
        expect(stem("gas")).toBe("gas"); // length floor
        expect(stem("bus")).toBe("bus"); // us guard
        expect(stem("c#")).toBe("c#"); // protected untouched
    });

    it("stems both sides consistently (idempotent on singulars)", () => {
        expect(stem(stem("vampires"))).toBe("vampire");
        expect(stem("vampire")).toBe("vampire");
    });
});
