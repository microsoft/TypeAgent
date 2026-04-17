// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { SearchMenuItem } from "../../src/helpers/completion/index.js";
import {
    TSTSearchMenuIndex,
    isUniquelySatisfied,
} from "../../src/helpers/completion/searchMenu.js";

function makeItem(text: string): SearchMenuItem {
    return { matchText: text, selectedText: text };
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
