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
    nextCallId: number;
    pendingCall: Map<
        number,
        {
            resolve: () => void;
            context: ActionContext<DesktopActionContext>;
        }
    >;
};

function initializeDesktopContext(): DesktopActionContext {
    return {
        webSocket: undefined,
        nextCallId: 0,
        pendingCall: new Map(),
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
                            const pendingCall = agentContext.pendingCall.get(
                                data.body.callId,
                            );

                            if (pendingCall) {
                                agentContext.pendingCall.delete(
                                    data.body.callId,
                                );
                                const { resolve, context } = pendingCall;
                                context.actionIO.setActionDisplay(
                                    data.body.message,
                                );
                                resolve();
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
            const callId = agentContext.nextCallId++;
            return new Promise<void>((resolve) => {
                agentContext.pendingCall.set(callId, {
                    resolve,
                    context,
                });
                webSocketEndpoint.send(
                    JSON.stringify({
                        source: "dispatcher",
                        target: "desktop",
                        messageType: "desktopActionRequest",
                        body: {
                            callId,
                            action,
                        },
                    }),
                );
            });
        } catch {
            throw new Error("Unable to contact desktop backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}
