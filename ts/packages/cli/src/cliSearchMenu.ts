// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SearchMenuBase,
    SearchMenuItem,
    SearchMenuPosition,
} from "agent-dispatcher/helpers/completion";

// CLI adapter for ISearchMenu.  Extends SearchMenuBase (which provides
// TST-based prefix matching) and captures the filtered items so that
// questionWithCompletion can read them for ghost-text display.
//
// Architecture: docs/architecture/completion.md — §CLI integration
export class CliSearchMenu extends SearchMenuBase {
    private currentItems: SearchMenuItem[] = [];
    private readonly onUpdate: () => void;

    constructor(onUpdate: () => void) {
        super();
        this.onUpdate = onUpdate;
    }

    protected override onShow(
        _position: SearchMenuPosition,
        _prefix: string,
        items: SearchMenuItem[],
    ): void {
        this.currentItems = items;
        this.onUpdate();
    }

    protected override onHide(): void {
        this.currentItems = [];
        this.onUpdate();
    }

    /** Returns the items currently visible in the menu (trie-filtered). */
    public getItems(): SearchMenuItem[] {
        return this.currentItems;
    }
}
