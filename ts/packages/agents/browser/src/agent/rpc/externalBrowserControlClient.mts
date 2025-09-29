// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import {
    BrowserControl,
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../../common/browserControl.mjs";
import { createGenericChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { WebSocketMessageV2 } from "common-utils";
import { AgentWebSocketServer } from "../agentWebSocketServer.mjs";

export function createExternalBrowserClient(
    agentWebSocketServer: AgentWebSocketServer,
): BrowserControl {
    const browserControlChannel = createGenericChannel((message) => {
        // Message to the active browser extension client (fallback to extension type only)
        const activeClient = agentWebSocketServer.getActiveClient("extension");
        if (activeClient && activeClient.socket.readyState === WebSocket.OPEN) {
            activeClient.socket.send(
                JSON.stringify({
                    source: "browserAgent",
                    method: "browserControl/message",
                    params: message,
                }),
            );
        }
    });

    // Add browser control message handling to existing message handler
    // This approach avoids replacing the entire handler and allows multiple instances
    const handleBrowserControlMessage = (client: any, message: string) => {
        try {
            const data: WebSocketMessageV2 = JSON.parse(message);
            if (
                data.source === "browserExtension" &&
                data.method === "browserControl/message"
            ) {
                browserControlChannel.message(data.params);
            }
        } catch (error) {
            // Ignore parsing errors for non-JSON messages
        }
    };

    // Store reference to our handler so it can be cleaned up if needed
    (browserControlChannel as any)._messageHandler =
        handleBrowserControlMessage;

    // Wrap the existing onClientMessage handler to include our browser control handling
    const originalOnClientMessage = agentWebSocketServer.onClientMessage;
    agentWebSocketServer.onClientMessage = (client, message) => {
        // Call the original handler first
        if (originalOnClientMessage) {
            originalOnClientMessage(client, message);
        }

        // Handle browser control messages
        handleBrowserControlMessage(client, message);
    };

    const rpc = createRpc<
        BrowserControlInvokeFunctions,
        BrowserControlCallFunctions
    >("browser:extension", browserControlChannel.channel);

    return {
        openWebPage: async (...args) => {
            return rpc.invoke("openWebPage", ...args);
        },
        closeWebPage: async () => {
            return rpc.invoke("closeWebPage");
        },
        closeAllWebPages: async () => {
            return rpc.invoke("closeAllWebPages");
        },
        switchTabs: async (...args) => {
            return rpc.invoke("switchTabs", ...args);
        },
        goForward: async () => {
            return rpc.invoke("goForward");
        },
        goBack: async () => {
            return rpc.invoke("goBack");
        },
        reload: async () => {
            return rpc.invoke("reload");
        },
        getPageUrl: async () => {
            return rpc.invoke("getPageUrl");
        },
        setAgentStatus: (...args) => {
            rpc.send("setAgentStatus", ...args);
        },
        scrollUp: async () => {
            return rpc.invoke("scrollUp");
        },
        scrollDown: async () => {
            return rpc.invoke("scrollDown");
        },
        zoomIn: async () => {
            return rpc.invoke("zoomIn");
        },
        zoomOut: async () => {
            return rpc.invoke("zoomOut");
        },
        zoomReset: async () => {
            return rpc.invoke("zoomReset");
        },
        followLinkByText: (...args) => {
            return rpc.invoke("followLinkByText", ...args);
        },
        followLinkByPosition: (...args) => {
            return rpc.invoke("followLinkByPosition", ...args);
        },
        closeWindow: async () => {
            return rpc.invoke("closeWindow");
        },

        search: async (query?: string) => {
            return rpc.invoke("search", query);
        },
        readPage: async () => {
            return rpc.invoke("readPageContent");
        },
        stopReadPage: async () => {
            return rpc.invoke("stopReadPageContent");
        },
        captureScreenshot: async () => {
            return rpc.invoke("captureScreenshot");
        },
        getPageTextContent: async () => {
            return rpc.invoke("getPageTextContent");
        },
        getAutoIndexSetting: async () => {
            return rpc.invoke("getAutoIndexSetting");
        },
        getBrowserSettings: async () => {
            return rpc.invoke("getBrowserSettings");
        },
        getHtmlFragments: async (...args) => {
            return rpc.invoke("getHtmlFragments", ...args);
        },
        clickOn: async (...args) => {
            return rpc.invoke("clickOn", ...args);
        },
        setDropdown: async (...args) => {
            return rpc.invoke("setDropdown", ...args);
        },
        enterTextIn: async (...args) => {
            return rpc.invoke("enterTextIn", ...args);
        },
        awaitPageLoad: async (...args) => {
            return rpc.invoke("awaitPageLoad", ...args);
        },
        awaitPageInteraction: async (...args) => {
            return rpc.invoke("awaitPageInteraction", ...args);
        },
    };
}
