// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientIO } from "agent-dispatcher";
import { ClientAPI, SpeechToken } from "../../preload/electronTypes";
import { createClientIORpcServer } from "agent-dispatcher/rpc/clientio/server";
import { createGenericChannel } from "agent-rpc/channel";
import { createDispatcherRpcClient } from "agent-dispatcher/rpc/dispatcher/client";

const fnMap: Map<string, any> = new Map<string, any>();

function placeHolder(category: string, callback: any) {
    console.log(category + "\n" + JSON.stringify(callback));
}

let clientIORegistered = false;
export const webapi: ClientAPI = {
    // TODO: implement
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => placeHolder("listen-event", callback),
    onSettingSummaryChanged(callback) {
        fnMap.set("setting-summary-changed", callback);
    },

    getSpeechToken: () => {
        return new Promise<SpeechToken | undefined>(async (resolve) => {
            // We are not auth in this case and instead will rely on the device to provide speech reco
            resolve(undefined);
        });
    },
    getLocalWhisperStatus: () => {
        // local whisper not supported on mobile
        return new Promise<boolean | undefined>((resolve) => {
            resolve(false);
        });
    },
    onSendInputText(callback) {
        // doesn't apply on mobile
        fnMap.set("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        // doesn't apply on mobile
        fnMap.set("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        // no longer supported (i.e. F1 key)
        fnMap.set("help-requested", callback);
    },
    onShowDialog(callback) {
        // not supported without @shell command
        // TODO: inject replacement on mobile?
        fnMap.set("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        // only applies if we make the mobile agent for settings
        // TODO: figure out solution for mobile
        fnMap.set("settings-changed", callback);
    },
    onChatHistory(callback) {
        // TODO: implement proper message rehydration on mobile
        fnMap.set("chat-history", callback);
    },
    registerClientIO(clientIO: ClientIO) {
        if (clientIORegistered) {
            throw new Error("ClientIO already registered");
        }
        clientIORegistered = true;
        createClientIORpcServer(clientIO, clientIOChannel.channel);
    },
};

const clientIOChannel = createGenericChannel((message: any) =>
    globalThis.ws.send(
        JSON.stringify({
            message: "clientio-rpc-reply",
            data: message,
        }),
    ),
);
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
                    let agentsMap: Map<string, string> = new Map<
                        string,
                        string
                    >(msgObj.data.registeredAgents);
                    fnMap.get("setting-summary-changed")(
                        undefined,
                        msgObj.data.summary,
                        agentsMap,
                    );
                    break;

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
