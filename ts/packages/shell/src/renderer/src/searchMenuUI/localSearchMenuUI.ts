// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SearchMenuItem,
    SearchMenuPosition,
    SearchMenuUI,
    SearchMenuUIUpdateData,
} from "./searchMenuUI";

export class LocalSearchMenuUI implements SearchMenuUI {
    private readonly searchContainer: HTMLDivElement;
    private readonly scrollBar: HTMLDivElement;
    private readonly scrollBarIndicator: HTMLDivElement;
    private completions: HTMLUListElement | undefined;
    private selected: number = -1;
    private items: SearchMenuItem[] = [];
    private prefix: string = "";
    private top: number = 0;

    private get closed() {
        return this.searchContainer.parentElement === null;
    }

    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItemsCount = 15,
    ) {
        this.onCompletion = onCompletion;
        this.searchContainer = document.createElement("div");
        this.searchContainer.className = "autocomplete-container";

        this.searchContainer.onwheel = (event) => {
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

    public close() {
        this.searchContainer.remove();
    }

    public selectCompletion() {
        if (this.closed) {
            return;
        }
        const index = this.selected;
        if (index >= 0 && index < this.items.length) {
            this.onCompletion(this.items[index]);
        }
    }

    public update(data: SearchMenuUIUpdateData) {
        if (this.closed) {
            return;
        }

        if (data.position) {
            this.setPosition(data.position);
        }

        let updateDisplay: boolean = false;
        if (data.prefix !== undefined) {
            updateDisplay = true;
            this.prefix = data.prefix;
        }

        if (data.items !== undefined) {
            updateDisplay = true;
            this.items = data.items;
            this.selected = 0;
            this.top = 0;
        }

        if (updateDisplay) {
            this.updateDisplay();
        }
    }

    private setPosition(position: SearchMenuPosition) {
        this.searchContainer.style.left = `${position.left}px`;
        this.searchContainer.style.bottom = `${position.bottom}px`;
    }

    public adjustSelection(deltaY: number) {
        if (this.closed) {
            return;
        }
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
