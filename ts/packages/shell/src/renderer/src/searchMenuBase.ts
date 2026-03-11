// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TST } from "./prefixTree.js";
import {
    SearchMenuItem,
    SearchMenuPosition,
} from "../../preload/electronTypes.js";

export function normalizeMatchText(text: string): string {
    // Remove diacritical marks, and replace any space characters with normalized ' '.
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
        .replace(/\s/g, " ")
        .toLowerCase();
}

export class SearchMenuBase {
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();
    private prefix: string | undefined;
    private _active: boolean = false;

    public setChoices(choices: SearchMenuItem[]): void {
        this.prefix = undefined;
        this.trie.init();
        for (const choice of choices) {
            // choices are sorted in priority order so prefer first norm text
            const normText = normalizeMatchText(choice.matchText);
            if (!this.trie.get(normText)) {
                this.trie.insert(normText, choice);
            }
        }
    }

    public numChoices(): number {
        return this.trie.size();
    }

    public hasExactMatch(text: string): boolean {
        return this.trie.contains(normalizeMatchText(text));
    }

    public updatePrefix(prefix: string, position: SearchMenuPosition): boolean {
        if (this.trie.size() === 0) {
            return false;
        }

        if (this.prefix === prefix && this._active) {
            this.onUpdatePosition(position);
            return false;
        }

        this.prefix = prefix;
        const items = this.trie.dataWithPrefix(normalizeMatchText(prefix));
        const uniquelySatisfied =
            items.length === 1 &&
            normalizeMatchText(items[0].matchText) ===
                normalizeMatchText(prefix);
        const showMenu = items.length !== 0 && !uniquelySatisfied;

        if (showMenu) {
            this._active = true;
            this.onShow(position, prefix, items);
        } else {
            this.hide();
        }
        return uniquelySatisfied;
    }

    public hide(): void {
        if (this._active) {
            this._active = false;
            this.onHide();
        }
    }

    public isActive(): boolean {
        return this._active;
    }

    protected onShow(
        _position: SearchMenuPosition,
        _prefix: string,
        _items: SearchMenuItem[],
    ): void {}

    protected onUpdatePosition(_position: SearchMenuPosition): void {}

    protected onHide(): void {}
}
