// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isElectron } from "./main";
import {
    isUniquelySatisfied,
    type SearchMenuDataProvider,
} from "agent-dispatcher/helpers/completion";
import { CompletionToggle } from "./searchMenuUI/completionToggle";
import { InlineSearchMenuUI } from "./searchMenuUI/inlineSearchMenuUI";
import { LocalSearchMenuUI } from "./searchMenuUI/localSearchMenuUI";
import { RemoteSearchMenuUI } from "./searchMenuUI/remoteSearchMenuUI";
import {
    SearchMenuItem,
    SearchMenuPosition,
    SearchMenuUI,
} from "./searchMenuUI/searchMenuUI";

// Architecture: docs/architecture/completion.md — §7 Shell — Search Menu
export class SearchMenu {
    private searchMenuUI: SearchMenuUI | undefined;
    private lastPosition: SearchMenuPosition | undefined;
    private lastPrefix: string | undefined;
    private lastItems: SearchMenuItem[] | undefined;
    private readonly toggle: CompletionToggle | undefined;
    private prefix: string | undefined;
    private _active: boolean = false;

    constructor(
        private readonly dataProvider: SearchMenuDataProvider<SearchMenuItem>,
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private inline: boolean,
        private readonly getPosition: (
            prefix: string,
        ) => SearchMenuPosition | undefined,
        private readonly textEntry?: HTMLSpanElement,
        onToggleMode?: () => void,
    ) {
        if (onToggleMode && textEntry && textEntry.parentElement) {
            this.toggle = new CompletionToggle(
                inline ? "expand" : "collapse",
                onToggleMode,
            );
            this.toggle.hide();
            textEntry.parentElement.appendChild(this.toggle.getElement());
        }
    }

    private createUI(): SearchMenuUI {
        return this.inline
            ? new InlineSearchMenuUI(this.onCompletion, this.textEntry!)
            : isElectron()
              ? new RemoteSearchMenuUI(this.onCompletion)
              : new LocalSearchMenuUI(this.onCompletion);
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
        this.toggle?.setDirection(newInline ? "expand" : "collapse");
        if (
            wasActive &&
            this.lastPosition &&
            this.lastPrefix !== undefined &&
            this.lastItems
        ) {
            this.searchMenuUI = this.createUI();
            this.searchMenuUI.update({
                position: this.lastPosition,
                prefix: this.lastPrefix,
                items: this.lastItems,
            });
            this.updateToggleLayout();
        }
    }

    // ── Rendering ───────────────────────────────────────────────────────────────

    /**
     * Render completions for the given prefix.  Queries the data provider
     * for matching items, resolves the menu position, and shows or hides
     * the UI accordingly.
     *
     * Called by the shell in response to onUpdate (partial.ts) or
     * on input events (templateEditor.ts).
     */
    public render(prefix: string): void {
        if (this.dataProvider.numChoices() === 0) {
            this.hide();
            return;
        }

        const position = this.getPosition(prefix);
        if (position === undefined) {
            this.hide();
            return;
        }

        if (this.prefix === prefix && this._active) {
            this.lastPosition = position;
            this.searchMenuUI!.update({ position });
            this.updateToggleLayout();
            return;
        }

        this.prefix = prefix;
        const items = this.dataProvider.filterItems(prefix);
        const showMenu =
            items.length !== 0 && !isUniquelySatisfied(items, prefix);

        if (showMenu) {
            this._active = true;
            // onShow
            this.lastPosition = position;
            this.lastPrefix = prefix;
            this.lastItems = items;
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = this.createUI();
            }
            this.searchMenuUI.update({ position, prefix, items });
            this.toggle?.show();
            this.updateToggleLayout();
        } else {
            this.hide();
        }
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
            // onHide
            this.lastPosition = undefined;
            this.lastPrefix = undefined;
            this.lastItems = undefined;
            this.toggle?.hide();
            this.searchMenuUI?.close();
            this.searchMenuUI = undefined;
        }
    }

    public isActive(): boolean {
        return this._active;
    }

    // ── UI event handling ─────────────────────────────────────────────────────

    public handleMouseWheel(deltaY: number) {
        this.searchMenuUI?.adjustSelection(deltaY);
    }

    public handleSpecialKeys(event: KeyboardEvent) {
        if (this.searchMenuUI === undefined) {
            return false;
        }
        if (event.key === "ArrowDown") {
            this.searchMenuUI.adjustSelection(1);
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowUp") {
            this.searchMenuUI.adjustSelection(-1);
            event.preventDefault();
            return true;
        }

        if (event.key === "Enter" || event.key === "Tab") {
            this.searchMenuUI.selectCompletion();
            event.preventDefault();
            return true;
        }

        return false;
    }

    private updateToggleLayout(): void {
        if (!this.toggle || !this.textEntry?.parentElement) {
            return;
        }
        const toggleEl = this.toggle.getElement();
        const chatInputRect =
            this.textEntry.parentElement.getBoundingClientRect();

        if (this.lastPosition) {
            toggleEl.style.left = `${this.lastPosition.left - chatInputRect.left}px`;
        }
        toggleEl.style.width = "";
    }
}
