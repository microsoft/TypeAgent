// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { ClientIO, createDispatcher } from "agent-dispatcher";
import { getInstanceDir, getClientId } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { ChannelProvider } from "@typeagent/agent-rpc/channel";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AgentServerInvokeFunctions,
    ChannelName,
} from "@typeagent/agent-server-protocol";
import { AsyncLocalStorage } from "async_hooks";
import dotenv from "dotenv";
const envPath = new URL("../../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// AsyncLocalStorage to track which client is making the current request
const currentClientContext = new AsyncLocalStorage<ClientIO>();

async function main() {
    const instanceDir = getInstanceDir();

    // Track all connected clients and their ClientIO
    const connectedClients = new Map<
        ChannelProvider,
        { clientIO: ClientIO; closeFn: () => void }
    >();

    // Create a routing ClientIO that forwards calls to the current request's client
    // Wraps all methods to catch "Agent channel disconnected" errors gracefully
    const routingClientIO: ClientIO = {
        clear: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.clear?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
                // Silently ignore disconnected client errors
            }
        },
        exit: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.exit?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        setDisplayInfo: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.setDisplayInfo?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        setDisplay: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.setDisplay?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        appendDisplay: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.appendDisplay?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        appendDiagnosticData: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.appendDiagnosticData?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        setDynamicDisplay: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.setDynamicDisplay?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        askYesNo: async (...args) => {
            try {
                const client = currentClientContext.getStore();
                return client?.askYesNo?.(...args) ?? false;
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
                return false;
            }
        },
        proposeAction: async (...args) => {
            try {
                const client = currentClientContext.getStore();
                return client?.proposeAction?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
                return undefined;
            }
        },
        popupQuestion: async (...args) => {
            try {
                const client = currentClientContext.getStore();
                if (!client?.popupQuestion) {
                    throw new Error("popupQuestion not implemented");
                }
                return client.popupQuestion(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message.includes("Agent channel disconnected")
                ) {
                    return 0; // Return default choice
                }
                throw error;
            }
        },
        notify: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.notify?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        openLocalView: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.openLocalView?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        closeLocalView: (...args) => {
            try {
                const client = currentClientContext.getStore();
                client?.closeLocalView?.(...args);
            } catch (error) {
                if (
                    error instanceof Error &&
                    !error.message.includes("Agent channel disconnected")
                ) {
                    throw error;
                }
            }
        },
        takeAction: (action: string, data?: unknown) => {
            try {
                const client = currentClientContext.getStore();
                if (!client?.takeAction) {
                    throw new Error(`Action ${action} not supported`);
                }
                return client.takeAction(action, data);
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message.includes("Agent channel disconnected")
                ) {
                    return; // Silently ignore
                }
                throw error;
            }
        },
    };

    // Create single shared dispatcher with routing ClientIO
    const dispatcher = await createDispatcher("agent server", {
        appAgentProviders: getDefaultAppAgentProviders(instanceDir),
        persistSession: true,
        persistDir: instanceDir,
        storageProvider: getFsStorageProvider(),
        metrics: true,
        dblogging: false,
        clientId: getClientId(),
        clientIO: routingClientIO,
        indexingServiceRegistry: await getIndexingServiceRegistry(instanceDir),
        constructionProvider: getDefaultConstructionProvider(),
        conversationMemorySettings: {
            requestKnowledgeExtraction: false,
            actionResultKnowledgeExtraction: false,
        },
    });

    // Ignore dispatcher close requests
    dispatcher.close = async () => {};

    await createWebSocketChannelServer(
        { port: 8999 },
        (channelProvider, closeFn) => {
            const invokeFunctions: AgentServerInvokeFunctions = {
                join: async () => {
                    if (connectedClients.has(channelProvider)) {
                        throw new Error("Already joined");
                    }

                    const dispatcherChannel = channelProvider.createChannel(
                        ChannelName.Dispatcher,
                    );
                    const clientIOChannel = channelProvider.createChannel(
                        ChannelName.ClientIO,
                    );
                    const clientIORpcClient =
                        createClientIORpcClient(clientIOChannel);

                    // Store this client's ClientIO
                    connectedClients.set(channelProvider, {
                        clientIO: clientIORpcClient,
                        closeFn,
                    });

                    channelProvider.on("disconnect", () => {
                        connectedClients.delete(channelProvider);
                        console.log(
                            `Client disconnected. Active connections: ${connectedClients.size}`,
                        );
                    });

                    // Wrap the dispatcher RPC server to set context for each request
                    const wrappedDispatcher = {
                        ...dispatcher,
                        processCommand: async (
                            command: string,
                            requestId?: string,
                            attachments?: string[],
                        ) => {
                            return currentClientContext.run(
                                clientIORpcClient,
                                () =>
                                    dispatcher.processCommand(
                                        command,
                                        requestId,
                                        attachments,
                                    ),
                            );
                        },
                        checkCache: async (request: string) => {
                            return currentClientContext.run(
                                clientIORpcClient,
                                () => dispatcher.checkCache(request),
                            );
                        },
                    };

                    createDispatcherRpcServer(
                        wrappedDispatcher as any,
                        dispatcherChannel,
                    );
                    console.log(
                        `Client connected. Active connections: ${connectedClients.size}`,
                    );
                },
            };

            createRpc(
                "agent-server",
                channelProvider.createChannel(ChannelName.AgentServer),
                invokeFunctions,
            );
        },
    );

    console.log("Agent server started at ws://localhost:8999");
}

await main();
