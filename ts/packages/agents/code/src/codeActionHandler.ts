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
    enabled: Set<string>;
    webSocket: WebSocket | undefined;
    nextCallId: number;
    pendingCall: Map<
        number,
        {
            resolve: () => void;
            context: ActionContext<CodeActionContext>;
        }
    >;
};

async function initializeCodeContext(): Promise<CodeActionContext> {
    return {
        enabled: new Set(),
        webSocket: undefined,
        nextCallId: 0,
        pendingCall: new Map(),
    };
}

async function updateCodeContext(
    enable: boolean,
    context: SessionContext<CodeActionContext>,
    translatorName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        agentContext.enabled.add(translatorName);
        if (agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket();
        if (webSocket) {
            agentContext.webSocket = webSocket;
            agentContext.pendingCall = new Map();
            webSocket.onclose = (event: Object) => {
                console.error("Code webSocket connection closed.");
                agentContext.webSocket = undefined;
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
        agentContext.enabled.delete(translatorName);
        if (agentContext.enabled.size === 0) {
            const webSocket = context.agentContext.webSocket;
            if (webSocket) {
                webSocket.onclose = null;
                webSocket.close();
            }

            context.agentContext.webSocket = undefined;
        }
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
            const callId = agentContext.nextCallId++;
            return new Promise<void>((resolve) => {
                agentContext.pendingCall.set(callId, {
                    resolve,
                    context,
                });
                webSocketEndpoint.send(
                    JSON.stringify({
                        source: "dispatcher",
                        target: "code",
                        messageType: "translatedAction",
                        body: {
                            callId,
                            action,
                        },
                    }),
                );
            });
        } catch {
            throw new Error("Unable to contact code backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}
