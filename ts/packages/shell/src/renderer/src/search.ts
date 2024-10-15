// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TST } from "./prefixTree";

export type SearchMenuItem = {
    matchText: string;
    selectedText: string;
    emojiChar?: string;
    groupName?: string;
};

export class SearchMenu {
    private searchContainer: HTMLDivElement;
    private searchInput: HTMLInputElement | undefined = undefined;
    private completions: HTMLUListElement | undefined;
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();
    private selected: number = -1;
    private onCompletion: (item: SearchMenuItem) => void;
    private items: SearchMenuItem[] = [];
    visibleItemsCount: number = 15;
    top: number = 0;

    constructor(
        onCompletion: (item: SearchMenuItem) => void,
        provideInput = true,
        placeholder = "Search...",
        visibleItems = 15,
    ) {
        this.onCompletion = onCompletion;
        this.searchContainer = document.createElement("div");
        this.searchContainer.className = "autocomplete-container";
        this.visibleItemsCount = visibleItems;
        if (provideInput) {
            this.searchInput = document.createElement("input");
            this.searchInput.className = "search-input";
            this.searchInput.placeholder = placeholder;
            this.searchInput.addEventListener("input", (event) => {
                const input = event.target as HTMLInputElement;
                this.completePrefix(input.value);
            });
            this.searchContainer.appendChild(this.searchInput);
        }
    }

    public getContainer() {
        return this.searchContainer;
    }

    public selectCompletion(index: number) {
        if (index >= 0 && index < this.items.length) {
            this.onCompletion(this.items[index]);
        }
    }

    public handleSpecialKeys(event: KeyboardEvent, prefix: string) {
        if (this.completions) {
            if (event.key === "ArrowDown") {
                if (this.selected < this.items.length - 1) {
                    this.selected++;
                    this.updateDisplay(prefix);
                }
                event.preventDefault();
                return true;
            } else if (event.key === "ArrowUp") {
                if (this.selected > 0) {
                    this.selected--;
                    this.updateDisplay(prefix);
                }
                event.preventDefault();
                return true;
            } else if (event.key === "Enter") {
                if (this.selected >= 0 && this.selected < this.items.length) {
                    this.selectCompletion(this.selected);
                    event.preventDefault();
                }
                return true;
            }
        }
        return false;
    }

    public setChoices(choices: SearchMenuItem[]) {
        this.trie.init();
        for (const choice of choices) {
            this.trie.insert(choice.matchText, choice);
        }
    }

    public get numChoices() {
        return this.trie.size();
    }

    public focus() {
        setTimeout(() => {
            if (this.searchInput) {
                this.searchInput.focus();
            }
        }, 0);
    }

    public completePrefix(prefix: string) {
        const items = this.trie.dataWithPrefix(prefix);
        this.replaceItems(prefix, items);
        return items;
    }

    // add completions to the search menu
    public replaceItems(prefix: string, items: SearchMenuItem[]) {
        this.items = items;
        this.selected = 0;
        this.top = 0;
        this.updateDisplay(prefix);
    }

    // add legend to top of the search menu, with minimum
    public addLegend(legend: string) {
        const legendDiv = document.createElement("div");
        legendDiv.className = "search-legend";
        legendDiv.innerText =
            legend + "Use ↑ and ↓ to navigate, Enter to select";
        // prepend the legend to the search container
        this.searchContainer.prepend(legendDiv);
    }

    public updateDisplay(prefix: string) {
        if (this.completions) {
            this.searchContainer.removeChild(this.completions);
            this.completions = undefined;
            this.searchContainer.style.visibility = "hidden";
        }
        if (this.items.length > 0) {
            this.completions = document.createElement("ul");
            this.completions.className = "completions";
            if (
                this.selected < this.top ||
                this.selected >= this.top + this.visibleItemsCount
            ) {
                this.top = this.selected;
            }
            if (this.top + this.visibleItemsCount > this.items.length) {
                this.top = Math.max(
                    0,
                    this.items.length - this.visibleItemsCount,
                );
            }
            for (let i = this.top; i < this.top + this.visibleItemsCount; i++) {
                const li = document.createElement("li");
                const item = this.items[i];
                if (i === this.selected) {
                    li.className = "completion-selected"; // highlight the selected completion
                }
                if (item.emojiChar) {
                    const symbolSpan = document.createElement("span");
                    symbolSpan.className = "search-symbol";
                    symbolSpan.innerText = item.emojiChar;
                    li.appendChild(symbolSpan);
                }
                // make a span for the prefix
                const prefixSpan = document.createElement("span");
                prefixSpan.className = "search-prefix";
                prefixSpan.innerText = prefix;
                li.appendChild(prefixSpan);
                // make a span for the suffix
                const suffix = item.matchText.substring(prefix.length);
                const resultSpan = document.createElement("span");
                resultSpan.className = "search-suffix";
                resultSpan.innerText = suffix;
                li.appendChild(resultSpan);
                this.completions.appendChild(li);
                if (i === this.items.length - 1) {
                    break;
                }
            }
            this.searchContainer.appendChild(this.completions);
            this.searchContainer.style.visibility = "visible";
        }
    }
}
