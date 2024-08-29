// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import {
    ActionContext,
    DispatcherAction,
    DispatcherAgent,
    DispatcherAgentContext,
} from "@typeagent/agent-sdk";

export function instantiate(): DispatcherAgent {
    return {
        initializeAgentContext: initializeCodeContext,
        updateAgentContext: updateCodeContext,
        executeAction: executeCodeAction,
    };
}

type CodeActionContext = {
    webSocket: WebSocket | undefined;
};

async function initializeCodeContext(): Promise<CodeActionContext> {
    return {
        webSocket: undefined,
    };
}

async function updateCodeContext(
    enable: boolean,
    context: DispatcherAgentContext<CodeActionContext>,
): Promise<void> {
    if (enable) {
        if (context.context.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            context.context.webSocket = webSocket;
            webSocket.onclose = (event: Object) => {
                console.error("Code webSocket connection closed.");
                context.context.webSocket = undefined;
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
        const webSocket = context.context.webSocket;
        if (webSocket) {
            webSocket.onclose = null;
            webSocket.close();
        }

        context.context.webSocket = undefined;
    }
}

async function executeCodeAction(
    action: DispatcherAction,
    context: ActionContext<CodeActionContext>,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
    if (webSocketEndpoint) {
        try {
            const requestId = context.sessionContext.requestId;
            webSocketEndpoint.send(
                JSON.stringify({
                    source: "dispatcher",
                    target: "code",
                    messageType: "translatedAction",
                    id: requestId,
                    body: action,
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
