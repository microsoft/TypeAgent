// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createGenericChannel } from "agent-rpc/channel";
import { ShellWindow } from "./shellWindow.js";
import type {
    BrowserControl,
    SearchProvider,
} from "browser-typeagent/agent/types";
import { createContentScriptRpcClient } from "browser-typeagent/contentScriptRpc/client";
import { ipcMain } from "electron";
import { openai } from "aiclient";
import {
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateEmbedding,
} from "typeagent";

export function createInlineBrowserControl(
    shellWindow: ShellWindow,
): BrowserControl {
    // Helper function to get the active browser WebContents for automation
    function getActiveBrowserWebContents() {
        const activeBrowserView = shellWindow.getActiveBrowserView();
        if (!activeBrowserView) {
            throw new Error(
                "No browser tabs are currently open. Please open a browser tab to continue.",
            );
        }
        return activeBrowserView.webContentsView.webContents;
    }
    const contentScriptRpcChannel = createGenericChannel((message) => {
        const webContents = getActiveBrowserWebContents();
        webContents.send("inline-browser-rpc-call", message);
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
            const activeTab = shellWindow.getActiveBrowserView();
            if (options?.newTab || !activeTab) {
                shellWindow.createBrowserTab(new URL(url), {
                    background: options?.newTab === true ? false : true,
                });
            } else {
                activeTab.webContentsView.webContents.loadURL(url);
            }
            return Promise.resolve();
        },
        async closeWebPage() {
            // Always use multi-tab browser
            const activeBrowserView = shellWindow.getActiveBrowserView();
            if (!activeBrowserView) {
                throw new Error(
                    "No browser tabs are currently open. Please open a browser tab to continue.",
                );
            }

            if (!shellWindow.closeBrowserTab(activeBrowserView.id)) {
                throw new Error("Failed to close active browser tab.");
            }
        },
        async closeAllWebPages() {
            shellWindow.getAllBrowserTabs().forEach((tab) => {
                shellWindow.closeBrowserTab(tab.id);
            });
        },
        async switchTabs(
            tabDescription: string,
            tabIndex?: number,
        ): Promise<boolean> {
            const tabs = shellWindow.getAllBrowserTabs();

            if (tabs.length <= 1) {
                throw new Error("No other tabs to switch to!");
            }

            // if an index is specified prefer it over the description
            if (tabIndex) {
                if (tabIndex - 1 < tabs.length && tabIndex - 1 >= 0) {
                    const targetTab = tabs[tabIndex - 1];
                    shellWindow.switchBrowserTab(targetTab.id);
                    return true;
                } else {
                    throw new Error(`There is no tab with index ${tabIndex}.`);
                }
            }

            // try to get tab by description
            const ids: string[] = [];
            const score_threshold = 0.85;
            const titleEmbedding: NormalizedEmbedding[] = [];
            const urlEmbedding: NormalizedEmbedding[] = [];
            const embeddingModel = openai.createEmbeddingModel();
            const queryEmbedding = await generateEmbedding(
                embeddingModel,
                tabDescription,
            );

            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                ids.push(tab.id.toString());
                titleEmbedding.push(
                    await generateEmbedding(
                        embeddingModel,
                        tab.webContentsView.webContents.getTitle(),
                    ),
                );
                urlEmbedding.push(
                    await generateEmbedding(
                        embeddingModel,
                        tab.webContentsView.webContents.getURL(),
                    ),
                );
            }

            const topNTitle = indexesOfNearest(
                titleEmbedding,
                queryEmbedding,
                1,
                SimilarityType.Dot,
            );
            const topNUrl = indexesOfNearest(
                urlEmbedding,
                queryEmbedding,
                1,
                SimilarityType.Dot,
            );

            const idx =
                topNTitle[0].score > topNUrl[0].score
                    ? topNTitle[0].item
                    : topNUrl[0].item;
            const maxScore = Math.max(topNTitle[0].score, topNUrl[0].score);

            if (maxScore < score_threshold) {
                throw new Error(
                    `No matching tabs found for '${tabDescription}'.`,
                );
            }

            return await shellWindow.switchBrowserTab(ids[idx]);
        },
        async goForward() {
            if (!shellWindow.browserGoForward()) {
                throw new Error(
                    "Cannot go forward in browser history. No active browser tab or no forward history available.",
                );
            }
        },
        async goBack() {
            if (!shellWindow.browserGoBack()) {
                throw new Error(
                    "Cannot go back in browser history. No active browser tab or no back history available.",
                );
            }
        },
        async reload() {
            if (!shellWindow.browserReload()) {
                throw new Error(
                    "Cannot reload page. No browser tabs are currently open.",
                );
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
        async search(
            query: string,
            sites: string[],
            searchProvider: SearchProvider,
            options: { waitForPageLoad?: boolean; newTab?: boolean } = {},
        ): Promise<URL> {
            // append any site specific scoping
            if (sites && sites.length > 0) {
                sites.forEach((site) => {
                    query += ` site:${site}`;
                });
            }

            // craft the search URL
            const searchUrl = new URL(
                searchProvider
                    ? searchProvider.url.replace(
                          "%s",
                          encodeURIComponent(query),
                      )
                    : "https://www.bing.com/search?q=" +
                      encodeURIComponent(query),
            );

            // Always use tabs
            const activeTab = shellWindow.getActiveBrowserView();
            if (options?.newTab || !activeTab) {
                await shellWindow.createBrowserTab(searchUrl, {
                    background: false,
                    waitForPageLoad: options?.waitForPageLoad,
                });
            } else {
                activeTab.webContentsView.webContents.loadURL(
                    searchUrl.toString(),
                );
            }

            return searchUrl;
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
        async getPageContents(): Promise<string> {
            const webContents = getActiveBrowserWebContents();
            return webContents.executeJavaScript("document.body.innerText");
        },
    };
}
