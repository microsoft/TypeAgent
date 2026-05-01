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

    public switchMode(newInline: boolean): boolean {
        if (this.inline === newInline) {
            return false;
        }
        if (this.searchMenuUI) {
            this.searchMenuUI.close();
            this.searchMenuUI = undefined;
        }
        this.inline = newInline;
        this.toggle?.setDirection(newInline ? "expand" : "collapse");
        return true;
    }

    // ── Rendering ───────────────────────────────────────────────────────────────

    /**
     * Update only the popup position without re-rendering items.
     * Called by the host when the completion generation has not changed
     * (same items, same prefix) but the cursor may have moved.
     */
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
        this.updateToggleLayout(position);
    }

    /**
     * Render completions for the given prefix and pre-computed items.
     * Always performs a full item update on the underlying UI.  The
     * caller decides whether to call this (items changed) or
     * updatePosition() (position only).
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
        this.searchMenuUI?.scrollBy(deltaY);
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

        if (event.key === "Tab") {
            // Tab on an unselected dropdown snaps to the first item
            // (matching ArrowDown), instead of leaving the user with
            // nothing.  A second Tab will then accept that item.
            if (!this.searchMenuUI.selectCompletion()) {
                this.searchMenuUI.adjustSelection(1);
            }
            event.preventDefault();
            return true;
        }

        // In dropdown mode, Enter accepts the highlighted item (and
        // therefore does NOT submit the request).  In inline mode, we
        // intentionally let Enter fall through to submit the request,
        // matching the existing UX where ghost text is only accepted
        // by Tab.  When no item is selected (e.g. an auto-opened
        // subcommand menu the user hasn't navigated yet), Enter falls
        // through to default handling so the user can submit/newline.
        if (event.key === "Enter" && !this.inline && this._active) {
            if (!this.searchMenuUI.selectCompletion()) {
                return false;
            }
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
