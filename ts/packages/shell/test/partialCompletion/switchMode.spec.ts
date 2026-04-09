// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    makeDispatcher,
    makeCompletionResult,
    getPos,
    PartialCompletionSession,
} from "./helpers.js";
import type { SearchMenuPosition } from "./helpers.js";
import { SearchMenuBase } from "../../src/renderer/src/searchMenuBase.js";
import type {
    SearchMenuItem,
    SearchMenuUIUpdateData,
} from "../../src/preload/electronTypes.js";

// ── Mock SearchMenuUI ─────────────────────────────────────────────────────────

interface MockSearchMenuUI {
    update: jest.MockedFunction<(data: SearchMenuUIUpdateData) => void>;
    adjustSelection: jest.MockedFunction<(deltaY: number) => void>;
    selectCompletion: jest.MockedFunction<() => void>;
    close: jest.MockedFunction<() => void>;
}

function makeMockUI(): MockSearchMenuUI {
    return {
        update: jest.fn(),
        adjustSelection: jest.fn(),
        selectCompletion: jest.fn(),
        close: jest.fn(),
    };
}

// ── TestableSearchMenu ────────────────────────────────────────────────────────
// Extends SearchMenuBase and adds switchMode() logic identical to SearchMenu,
// but without importing DOM-dependent UI constructors.

class TestableSearchMenu extends SearchMenuBase {
    private searchMenuUI: MockSearchMenuUI | undefined;
    private lastPosition: SearchMenuPosition | undefined;
    private lastPrefix: string | undefined;
    private lastItems: SearchMenuItem[] | undefined;
    public uiFactory: () => MockSearchMenuUI = makeMockUI;
    public inline: boolean;

    constructor(inline: boolean = true) {
        super();
        this.inline = inline;
    }

    public getUI(): MockSearchMenuUI | undefined {
        return this.searchMenuUI;
    }

    public getLastState() {
        return {
            position: this.lastPosition,
            prefix: this.lastPrefix,
            items: this.lastItems,
        };
    }

    public switchMode(newInline: boolean): void {
        if (this.inline === newInline) {
            return;
        }
        const wasActive = this.isActive();
        if (this.searchMenuUI) {
            this.searchMenuUI.close();
            this.searchMenuUI = undefined;
        }
        this.inline = newInline;
        if (
            wasActive &&
            this.lastPosition &&
            this.lastPrefix !== undefined &&
            this.lastItems
        ) {
            this.searchMenuUI = this.uiFactory();
            this.searchMenuUI.update({
                position: this.lastPosition,
                prefix: this.lastPrefix,
                items: this.lastItems,
            });
        }
    }

    protected override onShow(
        position: SearchMenuPosition,
        prefix: string,
        items: SearchMenuItem[],
    ): void {
        this.lastPosition = position;
        this.lastPrefix = prefix;
        this.lastItems = items;
        if (this.searchMenuUI === undefined) {
            this.searchMenuUI = this.uiFactory();
        }
        this.searchMenuUI.update({ position, prefix, items });
    }

    protected override onUpdatePosition(position: SearchMenuPosition): void {
        this.lastPosition = position;
        this.searchMenuUI!.update({ position });
    }

    protected override onHide(): void {
        this.lastPosition = undefined;
        this.lastPrefix = undefined;
        this.lastItems = undefined;
        this.searchMenuUI!.close();
        this.searchMenuUI = undefined;
    }
}

// ── switchMode tests ──────────────────────────────────────────────────────────

describe("SearchMenu switchMode", () => {
    function setupActiveMenu(): TestableSearchMenu {
        const menu = new TestableSearchMenu(true);
        const items: SearchMenuItem[] = [
            { matchText: "alpha", selectedText: "alpha" },
            { matchText: "beta", selectedText: "beta" },
        ];
        menu.setChoices(items);
        menu.updatePrefix("a", { left: 10, bottom: 20 });
        return menu;
    }

    test("no-op when switching to the same mode", () => {
        const menu = setupActiveMenu();
        const ui = menu.getUI()!;
        menu.switchMode(true); // already inline=true
        // UI should not have been closed
        expect(ui.close).not.toHaveBeenCalled();
        expect(menu.getUI()).toBe(ui);
    });

    test("closes old UI and creates new UI when switching mode while active", () => {
        const menu = setupActiveMenu();
        const oldUI = menu.getUI()!;

        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;

        menu.switchMode(false);

        expect(oldUI.close).toHaveBeenCalledTimes(1);
        expect(menu.getUI()).toBe(newUI);
    });

    test("new UI receives the same items, prefix, and position", () => {
        const menu = setupActiveMenu();
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;

        menu.switchMode(false);

        expect(newUI.update).toHaveBeenCalledWith({
            position: { left: 10, bottom: 20 },
            prefix: "a",
            items: expect.arrayContaining([
                expect.objectContaining({ matchText: "alpha" }),
            ]),
        });
    });

    test("does not create UI when switching while inactive", () => {
        const menu = new TestableSearchMenu(true);
        // No choices set, not active
        const factory = jest.fn(makeMockUI);
        menu.uiFactory = factory;

        menu.switchMode(false);

        expect(factory).not.toHaveBeenCalled();
        expect(menu.getUI()).toBeUndefined();
    });

    test("does not create UI when menu was hidden before switchMode", () => {
        const menu = setupActiveMenu();
        menu.hide();
        expect(menu.isActive()).toBe(false);

        const factory = jest.fn(makeMockUI);
        menu.uiFactory = factory;

        menu.switchMode(false);

        expect(factory).not.toHaveBeenCalled();
    });

    test("switching mode flips the inline flag", () => {
        const menu = new TestableSearchMenu(true);
        expect(menu.inline).toBe(true);
        menu.switchMode(false);
        expect(menu.inline).toBe(false);
        menu.switchMode(true);
        expect(menu.inline).toBe(true);
    });

    test("menu stays active after switchMode", () => {
        const menu = setupActiveMenu();
        expect(menu.isActive()).toBe(true);

        menu.switchMode(false);

        // isActive() is tracked by SearchMenuBase — switchMode doesn't
        // call hide(), so active state is preserved.
        expect(menu.isActive()).toBe(true);
    });

    test("hide after switchMode closes the new UI", () => {
        const menu = setupActiveMenu();
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;

        menu.switchMode(false);
        menu.hide();

        expect(newUI.close).toHaveBeenCalled();
        expect(menu.getUI()).toBeUndefined();
    });

    test("onShow after switchMode uses the new mode's UI factory", () => {
        const menu = setupActiveMenu();
        menu.switchMode(false);

        // Now set new choices and update — should create a new UI
        const anotherUI = makeMockUI();
        menu.uiFactory = () => anotherUI;

        menu.hide(); // reset
        menu.setChoices([
            { matchText: "gamma", selectedText: "gamma" },
            { matchText: "delta", selectedText: "delta" },
        ]);
        menu.updatePrefix("g", { left: 50, bottom: 60 });

        expect(menu.getUI()).toBe(anotherUI);
        expect(anotherUI.update).toHaveBeenCalledWith(
            expect.objectContaining({ prefix: "g" }),
        );
    });
});

// ── onShow / onHide state tracking ────────────────────────────────────────────

describe("SearchMenu state tracking", () => {
    test("onShow stores position, prefix, and items", () => {
        const menu = new TestableSearchMenu(true);
        menu.setChoices([
            { matchText: "foo", selectedText: "foo" },
            { matchText: "foobar", selectedText: "foobar" },
        ]);
        menu.updatePrefix("foo", { left: 5, bottom: 15 });

        const state = menu.getLastState();
        expect(state.position).toEqual({ left: 5, bottom: 15 });
        expect(state.prefix).toBe("foo");
        expect(state.items).toHaveLength(2);
    });

    test("onHide clears stored state", () => {
        const menu = new TestableSearchMenu(true);
        menu.setChoices([
            { matchText: "abc", selectedText: "abc" },
            { matchText: "abd", selectedText: "abd" },
        ]);
        menu.updatePrefix("ab", { left: 1, bottom: 2 });
        expect(menu.getLastState().position).toBeDefined();

        menu.hide();

        const state = menu.getLastState();
        expect(state.position).toBeUndefined();
        expect(state.prefix).toBeUndefined();
        expect(state.items).toBeUndefined();
    });

    test("onUpdatePosition updates stored position", () => {
        const menu = new TestableSearchMenu(true);
        menu.setChoices([
            { matchText: "xyz", selectedText: "xyz" },
            { matchText: "xyw", selectedText: "xyw" },
        ]);
        menu.updatePrefix("xy", { left: 10, bottom: 20 });
        // Same prefix again triggers onUpdatePosition
        menu.updatePrefix("xy", { left: 30, bottom: 40 });

        expect(menu.getLastState().position).toEqual({ left: 30, bottom: 40 });
    });
});

// ── switchMode integration with PartialCompletionSession ──────────────────────

describe("switchMode integration with PartialCompletionSession", () => {
    test("session continues working after menu switchMode", async () => {
        const menu = new TestableSearchMenu(true);
        const result = makeCompletionResult(["song", "shuffle"], 5, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Trigger initial completion — "play " is anchor, "s" is prefix
        session.update("play s", getPos);
        await Promise.resolve();

        expect(menu.isActive()).toBe(true);

        // Switch mode — session state should be preserved
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;
        menu.switchMode(false);

        // Session is still active — new UI should have been created
        expect(menu.isActive()).toBe(true);
        expect(newUI.update).toHaveBeenCalled();
    });

    test("hide after switchMode resets properly for next update", async () => {
        const menu = new TestableSearchMenu(true);
        const result = makeCompletionResult(["alpha", "beta"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("a", getPos);
        await Promise.resolve();

        menu.switchMode(false);
        menu.hide();

        expect(menu.isActive()).toBe(false);
        expect(menu.getUI()).toBeUndefined();
    });
});
