// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createGenericChannel } from "agent-rpc/channel";
import { ShellWindow } from "./shellWindow.js";
import type { BrowserControl } from "browser-typeagent/agent/types";
import { createContentScriptRpcClient } from "browser-typeagent/contentScriptRpc/client";
import { ipcMain } from "electron";

export function createInlineBrowserControl(
    shellWindow: ShellWindow,
): BrowserControl {
    const contentScriptRpcChannel = createGenericChannel((message) => {
        shellWindow.inlineBrowser.webContents.send(
            "inline-browser-rpc-call",
            message,
        );
    });
    // REVIEW: How to handle multiple inline browser.
    ipcMain.on("inline-browser-rpc-reply", (_, message) => {
        contentScriptRpcChannel.message(message);
    });

    const contentScriptControl = createContentScriptRpcClient(
        contentScriptRpcChannel.channel,
    );
    return {
        async openWebPage(url: string) {
            return shellWindow.openInlineBrowser(new URL(url));
        },
        async closeWebPage() {
            if (!shellWindow.closeInlineBrowser()) {
                throw new Error("No inline browser is currently open.");
            }
        },
        async goForward() {
            const navigateHistory =
                shellWindow.inlineBrowser.webContents.navigationHistory;
            if (!navigateHistory.canGoForward()) {
                throw new Error("Cannot go forward in history");
            }
            navigateHistory.goForward();
        },
        async goBack() {
            const navigateHistory =
                shellWindow.inlineBrowser.webContents.navigationHistory;
            if (!navigateHistory.canGoBack()) {
                throw new Error("Cannot go back in history");
            }
            navigateHistory.goBack();
        },
        async reload() {
            shellWindow.inlineBrowser.webContents.reload();
        },
        async getPageUrl() {
            return shellWindow.inlineBrowser.webContents.getURL();
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
            const webContents = shellWindow.inlineBrowser.webContents;
            webContents.setZoomFactor(webContents.getZoomFactor() + 0.1);
        },
        async zoomOut() {
            const url = await this.getPageUrl();
            if (url.startsWith("https://paleobiodb.org/")) {
                return contentScriptControl.runPaleoBioDbAction({
                    actionName: "zoomOut",
                });
            }
            const webContents = shellWindow.inlineBrowser.webContents;
            webContents.setZoomFactor(webContents.getZoomFactor() - 0.1);
        },
        async zoomReset() {
            const webContents = shellWindow.inlineBrowser.webContents;
            webContents.setZoomFactor(1.0);
        },
        async followLinkByPosition(position: number, openInNewTab?: boolean) {
            if (openInNewTab) {
                // TODO: Support opening in new browser view.
                throw new Error(
                    "New tab opening is not supported in inline browser.",
                );
            }
            const url =
                await contentScriptControl.getPageLinksByPosition(position);
            if (url) {
                await shellWindow.openInlineBrowser(new URL(url));
            }
            return url;
        },
        async followLinkByText(keywords: string, openInNewTab?: boolean) {
            if (openInNewTab) {
                // TODO: Support opening in new browser view.
                throw new Error(
                    "New tab opening is not supported in inline browser.",
                );
            }
            const url =
                await contentScriptControl.getPageLinksByQuery(keywords);
            if (url) {
                await shellWindow.openInlineBrowser(new URL(url));
            }
            return url;
        },
        async closeWindow() {
            throw new Error(
                "Closing the inline browser window is not supported.",
            );
        },
    };
}
