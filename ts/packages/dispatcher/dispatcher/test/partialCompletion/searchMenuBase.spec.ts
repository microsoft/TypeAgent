// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { SearchMenuItem } from "../../src/helpers/completion/index.js";
import {
    TSTSearchMenuDataProvider,
    isUniquelySatisfied,
} from "../../src/helpers/completion/searchMenu.js";

function makeItem(text: string): SearchMenuItem {
    return { matchText: text, selectedText: text };
}

describe("TSTSearchMenuDataProvider filtering", () => {
    it("filterItems returns matching items", () => {
        const provider = new TSTSearchMenuDataProvider();
        provider.setChoices([
            makeItem("apple"),
            makeItem("apricot"),
            makeItem("banana"),
        ]);

        const items = provider.filterItems("ap");

        expect(items.map((i) => i.selectedText)).toEqual(["apple", "apricot"]);
    });

    it("filterItems returns empty for no matches", () => {
        const provider = new TSTSearchMenuDataProvider();
        provider.setChoices([makeItem("apple")]);

        expect(provider.filterItems("z")).toEqual([]);
    });

    it("isUniquelySatisfied returns true on exact unique match", () => {
        const provider = new TSTSearchMenuDataProvider();
        provider.setChoices([makeItem("done")]);

        const items = provider.filterItems("done");
        expect(isUniquelySatisfied(items, "done")).toBe(true);
    });

    it("isUniquelySatisfied returns false on prefix match", () => {
        const provider = new TSTSearchMenuDataProvider();
        provider.setChoices([makeItem("apple"), makeItem("apricot")]);

        const items = provider.filterItems("ap");
        expect(isUniquelySatisfied(items, "ap")).toBe(false);
    });

    it("numChoices reflects setChoices", () => {
        const provider = new TSTSearchMenuDataProvider();
        expect(provider.numChoices()).toBe(0);

        provider.setChoices([makeItem("app"), makeItem("apt")]);
        expect(provider.numChoices()).toBe(2);
    });
});
