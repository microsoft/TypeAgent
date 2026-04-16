// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    makeDispatcher,
    makeCompletionResult,
    createCompletionController,
} from "./helpers.js";
import {
    isUniquelySatisfied,
    TSTSearchMenuDataProvider,
    type SearchMenuDataProvider,
} from "agent-dispatcher/helpers/completion";
import type {
    SearchMenuItem,
    SearchMenuPosition,
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
// Mirrors the production SearchMenu class (see search.ts), replacing DOM UI
// constructors with a mock factory. Tests exercise the same state management
// and switchMode logic that runs in the real shell.

class TestableSearchMenu {
    private readonly dataProvider: SearchMenuDataProvider<SearchMenuItem>;
    private searchMenuUI: MockSearchMenuUI | undefined;
    private lastPosition: SearchMenuPosition | undefined;
    private lastPrefix: string | undefined;
    private lastItems: SearchMenuItem[] | undefined;
    private prefix: string | undefined;
    private _active: boolean = false;
    public uiFactory: () => MockSearchMenuUI = makeMockUI;
    public inline: boolean;
    private readonly getPosition: (
        prefix: string,
    ) => SearchMenuPosition | undefined;

    constructor(
        inline: boolean = true,
        dataProvider?: SearchMenuDataProvider<SearchMenuItem>,
        getPosition?: (prefix: string) => SearchMenuPosition | undefined,
    ) {
        this.dataProvider = dataProvider ?? new TSTSearchMenuDataProvider();
        this.inline = inline;
        this.getPosition = getPosition ?? (() => ({ left: 0, bottom: 0 }));
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

    // ── SearchMenu methods (mirrors production SearchMenu) ─────────────

    // Populate the internal trie for standalone tests (not needed when
    // using an external data provider like CompletionController).
    public setChoicesOnProvider(choices: SearchMenuItem[]): void {
        if ("setChoices" in this.dataProvider) {
            (
                this.dataProvider as { setChoices(c: SearchMenuItem[]): void }
            ).setChoices(choices);
        }
        this.invalidate();
    }

    public invalidate(): void {
        this.prefix = undefined;
    }

    public updatePrefix(prefix: string): boolean {
        if (this.dataProvider.numChoices() === 0) {
            return false;
        }

        const position = this.getPosition(prefix);
        if (position === undefined) {
            this.hide();
            return false;
        }

        if (this.prefix === prefix && this._active) {
            this.lastPosition = position;
            this.searchMenuUI!.update({ position });
            return false;
        }

        this.prefix = prefix;
        const items = this.dataProvider.filterItems(prefix);
        const uniquelySatisfied = isUniquelySatisfied(items, prefix);
        const showMenu = items.length !== 0 && !uniquelySatisfied;

        if (showMenu) {
            this._active = true;
            this.lastPosition = position;
            this.lastPrefix = prefix;
            this.lastItems = items;
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = this.uiFactory();
            }
            this.searchMenuUI.update({ position, prefix, items });
        } else {
            this.hide();
        }
        return uniquelySatisfied;
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
            this.lastPosition = undefined;
            this.lastPrefix = undefined;
            this.lastItems = undefined;
            this.searchMenuUI?.close();
            this.searchMenuUI = undefined;
        }
    }

    public isActive(): boolean {
        return this._active;
    }

    // ── switchMode (mirrors production SearchMenu.switchMode) ─────────────

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
}

// ── switchMode tests ──────────────────────────────────────────────────────────

const defaultPos: SearchMenuPosition = { left: 10, bottom: 20 };

describe("SearchMenu switchMode", () => {
    function setupActiveMenu(): TestableSearchMenu {
        const menu = new TestableSearchMenu(true, undefined, () => defaultPos);
        const items: SearchMenuItem[] = [
            { matchText: "alpha", selectedText: "alpha" },
            { matchText: "beta", selectedText: "beta" },
        ];
        menu.setChoicesOnProvider(items);
        menu.updatePrefix("a");
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
            position: defaultPos,
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

        // switchMode doesn't call hide(), so active state is preserved.
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
        menu.setChoicesOnProvider([
            { matchText: "gamma", selectedText: "gamma" },
            { matchText: "delta", selectedText: "delta" },
        ]);
        menu.updatePrefix("g");

        expect(menu.getUI()).toBe(anotherUI);
        expect(anotherUI.update).toHaveBeenCalledWith(
            expect.objectContaining({ prefix: "g" }),
        );
    });
});

// ── onShow / onHide state tracking ────────────────────────────────────────────

describe("SearchMenu state tracking", () => {
    test("onShow stores position, prefix, and items", () => {
        const pos = { left: 5, bottom: 15 };
        const menu = new TestableSearchMenu(true, undefined, () => pos);
        menu.setChoicesOnProvider([
            { matchText: "foo", selectedText: "foo" },
            { matchText: "foobar", selectedText: "foobar" },
        ]);
        menu.updatePrefix("foo");

        const state = menu.getLastState();
        expect(state.position).toEqual({ left: 5, bottom: 15 });
        expect(state.prefix).toBe("foo");
        expect(state.items).toHaveLength(2);
    });

    test("onHide clears stored state", () => {
        const pos = { left: 1, bottom: 2 };
        const menu = new TestableSearchMenu(true, undefined, () => pos);
        menu.setChoicesOnProvider([
            { matchText: "abc", selectedText: "abc" },
            { matchText: "abd", selectedText: "abd" },
        ]);
        menu.updatePrefix("ab");
        expect(menu.getLastState().position).toBeDefined();

        menu.hide();

        const state = menu.getLastState();
        expect(state.position).toBeUndefined();
        expect(state.prefix).toBeUndefined();
        expect(state.items).toBeUndefined();
    });

    test("onUpdatePosition updates stored position", () => {
        let pos: SearchMenuPosition = { left: 10, bottom: 20 };
        const menu = new TestableSearchMenu(true, undefined, () => pos);
        menu.setChoicesOnProvider([
            { matchText: "xyz", selectedText: "xyz" },
            { matchText: "xyw", selectedText: "xyw" },
        ]);
        menu.updatePrefix("xy");
        // Same prefix again triggers onUpdatePosition with new position
        pos = { left: 30, bottom: 40 };
        menu.invalidate(); // force re-query since prefix unchanged
        menu.updatePrefix("xy");

        expect(menu.getLastState().position).toEqual({ left: 30, bottom: 40 });
    });
});

// ── switchMode integration with CompletionController ──────────────────────────

describe("switchMode integration with CompletionController", () => {
    const anyPos = () => ({ left: 0, bottom: 0 });

    test("controller continues working after menu switchMode", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 5, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new TestableSearchMenu(true, controller, anyPos);
        let lastInput = "";
        controller.setOnUpdate(() => {
            const state = controller.getCompletionState();
            if (state) {
                menu.updatePrefix(state.prefix);
            } else {
                menu.hide();
            }
        });

        // Trigger initial completion — "play " is anchor, "s" is prefix
        lastInput = "play s";
        controller.update(lastInput, "forward");
        await Promise.resolve();

        expect(menu.isActive()).toBe(true);

        // Switch mode — controller state should be preserved
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;
        menu.switchMode(false);

        // Controller is still active — new UI should have been created
        expect(menu.isActive()).toBe(true);
        expect(newUI.update).toHaveBeenCalled();
    });

    test("hide after switchMode resets properly for next update", async () => {
        const result = makeCompletionResult(["alpha", "beta"], 0);
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new TestableSearchMenu(true, controller, anyPos);
        let lastInput = "";
        controller.setOnUpdate(() => {
            const state = controller.getCompletionState();
            if (state) {
                menu.updatePrefix(state.prefix);
            } else {
                menu.hide();
            }
        });

        lastInput = "a";
        controller.update(lastInput, "forward");
        await Promise.resolve();

        menu.switchMode(false);
        menu.hide();

        expect(menu.isActive()).toBe(false);
        expect(menu.getUI()).toBeUndefined();
    });
});
