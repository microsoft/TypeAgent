// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import { AppAction, SessionContext } from "@typeagent/agent-sdk";

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
    context: SessionContext<DesktopActionContext>,
): Promise<void> {
    if (enable) {
        if (context.agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            context.agentContext.webSocket = webSocket;
            webSocket.onclose = (event: Object) => {
                console.error("Desktop webSocket connection closed.");
                context.agentContext.webSocket = undefined;
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
                            const agentIO = context.agentIO;
                            const requestId = context.requestId;
                            if (agentIO && requestId && data.id === requestId) {
                                agentIO.status(data.body);
                            }

                            break;
                        }
                    }
                }
            };
        }
    } else {
        const webSocket = context.agentContext.webSocket;
        if (webSocket) {
            webSocket.onclose = null;
            webSocket.close();
        }

        context.agentContext.webSocket = undefined;
    }
}

async function executeDesktopAction(
    action: AppAction,
    context: SessionContext<DesktopActionContext>,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
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
