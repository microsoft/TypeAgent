// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TST, normalizeMatchText } from "./trie.js";

// ── Search menu types ─────────────────────────────────────────────────────────

export type SearchMenuItem = {
    matchText: string;
    emojiChar?: string | undefined;
    sortIndex?: number;
    selectedText: string;
    needQuotes?: boolean | undefined; // When undefined, treated as true by consumers (add quotes if selectedText has spaces).
};

// ── Utility ───────────────────────────────────────────────────────────────────

export function isUniquelySatisfied(
    items: SearchMenuItem[],
    prefix: string,
): boolean {
    return (
        items.length === 1 &&
        normalizeMatchText(items[0].matchText) === normalizeMatchText(prefix)
    );
}

// ── TST-backed search menu index ──────────────────────────────────────────────

// Interface for search menu indices that support imperative setItems loading.
export interface SearchMenuIndex {
    filterItems(prefix: string): SearchMenuItem[];
    numItems(): number;
    setItems(items: SearchMenuItem[]): void;
    hasExactMatch(text: string): boolean;
}

export class TSTSearchMenuIndex implements SearchMenuIndex {
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();

    public setItems(items: SearchMenuItem[]): void {
        this.trie.init();
        for (const item of items) {
            // items are sorted in priority order so prefer first norm text
            const normText = normalizeMatchText(item.matchText);
            if (!this.trie.get(normText)) {
                this.trie.insert(normText, item);
            }
        }
    }

    public filterItems(prefix: string): SearchMenuItem[] {
        return this.trie.dataWithPrefix(normalizeMatchText(prefix));
    }

    public hasExactMatch(text: string): boolean {
        return this.trie.contains(normalizeMatchText(text));
    }

    public numItems(): number {
        return this.trie.size();
    }
}

/** Create a SearchMenuIndex backed by a prefix tree. */
export function createSearchMenuIndex(): SearchMenuIndex {
    return new TSTSearchMenuIndex();
}
