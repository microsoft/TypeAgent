// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getInstanceDir, getClientId } from "agent-dispatcher/helpers/data";
import { createClientIORpcClient } from "agent-dispatcher/rpc/clientio/client";
import { createDispatcherRpcServer } from "agent-dispatcher/rpc/dispatcher/server";
import { createGenericChannel } from "agent-rpc/channel";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import WebSocket from "ws";

export interface WebDispatcher {
    connect(ws: WebSocket): void;
    close(): void;
}
export async function createWebDispatcher(): Promise<WebDispatcher> {
    let ws: WebSocket | null = null;
    const clientIOChannel = createGenericChannel((message: any) =>
        ws?.send(
            JSON.stringify({
                message: "clientio-rpc-call",
                data: message,
            }),
        ),
    );

    const instanceDir = getInstanceDir();
    const clientIO = createClientIORpcClient(clientIOChannel.channel);
    const dispatcher = await createDispatcher("api", {
        appAgentProviders: getDefaultAppAgentProviders(instanceDir),
        persistSession: true,
        persistDir: instanceDir,
        enableServiceHost: true,
        metrics: true,
        dblogging: true,
        clientId: getClientId(),
        clientIO: clientIO,
        constructionProvider: getDefaultConstructionProvider(),
    });

    let settingSummary: string = "";
    const updateSettingSummary = (force: boolean = false) => {
        const newSettingSummary = dispatcher.getSettingSummary();
        if (force || newSettingSummary !== settingSummary) {
            settingSummary = newSettingSummary;
            ws?.send(
                JSON.stringify({
                    message: "setting-summary-changed",
                    data: {
                        registeredAgents: [
                            ...dispatcher.getTranslatorNameToEmojiMap(),
                        ],
                    },
                }),
            );
        }
    };

    async function processShellRequest(
        text: string,
        id: string,
        images: string[],
    ) {
        if (typeof text !== "string" || typeof id !== "string") {
            throw new Error("Invalid request");
        }
        console.log(dispatcher.getPrompt(), text);

        const result = await dispatcher.processCommand(text, id, images);

        updateSettingSummary();

        return result;
    }

    const patchedDispatcher = {
        ...dispatcher,
        processCommand: processShellRequest,
    };

    const dispatcherChannel = createGenericChannel((message: any) =>
        ws?.send(
            JSON.stringify({
                message: "dispatcher-rpc-reply",
                data: message,
            }),
        ),
    );
    createDispatcherRpcServer(patchedDispatcher, dispatcherChannel.channel);

    // messages from web clients arrive here
    return {
        connect: (newWebSocket: WebSocket) => {
            // Close existing connection.  Only support one client at a time.
            ws?.close();
            ws = newWebSocket;
            ws.on("message", async (message: string) => {
                try {
                    const msgObj = JSON.parse(message);
                    console.log(`Received ${msgObj.message} message`);

                    switch (msgObj.message) {
                        case "dispatcher-rpc-call":
                            dispatcherChannel.message(msgObj.data);
                            break;
                        case "clientio-rpc-reply":
                            clientIOChannel.message(msgObj.data);
                            break;
                    }
                } catch (e) {
                    console.warn(`WebSocket message not parsed. Error: ${e}`);
                }
            });

            ws.on("close", () => {
                console.log("Client disconnected");
                ws = null;
            });

            // Always update setting on first connect
            updateSettingSummary(true);
        },
        close: () => {
            dispatcher.close();
        },
    };
}
