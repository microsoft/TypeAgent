// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SearchMenuItem,
    SearchMenuUI,
    SearchMenuUIUpdateData,
} from "./searchMenuUI";

export class InlineSearchMenuUI implements SearchMenuUI {
    private ghostSpan: HTMLSpanElement | null = null;
    private selected: number = -1;
    private items: SearchMenuItem[] = [];
    private prefix: string = "";

    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly textEntry: HTMLSpanElement,
    ) {}

    public close() {
        this.removeGhost();
        this.items = [];
        this.selected = -1;
    }

    public selectCompletion() {
        if (this.selected >= 0 && this.selected < this.items.length) {
            this.removeGhost();
            this.onCompletion(this.items[this.selected]);
        }
    }

    public update(data: SearchMenuUIUpdateData) {
        let changed = false;
        if (data.prefix !== undefined) {
            this.prefix = data.prefix;
            changed = true;
        }
        if (data.items !== undefined) {
            this.items = data.items;
            this.selected = this.items.length > 0 ? 0 : -1;
            changed = true;
        }
        // Only re-render ghost when items or prefix changed, not for
        // position-only updates, to avoid a selectionchange feedback loop.
        if (changed) {
            this.renderGhost();
        }
    }

    public adjustSelection(deltaY: number) {
        if (this.items.length === 0) {
            return;
        }
        if (deltaY > 0 && this.selected < this.items.length - 1) {
            this.selected++;
        } else if (deltaY < 0 && this.selected > 0) {
            this.selected--;
        }
        this.renderGhost();
    }

    private removeGhost() {
        if (this.ghostSpan && this.ghostSpan.parentNode) {
            this.ghostSpan.parentNode.removeChild(this.ghostSpan);
        }
        this.ghostSpan = null;
    }

    private renderGhost() {
        this.removeGhost();
        if (
            this.items.length === 0 ||
            this.selected < 0 ||
            this.selected >= this.items.length
        ) {
            return;
        }

        const item = this.items[this.selected];
        const matchText = item.matchText;

        // Compute the suffix: portion of the completion after the typed prefix
        const suffix =
            matchText.length > this.prefix.length
                ? matchText.substring(this.prefix.length)
                : "";

        // Build counter text
        const counter = ` ${this.selected + 1}/${this.items.length}`;

        // Create ghost span
        const ghost = document.createElement("span");
        ghost.className = "inline-ghost";
        ghost.contentEditable = "false";
        ghost.textContent = suffix + counter;
        this.ghostSpan = ghost;

        // Append ghost to text entry
        this.textEntry.appendChild(ghost);

        // Restore cursor position before the ghost span
        this.setCursorBeforeGhost();
    }

    private setCursorBeforeGhost() {
        if (!this.ghostSpan) {
            return;
        }
        const s = document.getSelection();
        if (!s) {
            return;
        }
        const r = document.createRange();
        // Set cursor right before the ghost span
        r.setStartBefore(this.ghostSpan);
        r.collapse(true);
        s.removeAllRanges();
        s.addRange(r);
    }
}
