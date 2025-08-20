// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TST } from "./prefixTree";

export type SearchMenuItem = {
    matchText: string;
    emojiChar?: string;
    sortIndex?: number;
    selectedText: string;
    needQuotes?: boolean; // default is true, and will add quote to the selectedText if it has spaces.
};

function normalizeMatchText(text: string): string {
    // Remove diacritical marks, and case replace any space characters with the normalized ' '.
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
        .replace(/\s/g, " ")
        .toLowerCase();
}

export class SearchMenu {
    private searchContainer: HTMLDivElement;
    private scrollBar: HTMLDivElement;
    private scrollBarIndicator: HTMLDivElement;
    private searchInput: HTMLInputElement | undefined = undefined;
    private completions: HTMLUListElement | undefined;
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();
    private selected: number = -1;
    private onCompletion: (item: SearchMenuItem) => void;
    private items: SearchMenuItem[] = [];
    private prefix: string = "";
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

        this.searchContainer.onfocus = () => {
            console.log("Search container Focus");
        };

        this.searchContainer.onblur = () => {
            console.log("Search container blur");
        };

        this.searchContainer.onwheel = (event) => {
            console.log(`SearchContainer onwheel deltaY ${event.deltaY} `);
            this.handleMouseWheel(event.deltaY);
        };

        this.scrollBar = document.createElement("div");
        this.scrollBar.classList.add("autocomplete-scrollbar");
        this.scrollBarIndicator = document.createElement("div");
        this.scrollBarIndicator.classList.add(
            "autocomplete-scrollbar-indicator",
        );
        this.scrollBar.appendChild(this.scrollBarIndicator);
        this.searchContainer.append(this.scrollBar);
    }

    public getContainer() {
        return this.searchContainer;
    }

    public isActive() {
        return this.searchContainer.parentElement !== null;
    }

    public selectCompletion(index: number) {
        if (index >= 0 && index < this.items.length) {
            this.onCompletion(this.items[index]);
        }
    }

    public handleSpecialKeys(event: KeyboardEvent, prefix: string) {
        if (this.completions) {
            this.prefix = prefix;
            if (event.key === "ArrowDown") {
                if (this.selected < this.items.length - 1) {
                    this.selected++;
                    this.updateDisplay();
                }
                event.preventDefault();
                return true;
            } else if (event.key === "ArrowUp") {
                if (this.selected > 0) {
                    this.selected--;
                    this.updateDisplay();
                }
                event.preventDefault();
                return true;
            } else if (event.key === "Enter" || event.key === "Tab") {
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
            this.trie.insert(normalizeMatchText(choice.matchText), choice);
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
        const items = this.trie.dataWithPrefix(normalizeMatchText(prefix));
        this.replaceItems(prefix, items);
        return items;
    }

    // add completions to the search menu
    public replaceItems(prefix: string, items: SearchMenuItem[]) {
        this.prefix = prefix;
        this.items = items;
        this.selected = 0;
        this.top = 0;
        this.updateDisplay();
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

    public handleMouseWheel(deltaY: number) {
        if (deltaY > 0 && this.selected < this.items.length - 1) {
            this.selected++;
        } else if (deltaY < 0 && this.selected > 0) {
            this.selected--;
        }

        this.updateDisplay();
    }

    public updateDisplay() {
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
                prefixSpan.innerText = this.prefix;
                li.appendChild(prefixSpan);
                // make a span for the suffix
                const suffix = item.matchText.substring(this.prefix.length);
                const resultSpan = document.createElement("span");
                resultSpan.className = "search-suffix";
                resultSpan.innerText = suffix;
                li.appendChild(resultSpan);
                this.completions.appendChild(li);

                // handle mouse events
                li.onmousedown = () => {
                    this.onCompletion(item);
                };
                li.onmousemove = () => {
                    if (this.selected != i) {
                        this.selected = i;
                        this.updateDisplay();
                    }
                };

                if (i === this.items.length - 1) {
                    break;
                }
            }
            this.searchContainer.appendChild(this.completions);
            this.searchContainer.style.visibility = "visible";

            // calculate scrollbar indicator offset and height
            this.setScrollBarPosition();
        }
    }

    /**
     * Sets the offset and size of the scrollbar indicator
     */
    setScrollBarPosition() {
        const heightPercentage = this.visibleItemsCount / this.items.length;
        this.scrollBarIndicator.style.height = `${this.searchContainer.scrollHeight * heightPercentage}px`;

        const offsetPercentage = this.top / this.items.length;
        this.scrollBarIndicator.style.top = `${this.searchContainer.scrollHeight * offsetPercentage}px`;
    }
}
