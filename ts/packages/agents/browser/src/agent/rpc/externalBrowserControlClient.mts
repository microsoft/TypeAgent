// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserControl } from "../../common/browserControl.mjs";
import { AgentWebSocketServer } from "../agentWebSocketServer.mjs";

export interface ExternalBrowserClient {
    control: BrowserControl;
    dispose: () => void;
}

export function createExternalBrowserClient(
    agentWebSocketServer: AgentWebSocketServer,
    sessionId: string,
): ExternalBrowserClient {
    function getActiveRpc() {
        const client = agentWebSocketServer.getActiveClient(
            sessionId,
            "extension",
        );
        if (!client?.browserControlRpc) {
            throw new Error("No browser control connection available");
        }
        return client.browserControlRpc;
    }

    const control: BrowserControl = {
        openWebPage: async (...args) =>
            getActiveRpc().invoke("openWebPage", ...args),
        closeWebPage: async () => getActiveRpc().invoke("closeWebPage"),
        closeAllWebPages: async () => getActiveRpc().invoke("closeAllWebPages"),
        switchTabs: async (...args) =>
            getActiveRpc().invoke("switchTabs", ...args),
        goForward: async () => getActiveRpc().invoke("goForward"),
        goBack: async () => getActiveRpc().invoke("goBack"),
        reload: async () => getActiveRpc().invoke("reload"),
        getPageUrl: async () => getActiveRpc().invoke("getPageUrl"),
        setAgentStatus: (...args) =>
            getActiveRpc().send("setAgentStatus", ...args),
        scrollUp: async () => getActiveRpc().invoke("scrollUp"),
        scrollDown: async () => getActiveRpc().invoke("scrollDown"),
        zoomIn: async () => getActiveRpc().invoke("zoomIn"),
        zoomOut: async () => getActiveRpc().invoke("zoomOut"),
        zoomReset: async () => getActiveRpc().invoke("zoomReset"),
        followLinkByText: (...args) =>
            getActiveRpc().invoke("followLinkByText", ...args),
        followLinkByPosition: (...args) =>
            getActiveRpc().invoke("followLinkByPosition", ...args),
        closeWindow: async () => getActiveRpc().invoke("closeWindow"),
        search: async (query?: string) =>
            getActiveRpc().invoke("search", query),
        readPageContent: async () => getActiveRpc().invoke("readPageContent"),
        stopReadPageContent: async () =>
            getActiveRpc().invoke("stopReadPageContent"),
        captureScreenshot: async () =>
            getActiveRpc().invoke("captureScreenshot"),
        getPageTextContent: async () =>
            getActiveRpc().invoke("getPageTextContent"),
        getAutoIndexSetting: async () =>
            getActiveRpc().invoke("getAutoIndexSetting"),
        getBrowserSettings: async () =>
            getActiveRpc().invoke("getBrowserSettings"),
        getHtmlFragments: async (...args) =>
            getActiveRpc().invoke("getHtmlFragments", ...args),
        clickOn: async (...args) => getActiveRpc().invoke("clickOn", ...args),
        setDropdown: async (...args) =>
            getActiveRpc().invoke("setDropdown", ...args),
        enterTextIn: async (...args) =>
            getActiveRpc().invoke("enterTextIn", ...args),
        awaitPageLoad: async (...args) =>
            getActiveRpc().invoke("awaitPageLoad", ...args),
        awaitPageInteraction: async (...args) =>
            getActiveRpc().invoke("awaitPageInteraction", ...args),
        downloadImage: async (...args) =>
            getActiveRpc().invoke("downloadImage", ...args),
        runBrowserAction: async (...args) =>
            getActiveRpc().invoke("runBrowserAction", ...args),
    };

    return { control, dispose: () => {} };
}
