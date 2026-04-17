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

// ── TST-backed data provider ──────────────────────────────────────────────────

// Interface for data providers that support imperative setChoices loading.
export interface SearchMenuIndex {
    filterItems(prefix: string): SearchMenuItem[];
    numChoices(): number;
    setChoices(choices: SearchMenuItem[]): void;
    hasExactMatch(text: string): boolean;
}

export class TSTSearchMenuDataProvider implements SearchMenuIndex {
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();

    public setChoices(choices: SearchMenuItem[]): void {
        this.trie.init();
        for (const choice of choices) {
            // choices are sorted in priority order so prefer first norm text
            const normText = normalizeMatchText(choice.matchText);
            if (!this.trie.get(normText)) {
                this.trie.insert(normText, choice);
            }
        }
    }

    public filterItems(prefix: string): SearchMenuItem[] {
        return this.trie.dataWithPrefix(normalizeMatchText(prefix));
    }

    public hasExactMatch(text: string): boolean {
        return this.trie.contains(normalizeMatchText(text));
    }

    public numChoices(): number {
        return this.trie.size();
    }
}

/** Create a mutable SearchMenuDataProvider backed by a prefix tree. */
export function createSearchMenuIndex(): SearchMenuIndex {
    return new TSTSearchMenuDataProvider();
}
