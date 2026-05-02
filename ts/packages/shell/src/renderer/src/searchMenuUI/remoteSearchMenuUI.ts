// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getClientAPI } from "../main";
import {
    SearchMenuItem,
    SearchMenuUI,
    SearchMenuUIUpdateData,
} from "./searchMenuUI";

const remoteSearchMenuUIs: Map<number, RemoteSearchMenuUI> = new Map();
let remoteSearchMenuUINextId = 0;
export function remoteSearchMenuUIOnCompletion(
    id: number,
    item: SearchMenuItem,
) {
    const menu = remoteSearchMenuUIs.get(id);
    if (menu) {
        menu.onCompletion(item);
    }
}

// Called by the renderer's Client API when the remote LocalSearchMenuUI
// reports a selection change initiated inside the remote view (e.g. mouse
// hover).  Keeps the host's mirrored selection index in sync so synchronous
// callers like selectCompletion() see the right value.
export function remoteSearchMenuUIOnSelectionChanged(
    id: number,
    selected: number,
) {
    const menu = remoteSearchMenuUIs.get(id);
    if (menu) {
        menu.onSelectionChanged(selected);
    }
}

export class RemoteSearchMenuUI implements SearchMenuUI {
    private readonly id: number = remoteSearchMenuUINextId++;
    private closed: boolean = false;
    // Mirror the selection state of the remote LocalSearchMenuUI so we can
    // synchronously answer selectCompletion() and let callers fall through
    // to default key handling when no item is selected.
    private selected: number = -1;
    private itemCount: number = 0;
    private firstUpdate: boolean = true;
    constructor(
        public readonly onCompletion: (item: SearchMenuItem) => void,
        private readonly visibleItemsCount = 15,
    ) {
        remoteSearchMenuUIs.set(this.id, this);
    }

    update(data: SearchMenuUIUpdateData) {
        if (this.closed) {
            return;
        }
        if (data.items !== undefined) {
            this.itemCount = data.items.length;
            this.selected = this.firstUpdate ? -1 : 0;
            this.firstUpdate = false;
        }
        getClientAPI().searchMenuUpdate(this.id, {
            ...data,
            visibleItemsCount: this.visibleItemsCount,
        });
    }
    adjustSelection(deltaY: number): void {
        if (this.closed) {
            return;
        }
        if (deltaY > 0 && this.selected < this.itemCount - 1) {
            this.selected++;
        } else if (deltaY < 0 && this.selected > 0) {
            this.selected--;
        }
        getClientAPI().searchMenuAdjustSelection(this.id, deltaY);
    }
    scrollBy(deltaY: number): void {
        if (this.closed) {
            return;
        }
        getClientAPI().searchMenuScroll(this.id, deltaY);
    }
    selectCompletion(): boolean {
        if (this.closed) {
            return false;
        }
        if (this.selected < 0 || this.selected >= this.itemCount) {
            return false;
        }
        getClientAPI().searchMenuSelectCompletion(this.id);
        return true;
    }
    /** @internal Called by host when remote view reports a selection change. */
    onSelectionChanged(selected: number): void {
        if (this.closed) {
            return;
        }
        this.selected = selected;
    }
    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        getClientAPI().searchMenuClose(this.id);
        remoteSearchMenuUIs.delete(this.id);
    }
}
