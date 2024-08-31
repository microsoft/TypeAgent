// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeCodeContext,
        updateAgentContext: updateCodeContext,
        executeAction: executeCodeAction,
    };
}

type CodeActionContext = {
    webSocket: WebSocket | undefined;
    nextActionContextId: number;
    actionContextMap: Map<number, ActionContext<CodeActionContext>>;
};

async function initializeCodeContext(): Promise<CodeActionContext> {
    return {
        webSocket: undefined,
        nextActionContextId: 0,
        actionContextMap: new Map(),
    };
}

async function updateCodeContext(
    enable: boolean,
    context: SessionContext<CodeActionContext>,
): Promise<void> {
    if (enable) {
        const agentContext = context.agentContext;
        if (agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            agentContext.webSocket = webSocket;
            agentContext.actionContextMap = new Map();
            webSocket.onclose = (event: Object) => {
                console.error("Code webSocket connection closed.");
                context.agentContext.webSocket = undefined;
            };
            webSocket.onmessage = async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text) as WebSocketMessage;
                if (
                    data.target == "dispatcher" &&
                    data.source == "code" &&
                    data.body
                ) {
                    switch (data.messageType) {
                        case "confirmAction": {
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

async function executeCodeAction(
    action: AppAction,
    context: ActionContext<CodeActionContext>,
) {
    const agentContext = context.sessionContext.agentContext;
    const webSocketEndpoint = agentContext.webSocket;
    if (webSocketEndpoint) {
        try {
            const actionContextId = agentContext.nextActionContextId++;
            agentContext.actionContextMap.set(actionContextId, context);
            webSocketEndpoint.send(
                JSON.stringify({
                    source: "dispatcher",
                    target: "code",
                    messageType: "translatedAction",
                    body: {
                        actionContextId,
                        action,
                    },
                }),
            );
        } catch {
            throw new Error("Unable to contact code backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}
