// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IpcRenderer } from "electron";
import { LocalSearchMenuUI } from "./searchMenuUI/localSearchMenuUI";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:searchMenuView");

const ipcRenderer: IpcRenderer = (window as any).electron
    .ipcRenderer as IpcRenderer;

export function updateSearchMenuSize() {}

let searchMenuUI: LocalSearchMenuUI | undefined;
ipcRenderer.on("search-menu-update", (_event, data) => {
    debug(`search-menu-update: ${JSON.stringify(data)}`);
    if (searchMenuUI === undefined) {
        searchMenuUI = new LocalSearchMenuUI((item) => {
            ipcRenderer.send("search-menu-completion", item);
        }, data.visibleItemsCount);

        // REVIEW: Assume that search menu is the only thing on the page.
        const elm = document.body.children[0] as HTMLElement;
        const mutationObserver = new MutationObserver(() => {
            // 2px outline all around.
            ipcRenderer.send("search-menu-size", {
                width: elm.offsetWidth + 4,
                height: elm.offsetHeight + 4,
            });
        });
        mutationObserver.observe(elm, { childList: true });
    }

    searchMenuUI.update(data);
});

ipcRenderer.on("search-menu-close", () => {
    debug("search-menu-close");
    searchMenuUI?.close();
    searchMenuUI = undefined;
});

ipcRenderer.on("search-menu-adjust-selection", (_, deltaY) => {
    debug(`search-menu-adjust-selection: ${deltaY}}`);
    searchMenuUI?.adjustSelection(deltaY);
});

ipcRenderer.on("search-menu-select-completion", () => {
    debug("search-menu-select-completion");
    searchMenuUI?.selectCompletion();
});

ipcRenderer.send("search-menu-ready");
