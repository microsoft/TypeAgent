// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isElectron } from "./main";
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
    private readonly toggle: CompletionToggle | undefined;
    private prefix: string | undefined;
    private _active: boolean = false;

    constructor(
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
        if (this.searchMenuUI) {
            this.searchMenuUI.close();
            this.searchMenuUI = undefined;
        }
        this.inline = newInline;
        this.toggle?.setDirection(newInline ? "expand" : "collapse");
        // Reset prefix so the next render() performs a full update
        // (not the position-only shortcut).  The caller is responsible
        // for triggering a re-render with the current completion state.
        this.prefix = undefined;
    }

    // ── Rendering ───────────────────────────────────────────────────────────────

    /**
     * Render completions for the given prefix and pre-computed items.
     * The caller (partial.ts onUpdate, templateEditor.ts) is responsible
     * for filtering and uniqueness checks — this method is purely
     * presentational.
     *
     * Called by the shell in response to onUpdate (partial.ts) or
     * on input events (templateEditor.ts).
     */
    public render(prefix: string, items: SearchMenuItem[]): void {
        const position = this.getPosition(prefix);
        if (position === undefined) {
            this.hide();
            return;
        }

        if (this.prefix === prefix && this._active) {
            this.searchMenuUI!.update({ position });
            this.updateToggleLayout(position);
            return;
        }

        this.prefix = prefix;

        if (items.length > 0) {
            this._active = true;
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = this.createUI();
            }
            this.searchMenuUI.update({ position, prefix, items });
            this.toggle?.show();
            this.updateToggleLayout(position);
        } else {
            this.hide();
        }
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
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

    private updateToggleLayout(position: SearchMenuPosition): void {
        if (!this.toggle || !this.textEntry?.parentElement) {
            return;
        }
        const toggleEl = this.toggle.getElement();
        const chatInputRect =
            this.textEntry.parentElement.getBoundingClientRect();

        toggleEl.style.left = `${position.left - chatInputRect.left}px`;
        toggleEl.style.width = "";
    }
}
