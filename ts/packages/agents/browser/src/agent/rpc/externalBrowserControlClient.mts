// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import {
    BrowserControl,
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../browserControl.mjs";
import { createGenericChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { WebSocketMessageV2 } from "common-utils";

export function createExternalBrowserClient(
    webSocket: WebSocket,
): BrowserControl {
    const browserControlChannel = createGenericChannel((message) => {
        // Message to the browser extension
        webSocket.send(
            JSON.stringify({
                source: "browserAgent",
                method: "browserControl/message",
                params: message,
            }),
        );
    });

    webSocket.on("message", (message) => {
        // Message from the browser extension
        const text = message.toString();
        const data: WebSocketMessageV2 = JSON.parse(text);
        if (
            data.source === "browserExtension" &&
            data.method === "browserControl/message"
        ) {
            browserControlChannel.message(data.params);
        }
    });

    webSocket.on("close", () => {
        browserControlChannel.disconnect();
    });

    const rpc = createRpc<
        BrowserControlInvokeFunctions,
        BrowserControlCallFunctions
    >("browser:extension", browserControlChannel.channel);

    return {
        openWebPage: async (url: string) => {
            return rpc.invoke("openWebPage", url);
        },
        closeWebPage: async () => {
            return rpc.invoke("closeWebPage");
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
    };
}
