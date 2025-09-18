// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client, ClientAPI } from "../../preload/electronTypes.js";
import { createClientIORpcServer } from "agent-dispatcher/rpc/clientio/server";
import { createGenericChannel } from "agent-rpc/channel";
import { createDispatcherRpcClient } from "agent-dispatcher/rpc/dispatcher/client";

const clientIOChannel = createGenericChannel((message: any) =>
    globalThis.ws.send(
        JSON.stringify({
            message: "clientio-rpc-reply",
            data: message,
        }),
    ),
);

let client: Client | undefined = undefined;
function registerClient(c: Client) {
    if (client !== undefined) {
        throw new Error("Client already registered");
    }

    // Establish the clientIO RPC
    client = c;
    createClientIORpcServer(client.clientIO, clientIOChannel.channel);
}

export const webapi: ClientAPI = {
    registerClient,
    getSpeechToken: async () => {
        // We are not auth in this case and instead will rely on the device to provide speech reco
        return undefined;
    },
    getLocalWhisperStatus: async () => {
        // local whisper not supported on mobile
        return false;
    },
    openImageFile: () => {
        // not supported on mobile
    },
    getChatHistory: async () => {
        return undefined;
    },
    saveChatHistory: () => {
        // not supported on mobile
    },
    saveSettings: () => {
        // not supported on mobile
    },
    openFolder: () => {
        // not supported on mobile
    },
    openUrlInBrowserTab: () => {
        // not supported on mobile
    },
    searchMenuUpdate: () => {
        // not supported on mobile
        throw new Error("Not implemented");
    },
    searchMenuAdjustSelection: () => {
        // not supported on mobile
        throw new Error("Not implemented");
    },
    searchMenuSelectCompletion: () => {
        // not supported on mobile
        throw new Error("Not implemented");
    },
    searchMenuClose: () => {
        // not supported on mobile
        throw new Error("Not implemented");
    },
};

const dispatcherChannel = createGenericChannel((message: any) =>
    globalThis.ws.send(
        JSON.stringify({
            message: "dispatcher-rpc-call",
            data: message,
        }),
    ),
);

export const webdispatcher = createDispatcherRpcClient(
    dispatcherChannel.channel,
);

export async function createWebSocket(autoReconnect: boolean = true) {
    let url = window.location;
    let protocol = url.protocol.toLowerCase() == "https:" ? "wss" : "ws";
    let port = url.hostname.toLowerCase() == "localhost" ? ":3000" : "";

    const endpoint = `${protocol}://${url.hostname}${port}`;

    return new Promise<WebSocket | undefined>((resolve) => {
        console.log(`opening web socket to ${endpoint} `);
        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open" + event);
            resolve(webSocket);
        };

        // messages from the typeAgent server appear here
        webSocket.onmessage = (event: any) => {
            console.log("websocket message: " + JSON.stringify(event));

            const msgObj = JSON.parse(event.data);
            console.log(msgObj);
            switch (msgObj.message) {
                case "clientio-rpc-call":
                    clientIOChannel.message(msgObj.data);
                    break;

                case "dispatcher-rpc-reply":
                    dispatcherChannel.message(msgObj.data);
                    break;

                case "setting-summary-changed":
                    client?.updateRegisterAgents(msgObj.data.registeredAgents);
                    break;
                /* TODO: Not implemented yet.
                case "listen-event":
                    const { name, token, useLocalWhisper } = msgObj.data;
                    client?.listen(name, token, useLocalWhisper);
                    break;
                case "send-input-text":
                    client?.sendInputText(msgObj.data.message);
                    break;
                case "send-demo-event":
                    // TODO: Not implemented yet.
                    break;
                case "show-dialog":
                    client?.showDialog(msgObj.data.key);
                    break;

                case "settings-changed":
                    client?.updateSettings(msgObj.data.value);
                    break;
                case "file-selected":
                    client?.fileSelected(
                        msgObj.data.fileName,
                        msgObj.data.fileContent,
                    );
                    break;
*/
                default:
                    console.warn(
                        `websocket message not handled: ${msgObj.message}`,
                    );
                    break;
            }
        };
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed" + event);
            resolve(undefined);

            // reconnect?
            if (autoReconnect) {
                createWebSocket().then((ws) => (globalThis.ws = ws));
            } else {
                clientIOChannel.disconnect();
                dispatcherChannel.disconnect();
            }
        };
        webSocket.onerror = (event: object) => {
            console.log("websocket error" + event);
            resolve(undefined);
        };
    });
}

export function keepWebSocketAlive(webSocket: WebSocket, source: string) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    source: `${source}`,
                    target: "none",
                    messageType: "keepAlive",
                    body: {},
                }),
            );
        } else {
            console.log("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}
