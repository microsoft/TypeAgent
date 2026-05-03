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
    // True until the first items update; used so an auto-opened dropdown
    // (e.g. subcommand menu after accepting a command) shows no default
    // selection.  Subsequent updates (from user typing to filter) snap to
    // the first item.
    private firstUpdate: boolean = true;

    private get closed() {
        return this.searchContainer.parentElement === null;
    }

    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItemsCount = 15,
        // Optional notifier invoked whenever `selected` changes due to
        // local interactions (mouse hover) that the host did not initiate.
        // Allows a remote host to keep its mirrored selection index in sync
        // so synchronous APIs like selectCompletion() return correctly.
        private readonly onSelectionChange?: (selected: number) => void,
    ) {
        this.onCompletion = onCompletion;
        this.searchContainer = document.createElement("div");
        this.searchContainer.className = "autocomplete-container";

        this.searchContainer.onwheel = (event) => {
            this.scrollBy(event.deltaY);
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

    public selectCompletion(): boolean {
        if (this.closed) {
            return false;
        }
        const index = this.selected;
        if (index >= 0 && index < this.items.length) {
            this.onCompletion(this.items[index]);
            return true;
        }
        return false;
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
            this.selected = this.firstUpdate ? -1 : 0;
            this.firstUpdate = false;
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

    public scrollBy(deltaY: number) {
        if (this.closed || this.items.length === 0) {
            return;
        }
        // Some input devices fire wheel events with deltaY === 0 (e.g.
        // pure horizontal scroll on trackpads).  Treat those as no-ops
        // rather than scrolling up by one.
        const step = Math.sign(deltaY);
        if (step === 0) {
            return;
        }
        const maxTop = Math.max(0, this.items.length - this.visibleItemsCount);
        const newTop = Math.max(0, Math.min(maxTop, this.top + step));
        if (newTop === this.top) {
            return;
        }
        this.top = newTop;
        this.scrolling = true;
        try {
            this.updateDisplay();
        } finally {
            this.scrolling = false;
        }
    }

    private scrolling: boolean = false;

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
                !this.scrolling &&
                this.selected >= 0 &&
                (this.selected < this.top ||
                    this.selected >= this.top + this.visibleItemsCount)
            ) {
                this.top = this.selected;
            }
            if (this.top + this.visibleItemsCount > this.items.length) {
                this.top = Math.max(
                    0,
                    this.items.length - this.visibleItemsCount,
                );
            }
            // Guard against `top` going negative when no item is selected
            // (selected = -1) and items.length < visibleItemsCount.
            if (this.top < 0) {
                this.top = 0;
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
                // make a span for the suffix.  Append a trailing
                // non-breaking space when the inserted text ends in an
                // identifier/quote char (matching the appendSpace logic
                // in partial.ts handleSelect()) so the user can see at
                // a glance that accepting the item will also insert a
                // separator before whatever they type next.
                const suffix = item.matchText.substring(this.prefix.length);
                const lastChar = item.matchText.slice(-1);
                const showTrailingSpace = /[A-Za-z0-9_"'\)\]]/.test(lastChar);
                const resultSpan = document.createElement("span");
                resultSpan.className = "search-suffix";
                resultSpan.innerText = showTrailingSpace
                    ? `${suffix}\u00A0`
                    : suffix;
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
                        this.onSelectionChange?.(this.selected);
                    }
                };

                if (i === this.items.length - 1) {
                    break;
                }
            }
            this.searchContainer.appendChild(this.completions);
            this.searchContainer.style.visibility = "visible";

            // Show scrollbar only when items overflow the visible area
            if (this.items.length > this.visibleItemsCount) {
                this.scrollBar.style.visibility = "visible";
                this.setScrollBarPosition();
            } else {
                this.scrollBar.style.visibility = "hidden";
            }
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
