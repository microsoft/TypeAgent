// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { SearchMenuItem } from "../../src/helpers/completion/index.js";
import {
    TSTSearchMenuIndex,
    isUniquelySatisfied,
} from "../../src/helpers/completion/searchMenu.js";

function makeItem(text: string, sortIndex?: number): SearchMenuItem {
    const item: SearchMenuItem = { matchText: text, selectedText: text };
    if (sortIndex !== undefined) item.sortIndex = sortIndex;
    return item;
}

describe("TSTSearchMenuIndex filtering", () => {
    it("filterItems returns matching items", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([
            makeItem("apple"),
            makeItem("apricot"),
            makeItem("banana"),
        ]);

        const items = index.filterItems("ap");

        expect(items.map((i: SearchMenuItem) => i.selectedText)).toEqual([
            "apple",
            "apricot",
        ]);
    });

    it("filterItems returns empty for no matches", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("apple")]);

        expect(index.filterItems("z")).toEqual([]);
    });

    it("isUniquelySatisfied returns true on exact unique match", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("done")]);

        const items = index.filterItems("done");
        expect(isUniquelySatisfied(items, "done")).toBe(true);
    });

    it("isUniquelySatisfied returns false on prefix match", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("apple"), makeItem("apricot")]);

        const items = index.filterItems("ap");
        expect(isUniquelySatisfied(items, "ap")).toBe(false);
    });

    it("numItems reflects setItems", () => {
        const index = new TSTSearchMenuIndex();
        expect(index.numItems()).toBe(0);

        index.setItems([makeItem("app"), makeItem("apt")]);
        expect(index.numItems()).toBe(2);
    });
});

describe("TSTSearchMenuIndex — empty prefix", () => {
    it("filterItems with empty prefix returns all items", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("alpha"), makeItem("beta")]);

        const items = index.filterItems("");
        expect(items.map((i) => i.selectedText).sort()).toEqual([
            "alpha",
            "beta",
        ]);
    });

    it("filterItems with empty prefix on empty index returns []", () => {
        const index = new TSTSearchMenuIndex();
        expect(index.filterItems("")).toEqual([]);
    });
});

describe("TSTSearchMenuIndex — case insensitivity", () => {
    it("filterItems is case-insensitive", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("Hello"), makeItem("help")]);

        expect(
            index
                .filterItems("HE")
                .map((i) => i.selectedText)
                .sort(),
        ).toEqual(["Hello", "help"]);
        expect(
            index
                .filterItems("he")
                .map((i) => i.selectedText)
                .sort(),
        ).toEqual(["Hello", "help"]);
    });

    it("hasExactMatch is case-insensitive", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("Hello")]);

        expect(index.hasExactMatch("hello")).toBe(true);
        expect(index.hasExactMatch("HELLO")).toBe(true);
        expect(index.hasExactMatch("Hello")).toBe(true);
    });
});

describe("TSTSearchMenuIndex — diacritical normalization", () => {
    it("filterItems matches through diacritical marks", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("café"), makeItem("cache")]);

        // "cafe" (without accent) should match "café"
        const items = index.filterItems("cafe");
        expect(items.map((i) => i.selectedText)).toContain("café");
    });

    it("hasExactMatch normalizes diacriticals", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("résumé")]);

        expect(index.hasExactMatch("resume")).toBe(true);
        expect(index.hasExactMatch("résumé")).toBe(true);
    });
});

describe("TSTSearchMenuIndex — duplicate handling", () => {
    it("deduplicates items with the same normalized matchText, keeping first", () => {
        const index = new TSTSearchMenuIndex();
        const item1 = makeItem("Play", 0);
        const item2 = makeItem("play", 1);
        index.setItems([item1, item2]);

        // Only one entry after normalization — the first one wins
        const items = index.filterItems("play");
        expect(items).toHaveLength(1);
        expect(items[0].selectedText).toBe("Play");
    });

    it("filters correctly after setItems with mixed duplicates", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([
            makeItem("abc"),
            makeItem("ABC"), // duplicate after normalization
            makeItem("def"),
            makeItem("ghi"),
        ]);

        // filterItems("") returns all unique items
        const all = index.filterItems("");
        expect(all).toHaveLength(3);
        expect(all.map((i) => i.selectedText).sort()).toEqual([
            "abc",
            "def",
            "ghi",
        ]);
    });
});

describe("TSTSearchMenuIndex — setItems replacement", () => {
    it("setItems replaces previous items completely", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("old1"), makeItem("old2")]);
        expect(index.numItems()).toBe(2);

        index.setItems([makeItem("new1")]);
        expect(index.numItems()).toBe(1);
        expect(index.filterItems("old")).toEqual([]);
        expect(index.filterItems("new").map((i) => i.selectedText)).toEqual([
            "new1",
        ]);
    });

    it("setItems with empty array clears the index", () => {
        const index = new TSTSearchMenuIndex();
        index.setItems([makeItem("alpha"), makeItem("beta")]);
        expect(index.filterItems("")).toHaveLength(2);

        index.setItems([]);
        expect(index.filterItems("")).toEqual([]);
    });
});

describe("isUniquelySatisfied — edge cases", () => {
    it("returns false for empty items", () => {
        expect(isUniquelySatisfied([], "test")).toBe(false);
    });

    it("returns false when single item does not match prefix", () => {
        expect(isUniquelySatisfied([makeItem("apple")], "banana")).toBe(false);
    });

    it("is case-insensitive", () => {
        expect(isUniquelySatisfied([makeItem("Hello")], "hello")).toBe(true);
        expect(isUniquelySatisfied([makeItem("hello")], "HELLO")).toBe(true);
    });

    it("returns false for multiple items even if one matches", () => {
        expect(
            isUniquelySatisfied(
                [makeItem("apple"), makeItem("apricot")],
                "apple",
            ),
        ).toBe(false);
    });
});
