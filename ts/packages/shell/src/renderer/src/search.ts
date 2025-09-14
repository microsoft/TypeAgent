// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isElectron } from "./main";
import { TST } from "./prefixTree";
import { LocalSearchMenuUI } from "./searchMenuUI/localSearchMenuUI";
import { RemoteSearchMenuUI } from "./searchMenuUI/remoteSearchMenuUI";
import {
    SearchMenuItem,
    SearchMenuPosition,
    SearchMenuUI,
} from "./searchMenuUI/searchMenuUI";

function normalizeMatchText(text: string): string {
    // Remove diacritical marks, and case replace any space characters with the normalized ' '.
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
        .replace(/\s/g, " ")
        .toLowerCase();
}

export class SearchMenu {
    private searchMenuUI: SearchMenuUI | undefined;
    private trie: TST<SearchMenuItem> = new TST<SearchMenuItem>();
    private prefix: string | undefined;
    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItems: number = 15,
        private readonly remoteUI: boolean = isElectron(),
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
            this.searchMenuUI.update({ position });
            return;
        }

        this.prefix = prefix;
        const items = this.trie.dataWithPrefix(normalizeMatchText(prefix));
        const showMenu =
            items.length !== 0 &&
            (items.length !== 1 || items[0].matchText !== prefix);

        if (showMenu) {
            if (this.searchMenuUI === undefined) {
                this.searchMenuUI = this.remoteUI
                    ? new RemoteSearchMenuUI(
                          this.onCompletion,
                          this.visibleItems,
                      )
                    : new LocalSearchMenuUI(
                          this.onCompletion,
                          this.visibleItems,
                      );
            }
            this.searchMenuUI.update({ position, prefix, items });
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
