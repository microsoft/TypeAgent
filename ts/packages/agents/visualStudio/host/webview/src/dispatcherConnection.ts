// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Adapted from packages/agents/browser/src/extension/serviceWorker/dispatcherConnection.ts
// for the Visual Studio WebView2 panel. WebView2 is a single browser context (no
// service worker), so the ClientIO callbacks call into ChatPanel directly rather
// than forwarding via chrome.runtime.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import {
    createDispatcherRpcClient,
    wrapClientIOForCompletion,
} from "@typeagent/dispatcher-rpc/dispatcher/client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import {
    AgentServerChannelName,
    AGENT_SERVER_DEFAULT_URL,
    DispatcherConnectOptions,
    JoinConversationResult,
    AgentServerInvokeFunctions,
    getDispatcherChannelName,
    getClientIOChannelName,
} from "@typeagent/agent-server-protocol";
import type { ChatPanel } from "chat-ui";
import type { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";

const DEFAULT_AGENT_SERVER_URL = AGENT_SERVER_DEFAULT_URL;

export interface DispatcherHandle {
    dispatcher: Dispatcher;
    onConnectionChange: (cb: (connected: boolean) => void) => void;
    close: () => Promise<void>;
}

export async function connectDispatcher(
    chatPanel: ChatPanel,
    url: string = DEFAULT_AGENT_SERVER_URL,
): Promise<DispatcherHandle> {
    const connectionListeners = new Set<(connected: boolean) => void>();
    const notifyConnection = (connected: boolean) => {
        connectionListeners.forEach((cb) => cb(connected));
    };

    return new Promise<DispatcherHandle>((resolve, reject) => {
        const ws = new WebSocket(url);

        const channel = createChannelProviderAdapter(
            "agent-server:vsix",
            (message: any) => ws.send(JSON.stringify(message)),
        );

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:vsix",
            channel.createChannel(AgentServerChannelName),
        );

        const clientIO = createChatPanelClientIO(chatPanel);

        let resolved = false;

        ws.onopen = () => {
            const options: DispatcherConnectOptions = {
                filter: true,
                clientType: "extension",
            };
            rpc.invoke("joinConversation", options)
                .then((result: JoinConversationResult) => {
                    resolved = true;

                    const {
                        dispatcher,
                        notifyCommandComplete,
                        notifyRequestCancelled,
                    } = createDispatcherRpcClient(
                        channel.createChannel(
                            getDispatcherChannelName(result.conversationId),
                        ),
                        result.connectionId,
                    );

                    createClientIORpcServer(
                        wrapClientIOForCompletion(clientIO, {
                            notifyCommandComplete,
                            notifyRequestCancelled,
                        }),
                        channel.createChannel(
                            getClientIOChannelName(result.conversationId),
                        ),
                    );

                    dispatcher.close = async () => ws.close();
                    notifyConnection(true);

                    resolve({
                        dispatcher,
                        onConnectionChange: (cb) => connectionListeners.add(cb),
                        close: async () => {
                            try {
                                ws.close();
                            } catch {
                                /* noop */
                            }
                        },
                    });
                })
                .catch((err: unknown) => reject(err));
        };

        ws.onmessage = (event: MessageEvent) => {
            const data =
                typeof event.data === "string"
                    ? event.data
                    : event.data.toString();
            channel.notifyMessage(JSON.parse(data));
        };

        ws.onclose = () => {
            channel.notifyDisconnected();
            notifyConnection(false);
            if (!resolved) {
                reject(
                    new Error(`Failed to connect to Agent Server at ${url}`),
                );
            }
        };

        ws.onerror = () => {
            // ws.onclose will fire next; rely on it for the reject path.
        };
    });
}

function createChatPanelClientIO(chatPanel: ChatPanel): ClientIO {
    return {
        clear() {
            chatPanel.clear();
        },
        exit() {
            /* no-op in VSIX */
        },
        shutdown() {
            /* no-op in VSIX */
        },
        setUserRequest() {},
        setDisplayInfo(_requestId, source, actionIndex) {
            chatPanel.setDisplayInfo(source, actionIndex);
        },
        setDisplay(message) {
            chatPanel.replaceAgentMessage(
                message.message as DisplayContent,
                message.source,
                message.sourceIcon,
            );
        },
        appendDisplay(message, mode) {
            chatPanel.addAgentMessage(
                message.message as DisplayContent,
                message.source,
                message.sourceIcon,
                mode as DisplayAppendMode,
            );
        },
        appendDiagnosticData() {
            /* not shown in VSIX */
        },
        setDynamicDisplay(
            _requestId,
            source,
            _actionIndex,
            displayId,
            nextRefreshMs,
        ) {
            chatPanel.setDynamicDisplay(source, displayId, nextRefreshMs);
        },
        async question(_requestId, message, choices, defaultId) {
            if (
                choices.length === 2 &&
                choices[0] === "Yes" &&
                choices[1] === "No"
            ) {
                const yes = await chatPanel.askYesNo(message, defaultId === 0);
                return yes ? 0 : 1;
            }
            return defaultId ?? 0;
        },
        async proposeAction(_requestId, actionTemplates, source) {
            const text = JSON.stringify(actionTemplates, null, 2);
            const accepted = await chatPanel.proposeAction(text, source);
            return accepted ? undefined : false;
        },
        notify(_notificationId, event, data, source) {
            switch (event) {
                case "explained":
                    if ((data as { error?: string })?.error) {
                        chatPanel.addAgentMessage(
                            {
                                type: "text",
                                content: (data as { error: string }).error,
                                kind: "warning",
                            },
                            source,
                        );
                    }
                    break;
                case "error":
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content:
                                typeof data === "string"
                                    ? data
                                    : ((data as { message?: string })
                                          ?.message ?? "Error"),
                            kind: "error",
                        },
                        source,
                    );
                    break;
                case "warning":
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content:
                                typeof data === "string"
                                    ? data
                                    : ((data as { message?: string })
                                          ?.message ?? "Warning"),
                            kind: "warning",
                        },
                        source,
                    );
                    break;
                case "info":
                case "inline":
                case "toast":
                    chatPanel.addAgentMessage(
                        typeof data === "string"
                            ? { type: "text", content: data, kind: "info" }
                            : (data as DisplayContent),
                        source,
                    );
                    break;
            }
        },
        async openLocalView() {
            /* not supported in VSIX */
        },
        async closeLocalView() {
            /* not supported in VSIX */
        },
        requestChoice() {
            /* not supported in VSIX */
        },
        requestForm() {
            /* not supported in VSIX */
        },
        requestInteraction() {
            /* not supported in VSIX */
        },
        interactionResolved() {
            /* not supported in VSIX */
        },
        interactionCancelled() {
            /* not supported in VSIX */
        },
        takeAction() {
            /* not supported in VSIX */
        },
    };
}
