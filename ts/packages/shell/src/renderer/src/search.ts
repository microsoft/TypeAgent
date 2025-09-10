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

type SearchMenuPosition = {
    left: number;
    bottom: number;
};

interface SearchMenuUI {
    setPosition(position: SearchMenuPosition): void;
    setItems(prefix: string, items: SearchMenuItem[]): void;
    adjustSelection(deltaY: number): void;
    selectCompletion(): void;
    close(): void;
}

class SearchMenuUIImpl implements SearchMenuUI {
    private readonly searchContainer: HTMLDivElement;
    private readonly scrollBar: HTMLDivElement;
    private readonly scrollBarIndicator: HTMLDivElement;
    private completions: HTMLUListElement | undefined;
    private selected: number = -1;
    private items: SearchMenuItem[] = [];
    private prefix: string = "";
    private top: number = 0;

    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItemsCount = 15,
    ) {
        this.onCompletion = onCompletion;
        this.searchContainer = document.createElement("div");
        this.searchContainer.className = "autocomplete-container";

        this.searchContainer.onfocus = () => {
            console.log("Search container Focus");
        };

        this.searchContainer.onblur = () => {
            console.log("Search container blur");
        };

        this.searchContainer.onwheel = (event) => {
            console.log(`SearchContainer onwheel deltaY ${event.deltaY} `);
            this.adjustSelection(event.deltaY);
        };

        this.scrollBar = document.createElement("div");
        this.scrollBar.classList.add("autocomplete-scrollbar");
        this.scrollBarIndicator = document.createElement("div");
        this.scrollBarIndicator.classList.add(
            "autocomplete-scrollbar-indicator",
        );
        this.scrollBar.appendChild(this.scrollBarIndicator);
        this.searchContainer.append(this.scrollBar);

        document.body.appendChild(this.searchContainer);
    }

    public setPosition(position: SearchMenuPosition) {
        const height = document.documentElement.clientHeight;
        this.searchContainer.style.left = `${position.left}px`;
        this.searchContainer.style.bottom = `${height - position.bottom}px`;
    }

    public close() {
        this.searchContainer.remove();
    }

    public selectCompletion() {
        const index = this.selected;
        if (index >= 0 && index < this.items.length) {
            this.onCompletion(this.items[index]);
        }
    }

    // add completions to the search menu
    public setItems(prefix: string, items: SearchMenuItem[]) {
        this.prefix = prefix;
        this.items = items;
        this.selected = 0;
        this.top = 0;
        this.updateDisplay();
    }

    public adjustSelection(deltaY: number) {
        if (deltaY > 0 && this.selected < this.items.length - 1) {
            this.selected++;
        } else if (deltaY < 0 && this.selected > 0) {
            this.selected--;
        }

        this.updateDisplay();
    }

    private updateDisplay() {
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
    private setScrollBarPosition() {
        const heightPercentage = this.visibleItemsCount / this.items.length;
        this.scrollBarIndicator.style.height = `${this.searchContainer.scrollHeight * heightPercentage}px`;

        const offsetPercentage = this.top / this.items.length;
        this.scrollBarIndicator.style.top = `${this.searchContainer.scrollHeight * offsetPercentage}px`;
    }
}

export class SearchMenu {
    private searchMenuUI: SearchMenuUI | undefined;
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();
    private prefix: string | undefined;
    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItems: number = 15,
    ) {}

    public isActive() {
        return this.searchMenuUI !== undefined;
    }

    public setChoices(choices: SearchMenuItem[]) {
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

    public numChoices() {
        return this.trie.size();
    }

    public updatePrefix(prefix: string, position: SearchMenuPosition) {
        if (this.numChoices() === 0) {
            return;
        }

        if (this.prefix === prefix && this.searchMenuUI !== undefined) {
            // No need to update existing searchMenuUI, just update the position.
            this.searchMenuUI.setPosition(position);
            return;
        }

        this.prefix = prefix;
        const items = this.trie.dataWithPrefix(normalizeMatchText(prefix));
        const showMenu =
            items.length !== 0 &&
            (items.length !== 1 || items[0].matchText !== prefix);

        if (showMenu) {
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = new SearchMenuUIImpl(
                    this.onCompletion,
                    this.visibleItems,
                );
            }
            this.searchMenuUI.setItems(prefix, items);
            this.searchMenuUI.setPosition(position);
        } else {
            this.hide();
        }
    }

    public hide() {
        if (this.searchMenuUI) {
            this.searchMenuUI.close();
            this.searchMenuUI = undefined;
        }
    }
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
}
