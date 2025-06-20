// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl } from "browser-typeagent/agent/interface";
import { ShellWindow } from "./shellWindow.js";

export function createInlineBrowserControl(
    shellWindow: ShellWindow,
): BrowserControl {
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
    };
}
