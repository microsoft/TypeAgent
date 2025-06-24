// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import { BrowserControl } from "../interface.mjs";
import { createGenericChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { WebSocketMessageV2 } from "common-utils";

type BrowserControlInvokeFunctions = {
    goForward: () => Promise<void>;
    goBack: () => Promise<void>;
    reload: () => Promise<void>;
};

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

    const rpc = createRpc<BrowserControlInvokeFunctions>(
        browserControlChannel.channel,
    );
    return {
        openWebPage: async (url: string) => {
            throw new Error(
                "openWebPage not implement in external browser control",
            );
        },
        closeWebPage: async () => {
            throw new Error(
                "closeWebPage not implement in external browser control",
            );
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
    };
}
