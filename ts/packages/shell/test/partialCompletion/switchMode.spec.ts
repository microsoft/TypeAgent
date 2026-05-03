// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    makeDispatcher,
    makeCompletionResult,
    createCompletionController,
} from "./helpers.js";
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
    private searchMenuUI: MockSearchMenuUI | undefined;
    private _active: boolean = false;
    public uiFactory: () => MockSearchMenuUI = makeMockUI;
    public inline: boolean;
    private readonly getPosition: (
        prefix: string,
    ) => SearchMenuPosition | undefined;

    constructor(
        inline: boolean = true,
        getPosition?: (prefix: string) => SearchMenuPosition | undefined,
    ) {
        this.inline = inline;
        this.getPosition = getPosition ?? (() => ({ left: 0, bottom: 0 }));
    }

    public getUI(): MockSearchMenuUI | undefined {
        return this.searchMenuUI;
    }

    // ── SearchMenu methods (mirrors production SearchMenu) ─────────────

    public updatePosition(prefix: string): void {
        if (!this._active || this.searchMenuUI === undefined) {
            return;
        }
        const position = this.getPosition(prefix);
        if (position === undefined) {
            this.hide();
            return;
        }
        this.searchMenuUI.update({ position });
    }

    // Mirrors production SearchMenu.render() — always performs a full
    // item update.  The caller decides render() vs updatePosition().
    public render(prefix: string, items: SearchMenuItem[]): void {
        const position = this.getPosition(prefix);
        if (position === undefined) {
            this.hide();
            return;
        }

        if (items.length > 0) {
            this._active = true;
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = this.uiFactory();
            }
            this.searchMenuUI.update({ position, prefix, items });
        } else {
            this.hide();
        }
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
            this.searchMenuUI?.close();
            this.searchMenuUI = undefined;
        }
    }

    public isActive(): boolean {
        return this._active;
    }

    // ── switchMode (mirrors production SearchMenu.switchMode) ─────────────

    public switchMode(newInline: boolean): boolean {
        if (this.inline === newInline) {
            return false;
        }
        if (this.searchMenuUI) {
            this.searchMenuUI.close();
            this.searchMenuUI = undefined;
        }
        this.inline = newInline;
        return true;
    }
}

// ── switchMode tests ──────────────────────────────────────────────────────────

const defaultPos: SearchMenuPosition = { left: 10, bottom: 20 };

describe("SearchMenu switchMode", () => {
    const items: SearchMenuItem[] = [
        { matchText: "alpha", selectedText: "alpha" },
        { matchText: "beta", selectedText: "beta" },
    ];

    function setupActiveMenu(): TestableSearchMenu {
        const menu = new TestableSearchMenu(true, () => defaultPos);
        menu.render("a", items);
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

    test("closes old UI on switchMode", () => {
        const menu = setupActiveMenu();
        const oldUI = menu.getUI()!;

        menu.switchMode(false);

        expect(oldUI.close).toHaveBeenCalledTimes(1);
        // switchMode no longer creates the new UI — caller re-renders.
        expect(menu.getUI()).toBeUndefined();
    });

    test("caller re-render after switchMode creates new UI with same data", () => {
        const menu = setupActiveMenu();
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;

        menu.switchMode(false);
        // Caller re-renders (mirrors partial.ts behavior).
        menu.render("a", items);

        expect(menu.getUI()).toBe(newUI);
        expect(newUI.update).toHaveBeenCalledWith(
            expect.objectContaining({
                position: defaultPos,
                prefix: "a",
                items: expect.arrayContaining([
                    expect.objectContaining({ matchText: "alpha" }),
                ]),
            }),
        );
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

    test("hide after switchMode+re-render closes the new UI", () => {
        const menu = setupActiveMenu();
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;

        menu.switchMode(false);
        menu.render("a", items); // caller re-renders
        menu.hide();

        expect(newUI.close).toHaveBeenCalled();
        expect(menu.getUI()).toBeUndefined();
    });

    test("render after switchMode uses the new mode's UI factory", () => {
        const menu = setupActiveMenu();
        menu.switchMode(false);
        menu.hide(); // reset

        const anotherUI = makeMockUI();
        menu.uiFactory = () => anotherUI;

        const newItems: SearchMenuItem[] = [
            { matchText: "gamma", selectedText: "gamma" },
            { matchText: "delta", selectedText: "delta" },
        ];
        menu.render("g", newItems);

        expect(menu.getUI()).toBe(anotherUI);
        expect(anotherUI.update).toHaveBeenCalledWith(
            expect.objectContaining({ prefix: "g" }),
        );
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
        const menu = new TestableSearchMenu(true, anyPos);
        controller.setOnUpdate(() => {
            const state = controller.getCompletionState();
            if (state) {
                menu.render(state.prefix, state.items);
            } else {
                menu.hide();
            }
        });

        // Trigger initial completion — "play " is anchor, "s" is prefix
        controller.update("play s", "forward");
        await Promise.resolve();

        expect(menu.isActive()).toBe(true);

        // Switch mode — caller re-renders (mirrors partial.ts behavior)
        const newUI = makeMockUI();
        menu.uiFactory = () => newUI;
        menu.switchMode(false);
        const state = controller.getCompletionState();
        if (state) {
            menu.render(state.prefix, state.items);
        }

        // New UI should have been created with same data
        expect(menu.isActive()).toBe(true);
        expect(newUI.update).toHaveBeenCalled();
    });

    test("hide after switchMode resets properly for next update", async () => {
        const result = makeCompletionResult(["alpha", "beta"], 0);
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new TestableSearchMenu(true, anyPos);
        controller.setOnUpdate(() => {
            const state = controller.getCompletionState();
            if (state) {
                menu.render(state.prefix, state.items);
            } else {
                menu.hide();
            }
        });

        controller.update("a", "forward");
        await Promise.resolve();

        menu.switchMode(false);
        menu.hide();

        expect(menu.isActive()).toBe(false);
        expect(menu.getUI()).toBeUndefined();
    });
});
