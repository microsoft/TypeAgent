// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import {
    SearchMenuBase,
    SearchMenuItem,
    SearchMenuPosition,
} from "../../src/helpers/completion/index.js";

// Minimal adapter mirroring CliSearchMenu to verify SearchMenuBase behaviour.
class TestAdapter extends SearchMenuBase {
    public currentItems: SearchMenuItem[] = [];
    public readonly onUpdate: jest.Mock;

    constructor() {
        super();
        this.onUpdate = jest.fn();
    }

    protected override onShow(
        _position: SearchMenuPosition,
        _prefix: string,
        items: SearchMenuItem[],
    ): void {
        this.currentItems = items;
        this.onUpdate();
    }

    protected override onHide(): void {
        this.currentItems = [];
        this.onUpdate();
    }
}

const pos: SearchMenuPosition = { left: 0, bottom: 0 };

function makeItem(text: string): SearchMenuItem {
    return { matchText: text, selectedText: text };
}

describe("SearchMenuBase adapter", () => {
    it("getItems returns matching items after updatePrefix", () => {
        const menu = new TestAdapter();
        menu.setChoices([
            makeItem("apple"),
            makeItem("apricot"),
            makeItem("banana"),
        ]);

        menu.updatePrefix("ap", pos);

        expect(menu.currentItems.map((i) => i.selectedText)).toEqual([
            "apple",
            "apricot",
        ]);
        expect(menu.isActive()).toBe(true);
        expect(menu.onUpdate).toHaveBeenCalledTimes(1);
    });

    it("getItems is empty after hide", () => {
        const menu = new TestAdapter();
        menu.setChoices([makeItem("apple"), makeItem("banana")]);
        menu.updatePrefix("a", pos);

        expect(menu.currentItems).toHaveLength(1);

        menu.hide();

        expect(menu.currentItems).toEqual([]);
        expect(menu.isActive()).toBe(false);
        // onUpdate called once for show, once for hide
        expect(menu.onUpdate).toHaveBeenCalledTimes(2);
    });

    it("updatePrefix hides when no matches", () => {
        const menu = new TestAdapter();
        menu.setChoices([makeItem("apple")]);
        menu.updatePrefix("a", pos);
        expect(menu.isActive()).toBe(true);

        menu.updatePrefix("z", pos);
        expect(menu.isActive()).toBe(false);
        expect(menu.currentItems).toEqual([]);
    });

    it("updatePrefix hides on exact unique match", () => {
        const menu = new TestAdapter();
        menu.setChoices([makeItem("done")]);

        // Exact match with no other prefix matches — uniquely satisfied
        const result = menu.updatePrefix("done", pos);
        expect(result).toBe(true);
        expect(menu.isActive()).toBe(false);
    });
});
