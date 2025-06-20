// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import {
    BrowserControl,
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../interface.mjs";
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
            return rpc.invoke("closeWebPage", undefined);
        },
        goForward: async () => {
            return rpc.invoke("goForward", undefined);
        },
        goBack: async () => {
            return rpc.invoke("goBack", undefined);
        },
        reload: async () => {
            return rpc.invoke("reload", undefined);
        },
        getPageUrl: async () => {
            return rpc.invoke("getPageUrl", undefined);
        },
        setAgentStatus: (isBusy: boolean, message: string) => {
            rpc.send("setAgentStatus", {
                isBusy,
                message,
            });
        },
    };
}
