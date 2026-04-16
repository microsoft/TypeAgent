// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompletionDirection } from "@typeagent/agent-sdk";
import { SearchMenuItem, isUniquelySatisfied } from "./searchMenu.js";
import { type SearchMenuDataProvider } from "./searchMenu.js";
import {
    ISearchMenuControl,
    ICompletionDispatcher,
    PartialCompletionSession,
    CompletionState,
} from "./session.js";

export type { CompletionState };

export type CompletionControllerOptions = {
    /** Called whenever the completion list changes (items shown or hidden).
     *  Used by the CLI to trigger re-render when completions arrive async. */
    onUpdate?: () => void;
};

/**
 * Headless ISearchMenuControl — no UI, no trie.
 * Fires an onUpdate callback whenever the menu shows or hides.
 * Used as the internal menu control for the CLI path.
 */
export class HeadlessSearchMenu implements ISearchMenuControl {
    public onUpdate: () => void;
    private dataProvider: SearchMenuDataProvider<SearchMenuItem>;
    private prefix: string | undefined;
    private _active: boolean = false;
    private _filteredItems: SearchMenuItem[] = [];

    constructor(
        onUpdate: () => void,
        dataProvider: SearchMenuDataProvider<SearchMenuItem>,
    ) {
        this.onUpdate = onUpdate;
        this.dataProvider = dataProvider;
    }

    public invalidate(): void {
        this.prefix = undefined;
        this._filteredItems = [];
    }

    public updatePrefix(prefix: string): boolean {
        if (this.dataProvider.numChoices() === 0) {
            return false;
        }

        if (this.prefix === prefix && this._active) {
            return false;
        }

        this.prefix = prefix;
        const items = this.dataProvider.filterItems(prefix);
        const uniquelySatisfied = isUniquelySatisfied(items, prefix);
        const showMenu = items.length !== 0 && !uniquelySatisfied;

        if (showMenu) {
            const wasActive = this._active;
            this._active = true;
            this._filteredItems = items;
            if (!wasActive) {
                this.onUpdate();
            }
        } else {
            this.hide();
        }
        return uniquelySatisfied;
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
            this._filteredItems = [];
            this.onUpdate();
        }
    }

    public isActive(): boolean {
        return this._active;
    }

    public getFilteredItems(): SearchMenuItem[] {
        return this._filteredItems;
    }
}

/**
 * High-level completion controller wrapping PartialCompletionSession.
 *
 * Implements SearchMenuDataProvider so consumers can pass the controller
 * directly to their SearchMenu as the data source.
 *
 * API surface:
 *   - update()  — called on each keystroke
 *   - accept()  — called on Tab/Enter
 *   - dismiss() — called on Escape
 *   - hide()    — called when cursor leaves valid position
 *   - getCompletionState() — returns current completions for rendering
 *   - setMenu() — wire an external menu control (Shell's SearchMenu)
 *
 * CLI creates a controller without a custom menu (internal HeadlessSearchMenu).
 * Shell creates a controller, then passes it as data provider to SearchMenu,
 * then calls setMenu() to wire the menu back.
 */
export class CompletionController
    implements SearchMenuDataProvider<SearchMenuItem>
{
    private readonly session: PartialCompletionSession;
    private readonly headlessMenu: HeadlessSearchMenu | undefined;

    constructor(
        dispatcher: ICompletionDispatcher,
        options?: CompletionControllerOptions,
    ) {
        const onUpdate = options?.onUpdate ?? (() => {});
        this.session = new PartialCompletionSession(dispatcher);
        // Create a headless menu as the default control surface.
        // Callers that supply their own menu via setMenu() override this.
        const headless = new HeadlessSearchMenu(onUpdate, this);
        this.headlessMenu = headless;
        this.session.setMenu(headless);
    }

    // ── SearchMenuDataProvider implementation ─────────────────────────

    public filterItems(prefix: string): SearchMenuItem[] {
        return this.session.filterItems(prefix);
    }

    public hasExactMatch(text: string): boolean {
        return this.session.hasExactMatch(text);
    }

    public numChoices(): number {
        return this.session.numChoices();
    }

    // ── Menu wiring ──────────────────────────────────────────────────

    /**
     * Wire an external menu control (e.g. Shell's SearchMenu).
     * Replaces the internal HeadlessSearchMenu.
     */
    public setMenu(menu: ISearchMenuControl): void {
        this.session.setMenu(menu);
    }

    /**
     * Set or replace the callback invoked when completions change.
     * Only effective when using the internal HeadlessSearchMenu (CLI path).
     */
    public setOnUpdate(onUpdate: () => void): void {
        if (this.headlessMenu) {
            this.headlessMenu.onUpdate = onUpdate;
        }
    }

    // ── Completion lifecycle ─────────────────────────────────────────

    /**
     * Drive the completion state machine on each keystroke.
     * @param input   Current input text
     * @param direction  "forward" (typing) or "backward" (backspace)
     */
    public update(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.session.update(input, direction);
    }

    /** Accept the current completion (Tab/Enter). Resets session to idle. */
    public accept(): void {
        this.session.resetToIdle();
    }

    /**
     * Dismiss completions (Escape key). Performs smart level-shift or refetch.
     * @param input      Current input text
     * @param direction  Direction hint for the session
     */
    public dismiss(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.session.explicitHide(input, direction);
    }

    /** Hide the menu without clearing session state (e.g. cursor moved away). */
    public hide(): void {
        this.session.hide();
    }

    /**
     * Returns the current completion state for rendering, or undefined
     * when there are no completions to show.
     */
    public getCompletionState(input: string): CompletionState | undefined {
        return this.session.getCompletionState(input);
    }

    /**
     * Returns the completion prefix (text typed after the anchor), or
     * undefined when no completions are active.  Useful for Shell's
     * handleSelect which needs the prefix before calling accept().
     */
    public getCompletionPrefix(input: string): string | undefined {
        return this.session.getCompletionPrefix(input);
    }
}

/** Factory function for creating a CompletionController. */
export function createCompletionController(
    dispatcher: ICompletionDispatcher,
    options?: CompletionControllerOptions,
): CompletionController {
    return new CompletionController(dispatcher, options);
}
