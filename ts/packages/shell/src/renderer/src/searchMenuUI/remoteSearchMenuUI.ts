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

export class RemoteSearchMenuUI implements SearchMenuUI {
    private readonly id: number = remoteSearchMenuUINextId++;
    private closed: boolean = false;
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
        getClientAPI().searchMenuUpdate(this.id, {
            ...data,
            visibleItemsCount: this.visibleItemsCount,
        });
    }
    adjustSelection(deltaY: number): void {
        if (this.closed) {
            return;
        }
        getClientAPI().searchMenuAdjustSelection(this.id, deltaY);
    }
    selectCompletion(): void {
        if (this.closed) {
            return;
        }
        getClientAPI().searchMenuSelectCompletion(this.id);
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
