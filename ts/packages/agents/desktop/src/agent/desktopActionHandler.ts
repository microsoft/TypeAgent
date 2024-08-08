// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import { DispatcherAction, DispatcherAgentContext } from "dispatcher-agent";

export function instantiate() {
    return {
        initializeAgentContext: initializeDesktopContext,
        updateAgentContext: updateDesktopContext,
        executeAction: executeDesktopAction,
    };
}

type DesktopActionContext = {
    webSocket: WebSocket | undefined;
};

function initializeDesktopContext(): DesktopActionContext {
    return {
        webSocket: undefined,
    };
}

async function updateDesktopContext(
    enable: boolean,
    context: DispatcherAgentContext<DesktopActionContext>,
): Promise<void> {
    if (enable) {
        if (context.context.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            context.context.webSocket = webSocket;
            webSocket.onclose = (event: Object) => {
                console.error("Desktop webSocket connection closed.");
                context.context.webSocket = undefined;
            };
            webSocket.onmessage = async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text) as WebSocketMessage;
                if (
                    data.target == "dispatcher" &&
                    data.source == "desktop" &&
                    data.body
                ) {
                    switch (data.messageType) {
                        case "confirmAction": {
                            const requestIO = context.requestIO;
                            const requestId = context.requestId;
                            if (
                                requestIO &&
                                requestId &&
                                data.id === requestId
                            ) {
                                requestIO.status(data.body);
                            }

                            break;
                        }
                    }
                }
            };
        }
    } else {
        const webSocket = context.context.webSocket;
        if (webSocket) {
            webSocket.onclose = null;
            webSocket.close();
        }

        context.context.webSocket = undefined;
    }
}

async function executeDesktopAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<DesktopActionContext>,
) {
    const webSocketEndpoint = context.context.webSocket;
    if (webSocketEndpoint) {
        try {
            const requestId = context.requestId;
            webSocketEndpoint.send(
                JSON.stringify({
                    source: "dispatcher",
                    target: "desktop",
                    messageType: "translatedAction",
                    id: requestId,
                    body: action,
                }),
            );
        } catch {
            throw new Error("Unable to contact desktop backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}
