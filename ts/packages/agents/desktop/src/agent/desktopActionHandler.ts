// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import { ActionContext, AppAction, SessionContext } from "@typeagent/agent-sdk";

export function instantiate() {
    return {
        initializeAgentContext: initializeDesktopContext,
        updateAgentContext: updateDesktopContext,
        executeAction: executeDesktopAction,
    };
}

type DesktopActionContext = {
    webSocket: WebSocket | undefined;
    nextActionContextId: number;
    actionContextMap: Map<number, ActionContext<DesktopActionContext>>;
};

function initializeDesktopContext(): DesktopActionContext {
    return {
        webSocket: undefined,
        nextActionContextId: 0,
        actionContextMap: new Map(),
    };
}

async function updateDesktopContext(
    enable: boolean,
    context: SessionContext<DesktopActionContext>,
): Promise<void> {
    if (enable) {
        const agentContext = context.agentContext;
        if (agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            agentContext.webSocket = webSocket;
            webSocket.onclose = (event: Object) => {
                console.error("Desktop webSocket connection closed.");
                agentContext.webSocket = undefined;
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
                        case "desktopActionResponse": {
                            const actionContext =
                                agentContext.actionContextMap.get(
                                    data.body.actionContextId,
                                );
                            if (actionContext) {
                                actionContext.actionIO.setActionDisplay(
                                    data.body.message,
                                );
                                agentContext.actionContextMap.delete(
                                    data.body.actionContextId,
                                );
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
    context: ActionContext<DesktopActionContext>,
) {
    const agentContext = context.sessionContext.agentContext;
    const webSocketEndpoint = agentContext.webSocket;
    if (webSocketEndpoint) {
        try {
            const agentContext = context.sessionContext.agentContext;
            const actionContextId = agentContext.nextActionContextId++;
            agentContext.actionContextMap.set(actionContextId, context);
            webSocketEndpoint.send(
                JSON.stringify({
                    source: "dispatcher",
                    target: "desktop",
                    messageType: "desktopActionRequest",
                    body: {
                        actionContextId,
                        action,
                    },
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
