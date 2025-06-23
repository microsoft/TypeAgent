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
            shellWindow.closeInlineBrowser();
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
    };
}
