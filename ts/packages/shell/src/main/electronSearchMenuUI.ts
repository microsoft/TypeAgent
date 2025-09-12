// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadLocalWebContents } from "./utils.js";
import { ipcMain, WebContents, WebContentsView } from "electron";
import { ShellWindow } from "./shellWindow.js";
import type { SearchMenuUIUpdateData } from "../preload/electronTypes.js";
import path from "node:path";
import registerDebug from "debug";
const debug = registerDebug("typeagent:shell:searchMenuUI");
const debugError = registerDebug("typeagent:shell:searchMenuUI:error");

const searchMenuUIs: Map<number, Promise<WebContentsView>> = new Map();
const searchMenuIds: Map<WebContents, number> = new Map();

async function createSearchMenuUIView(_zoomFactor: number) {
    const searchMenuView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, "../preload/expose.mjs"),
            sandbox: false,
            // zoomFactor,
        },
    });
    searchMenuView.setBackgroundColor("#00000000"); // Transparent

    const p = Promise.withResolvers<WebContentsView>();
    const onReady = (event: Electron.IpcMainEvent) => {
        if (event.sender === searchMenuView.webContents) {
            ipcMain.removeListener("search-menu-ready", onReady);
            debug("search-menu-ready");
            p.resolve(searchMenuView);
        }
    };
    ipcMain.on("search-menu-ready", onReady);
    try {
        await loadLocalWebContents(
            searchMenuView.webContents,
            "searchMenuView.html",
        );
    } catch (err) {
        p.reject(err);
    }
    return p.promise;
}

export function initializeSearchMenuUI(shellWindow: ShellWindow) {
    ipcMain.on(
        "search-menu-update",
        async (event, id, data: SearchMenuUIUpdateData) => {
            if (event.sender !== shellWindow.chatView.webContents) {
                debugError("Invalid sender for search-menu-update");
                return;
            }

            let searchMenuViewP = searchMenuUIs.get(id);
            if (searchMenuViewP === undefined) {
                searchMenuViewP = createSearchMenuUIView(
                    shellWindow.chatView.webContents.getZoomFactor(),
                );
                searchMenuUIs.set(id, searchMenuViewP);
            }
            const searchMenuView = await searchMenuViewP;
            debug(`search-menu-update: ${id} ${JSON.stringify(data)}`);
            searchMenuIds.set(searchMenuView.webContents, id);
            if (data.position) {
                shellWindow.updateOverlayWebContentsView(
                    searchMenuView,
                    data.position,
                );
                data.position = undefined;
            }
            if (data.prefix !== undefined || data.items !== undefined) {
                searchMenuView.webContents.send("search-menu-update", data);
            }
        },
    );

    function setupProxy(
        name: string,
        after?: (id: number, searchMenuView: WebContentsView) => void,
    ) {
        ipcMain.on(name, async (event, id, ...args) => {
            if (event.sender !== shellWindow.chatView.webContents) {
                debugError(`Invalid sender for ${name}`);
                return;
            }

            const searchMenuViewP = searchMenuUIs.get(id);
            if (searchMenuViewP === undefined) {
                debugError(`Invalid id  ${id} for ${name}`);
                return;
            }

            debug(`${name}: ${id} ${JSON.stringify(args)}`);
            const searchMenuView = await searchMenuViewP;
            searchMenuView.webContents.send(name, ...args);
            after?.(id, searchMenuView);
        });
    }

    setupProxy("search-menu-adjust-selection");
    setupProxy("search-menu-select-completion");
    setupProxy(
        "search-menu-close",
        (id: number, searchMenuView: WebContentsView) => {
            searchMenuUIs.delete(id);
            // Update with no position to remove
            shellWindow.updateOverlayWebContentsView(searchMenuView);
        },
    );

    ipcMain.on("search-menu-completion", async (event, item) => {
        const id = searchMenuIds.get(event.sender);
        if (id === undefined) {
            return;
        }
        shellWindow.chatView.webContents.send(
            "search-menu-completion",
            id,
            item,
        );
    });

    ipcMain.on("search-menu-size", async (event, size) => {
        const id = searchMenuIds.get(event.sender);
        if (id === undefined) {
            return;
        }
        const searchMenuViewP = await searchMenuUIs.get(id);
        if (searchMenuViewP === undefined) {
            return undefined;
        }
        const view = await searchMenuViewP;
        debug(`search-menu-size: ${id} ${JSON.stringify(size)}`);
        shellWindow.updateOverlayWebContentsView(view, size);
    });
}
