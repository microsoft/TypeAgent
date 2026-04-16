// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { SearchMenuItem } from "../../src/helpers/completion/index.js";
import { HeadlessSearchMenu } from "../../src/helpers/completion/controller.js";
import { TSTSearchMenuDataProvider } from "../../src/helpers/completion/searchMenu.js";

// Minimal adapter using HeadlessSearchMenu to verify filtering behaviour.
function makeTestMenu() {
    let currentItems: SearchMenuItem[] = [];
    const dataProvider = new TSTSearchMenuDataProvider();
    const onUpdate = jest.fn(() => {
        // Snapshot active state at callback time.
        if (menu.isActive()) {
            currentItems = menu.getFilteredItems();
        } else {
            currentItems = [];
        }
    });
    const menu = new HeadlessSearchMenu(onUpdate, dataProvider);
    return {
        menu,
        dataProvider,
        onUpdate,
        getCurrentItems: () => currentItems,
    };
}

function makeItem(text: string): SearchMenuItem {
    return { matchText: text, selectedText: text };
}

describe("HeadlessSearchMenu", () => {
    it("getItems returns matching items after updatePrefix", () => {
        const { menu, dataProvider, onUpdate, getCurrentItems } =
            makeTestMenu();
        dataProvider.setChoices([
            makeItem("apple"),
            makeItem("apricot"),
            makeItem("banana"),
        ]);
        menu.invalidate();

        menu.updatePrefix("ap");

        expect(getCurrentItems().map((i) => i.selectedText)).toEqual([
            "apple",
            "apricot",
        ]);
        expect(menu.isActive()).toBe(true);
        expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it("getItems is empty after hide", () => {
        const { menu, dataProvider, onUpdate, getCurrentItems } =
            makeTestMenu();
        dataProvider.setChoices([makeItem("apple"), makeItem("banana")]);
        menu.invalidate();
        menu.updatePrefix("a");

        expect(getCurrentItems()).toHaveLength(1);

        menu.hide();

        expect(getCurrentItems()).toEqual([]);
        expect(menu.isActive()).toBe(false);
        // onUpdate called once for show, once for hide
        expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it("updatePrefix hides when no matches", () => {
        const { menu, dataProvider, getCurrentItems } = makeTestMenu();
        dataProvider.setChoices([makeItem("apple")]);
        menu.invalidate();
        menu.updatePrefix("a");
        expect(menu.isActive()).toBe(true);

        menu.updatePrefix("z");
        expect(menu.isActive()).toBe(false);
        expect(getCurrentItems()).toEqual([]);
    });

    it("updatePrefix hides on exact unique match", () => {
        const { menu, dataProvider } = makeTestMenu();
        dataProvider.setChoices([makeItem("done")]);
        menu.invalidate();

        // Exact match with no other prefix matches — uniquely satisfied
        const result = menu.updatePrefix("done");
        expect(result).toBe(true);
        expect(menu.isActive()).toBe(false);
    });
});
