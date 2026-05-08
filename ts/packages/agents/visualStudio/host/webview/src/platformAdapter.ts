// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PlatformAdapter } from "chat-ui";

// WebView2 exposes window.chrome.webview.postMessage for posting JSON to the host.
// The C# host (ChatToolWindowControl.OnWebMessageReceived) opens external URLs
// via Process.Start so links from chat content open in the user's default browser.
declare global {
    interface Window {
        chrome?: {
            webview?: {
                postMessage(message: unknown): void;
            };
        };
    }
}

export const vsPlatformAdapter: PlatformAdapter = {
    handleLinkClick(href: string) {
        const webview = window.chrome?.webview;
        if (webview) {
            webview.postMessage({ type: "openExternal", url: href });
        } else {
            // Dev fallback (vite dev server, no WebView2 host)
            window.open(href, "_blank");
        }
    },
};
