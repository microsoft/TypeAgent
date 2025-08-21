// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createGenericChannel } from "agent-rpc/channel";
import { ShellWindow } from "./shellWindow.js";
import type { BrowserControl, SearchProvider } from "browser-typeagent/agent/types";
import { createContentScriptRpcClient } from "browser-typeagent/contentScriptRpc/client";
import { ipcMain } from "electron";

export function createInlineBrowserControl(
    shellWindow: ShellWindow,
): BrowserControl {
    // Helper function to get the active browser WebContents for automation
    function getActiveBrowserWebContents() {
        // Always use multi-tab browser
        const activeBrowserView = shellWindow.getActiveBrowserView();
        if (!activeBrowserView) {
            throw new Error("No active browser tab available");
        }
        return activeBrowserView.webContentsView.webContents;
    }
    const contentScriptRpcChannel = createGenericChannel((message) => {
        try {
            const webContents = getActiveBrowserWebContents();
            webContents.send("inline-browser-rpc-call", message);
        } catch (error) {
            console.warn("Failed to send RPC message to browser:", error);
        }
    });

    // Handle RPC replies from browser views
    ipcMain.on("inline-browser-rpc-reply", (_, message) => {
        contentScriptRpcChannel.message(message);
    });

    const contentScriptControl = createContentScriptRpcClient(
        contentScriptRpcChannel.channel,
    );
    return {
        async openWebPage(url: string, options?: { newTab?: boolean }) {
            // Always use multi-tab approach
            shellWindow.createBrowserTab(new URL(url), {
                background: options?.newTab === true ? true : false,
            });
            return Promise.resolve();
        },
        async closeWebPage() {
            // Always use multi-tab browser
            const activeBrowserView = shellWindow.getActiveBrowserView();
            if (!activeBrowserView) {
                throw new Error("No browser tab is currently open.");
            }

            if (!shellWindow.closeBrowserTab(activeBrowserView.id)) {
                throw new Error("Failed to close active browser tab.");
            }
        },
        async goForward() {
            if (!shellWindow.browserGoForward()) {
                throw new Error("Cannot go forward in history");
            }
        },
        async goBack() {
            if (!shellWindow.browserGoBack()) {
                throw new Error("Cannot go back in history");
            }
        },
        async reload() {
            if (!shellWindow.browserReload()) {
                throw new Error("No active browser to reload");
            }
        },
        async getPageUrl() {
            const webContents = getActiveBrowserWebContents();
            return webContents.getURL();
        },
        setAgentStatus(isBusy: boolean, message: string) {
            console.log(`${message} (isBusy: ${isBusy})`);
        },
        async scrollUp() {
            return contentScriptControl.scrollUp();
        },
        async scrollDown() {
            return contentScriptControl.scrollDown();
        },
        async zoomIn() {
            const url = await this.getPageUrl();
            if (url.startsWith("https://paleobiodb.org/")) {
                return contentScriptControl.runPaleoBioDbAction({
                    actionName: "zoomIn",
                });
            }
            const webContents = getActiveBrowserWebContents();
            webContents.setZoomFactor(webContents.getZoomFactor() + 0.1);
        },
        async zoomOut() {
            const url = await this.getPageUrl();
            if (url.startsWith("https://paleobiodb.org/")) {
                return contentScriptControl.runPaleoBioDbAction({
                    actionName: "zoomOut",
                });
            }
            const webContents = getActiveBrowserWebContents();
            webContents.setZoomFactor(webContents.getZoomFactor() - 0.1);
        },
        async zoomReset() {
            const webContents = getActiveBrowserWebContents();
            webContents.setZoomFactor(1.0);
        },
        async followLinkByPosition(position: number, openInNewTab?: boolean) {
            const url =
                await contentScriptControl.getPageLinksByPosition(position);
            if (url) {
                if (openInNewTab) {
                    // Create new tab for the URL
                    shellWindow.createBrowserTab(new URL(url), {
                        background: false,
                    });
                } else {
                    // Navigate current tab or create new tab if none exists
                    const activeBrowserView =
                        shellWindow.getActiveBrowserView();
                    if (activeBrowserView) {
                        activeBrowserView.webContentsView.webContents.loadURL(
                            url,
                        );
                    } else {
                        shellWindow.createBrowserTab(new URL(url), {
                            background: false,
                        });
                    }
                }
            }
            return url;
        },
        async followLinkByText(keywords: string, openInNewTab?: boolean) {
            const url =
                await contentScriptControl.getPageLinksByQuery(keywords);
            if (url) {
                if (openInNewTab) {
                    // Create new tab for the URL
                    shellWindow.createBrowserTab(new URL(url), {
                        background: false,
                    });
                } else {
                    // Navigate current tab or create new tab if none exists
                    const activeBrowserView =
                        shellWindow.getActiveBrowserView();
                    if (activeBrowserView) {
                        activeBrowserView.webContentsView.webContents.loadURL(
                            url,
                        );
                    } else {
                        shellWindow.createBrowserTab(new URL(url), {
                            background: false,
                        });
                    }
                }
            }
            return url;
        },
        async closeWindow() {
            throw new Error(
                "Closing the inline browser window is not supported.",
            );
        },
        async search(query: string, searchProvider: SearchProvider) {
            const searchUrl = new URL(
                searchProvider ? searchProvider.url.replace("%s", encodeURIComponent(query)) :
                "https://www.bing.com/search?q=" + encodeURIComponent(query),
            );

            // Always use tabs
            shellWindow.createBrowserTab(searchUrl, { background: false });
        },
        async readPage() {
            throw new Error("Reading page is not supported in inline browser.");
        },
        async stopReadPage() {
            throw new Error(
                "Stopping reading page is not supported in inline browser.",
            );
        },
        async captureScreenshot() {
            const webContents = getActiveBrowserWebContents();
            const image = await webContents.capturePage();
            return `data:image/png;base64,${image.toPNG().toString("base64")}`;
        },
    };
}
