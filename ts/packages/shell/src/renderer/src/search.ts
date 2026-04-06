// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isElectron } from "./main";
import { SearchMenuBase } from "./searchMenuBase";
import { InlineSearchMenuUI } from "./searchMenuUI/inlineSearchMenuUI";
import { LocalSearchMenuUI } from "./searchMenuUI/localSearchMenuUI";
import { RemoteSearchMenuUI } from "./searchMenuUI/remoteSearchMenuUI";
import {
    SearchMenuItem,
    SearchMenuPosition,
    SearchMenuUI,
} from "./searchMenuUI/searchMenuUI";

// Architecture: docs/architecture/completion.md — §7 Shell — Search Menu
export class SearchMenu extends SearchMenuBase {
    private searchMenuUI: SearchMenuUI | undefined;
    constructor(
        private readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly inline: boolean,
        private readonly textEntry?: HTMLSpanElement,
    ) {
        super();
    }

    protected override onShow(
        position: SearchMenuPosition,
        prefix: string,
        items: SearchMenuItem[],
    ): void {
        if (this.searchMenuUI === undefined) {
            this.searchMenuUI = this.inline
                ? new InlineSearchMenuUI(this.onCompletion, this.textEntry!)
                : isElectron()
                  ? new RemoteSearchMenuUI(this.onCompletion)
                  : new LocalSearchMenuUI(this.onCompletion);
        }
        this.searchMenuUI.update({ position, prefix, items });
    }

    protected override onUpdatePosition(position: SearchMenuPosition): void {
        this.searchMenuUI!.update({ position });
    }

    protected override onHide(): void {
        this.searchMenuUI!.close();
        this.searchMenuUI = undefined;
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
