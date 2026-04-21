// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import {
    createConversationManager,
    ConversationManager,
} from "./conversationManager.js";
import {
    getInstanceDirAsync,
    getTraceIdAsync,
} from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AgentServerInvokeFunctions,
    AgentServerChannelName,
    DispatcherConnectOptions,
    getDispatcherChannelName,
    getClientIOChannelName,
} from "@typeagent/agent-server-protocol";
import type { ChannelProvider } from "@typeagent/agent-rpc/channel";
import type { Dispatcher } from "agent-dispatcher";
import dotenv from "dotenv";
import registerDebug from "debug";
const envPath = new URL("../../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const debugStartup = registerDebug("agent-server:startup");

async function main() {
    debugStartup(`pid=${process.pid} resolving instance dir + traceId`);
    const [instanceDir, traceId] = await Promise.all([
        getInstanceDirAsync(),
        getTraceIdAsync(),
    ]);
    debugStartup(`instanceDir=${instanceDir}`);

    // did the launch request a specific config? (e.g. "test" to load "config.test.json")
    const configIdx = process.argv.indexOf("--config");
    const configName =
        configIdx !== -1 ? process.argv[configIdx + 1] : undefined;

    debugStartup("creating conversation manager (will lockInstanceDir)");
    const conversationManager: ConversationManager =
        await createConversationManager(
            "agent server",
            {
                appAgentProviders: getDefaultAppAgentProviders(
                    instanceDir,
                    configName,
                ),
                persistSession: true,
                storageProvider: getFsStorageProvider(),
                metrics: true,
                dblogging: false,
                traceId,
                indexingServiceRegistry: await getIndexingServiceRegistry(
                    instanceDir,
                    configName,
                ),
                constructionProvider: getDefaultConstructionProvider(),
                conversationMemorySettings: {
                    requestKnowledgeExtraction: false,
                    actionResultKnowledgeExtraction: false,
                },
                collectCommandResult: true,
            },
            instanceDir,
        );

    debugStartup("conversation manager ready; prewarming default conversation");
    // Pre-initialize the default conversation dispatcher before accepting clients,
    // so the first joinConversation call is fast and concurrent joinConversation calls
    // don't race to initialize the same dispatcher.
    await conversationManager.prewarmMostRecentConversation();
    debugStartup("prewarm complete");

    const portIdx = process.argv.indexOf("--port");
    const port =
        portIdx !== -1
            ? parseInt(process.argv[portIdx + 1], 10)
            : process.env.AGENT_SERVER_PORT
              ? parseInt(process.env.AGENT_SERVER_PORT, 10)
              : 8999;

    const idleShutdownIdx = process.argv.indexOf("--idle-timeout");
    const idleShutdownMs =
        idleShutdownIdx !== -1
            ? parseInt(process.argv[idleShutdownIdx + 1], 10) * 1000
            : 0;

    let connectionCount = 0;
    let idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleIdleShutdown() {
        if (idleShutdownMs <= 0 || connectionCount > 0) {
            return;
        }
        idleShutdownTimer = setTimeout(async () => {
            console.log(
                "No clients connected — idle shutdown after " +
                    idleShutdownMs / 1000 +
                    "s. Stopping agent server...",
            );
            wss.close();
            await conversationManager.close();
            process.exit(0);
        }, idleShutdownMs);
    }

    const wss = await createWebSocketChannelServer(
        { port },
        (channelProvider: ChannelProvider, closeFn: () => void) => {
            connectionCount++;
            if (idleShutdownTimer !== undefined) {
                clearTimeout(idleShutdownTimer);
                idleShutdownTimer = undefined;
            }

            // Track which conversations this WebSocket connection has joined
            // conversationId → { dispatcher, connectionId }
            const joinedConversations = new Map<
                string,
                { dispatcher: Dispatcher; connectionId: string }
            >();

            const invokeFunctions: AgentServerInvokeFunctions = {
                joinConversation: async (
                    options?: DispatcherConnectOptions,
                ) => {
                    // Resolve conversation ID first (may auto-create default)
                    const conversationId =
                        await conversationManager.resolveConversationId(
                            options?.conversationId,
                        );

                    if (joinedConversations.has(conversationId)) {
                        throw new Error(
                            `Already joined conversation '${conversationId}'. Call leaveConversation() before joining again.`,
                        );
                    }

                    // Create conversation-namespaced channels
                    const clientIOChannel = channelProvider.createChannel(
                        getClientIOChannelName(conversationId),
                    );
                    try {
                        const clientIORpcClient =
                            createClientIORpcClient(clientIOChannel);

                        const result =
                            await conversationManager.joinConversation(
                                conversationId,
                                clientIORpcClient,
                                () => {
                                    channelProvider.deleteChannel(
                                        getDispatcherChannelName(
                                            conversationId,
                                        ),
                                    );
                                    channelProvider.deleteChannel(
                                        getClientIOChannelName(conversationId),
                                    );
                                    joinedConversations.delete(conversationId);
                                },
                                options,
                            );

                        const dispatcherChannel = channelProvider.createChannel(
                            getDispatcherChannelName(conversationId),
                        );
                        try {
                            createDispatcherRpcServer(
                                result.dispatcher,
                                dispatcherChannel,
                            );
                        } catch (e) {
                            channelProvider.deleteChannel(
                                getDispatcherChannelName(conversationId),
                            );
                            throw e;
                        }

                        joinedConversations.set(conversationId, {
                            dispatcher: result.dispatcher,
                            connectionId: result.connectionId,
                        });

                        return {
                            connectionId: result.connectionId,
                            conversationId,
                            name: result.name,
                            pendingInteractions:
                                result.pendingInteractions ?? [],
                        };
                    } catch (e) {
                        channelProvider.deleteChannel(
                            getClientIOChannelName(conversationId),
                        );
                        throw e;
                    }
                },

                leaveConversation: async (conversationId: string) => {
                    const entry = joinedConversations.get(conversationId);
                    if (entry === undefined) {
                        throw new Error(
                            `Not joined to conversation: ${conversationId}`,
                        );
                    }
                    channelProvider.deleteChannel(
                        getDispatcherChannelName(conversationId),
                    );
                    channelProvider.deleteChannel(
                        getClientIOChannelName(conversationId),
                    );
                    joinedConversations.delete(conversationId);
                    await conversationManager.leaveConversation(
                        conversationId,
                        entry.connectionId,
                    );
                },

                createConversation: async (name: string) => {
                    return conversationManager.createConversation(name);
                },

                listConversations: async (name?: string) => {
                    return conversationManager.listConversations(name);
                },

                renameConversation: async (
                    conversationId: string,
                    newName: string,
                ) => {
                    return conversationManager.renameConversation(
                        conversationId,
                        newName,
                    );
                },

                deleteConversation: async (conversationId: string) => {
                    // If this client is in the conversation being deleted,
                    // clean up local channels first
                    const entry = joinedConversations.get(conversationId);
                    if (entry !== undefined) {
                        channelProvider.deleteChannel(
                            getDispatcherChannelName(conversationId),
                        );
                        channelProvider.deleteChannel(
                            getClientIOChannelName(conversationId),
                        );
                        joinedConversations.delete(conversationId);
                    }
                    return conversationManager.deleteConversation(
                        conversationId,
                    );
                },
                shutdown: async () => {
                    console.log("Shutdown requested, stopping agent server...");
                    wss.close();
                    await conversationManager.close();
                    process.exit(0);
                },
            };

            // Clean up all conversations on WebSocket disconnect
            channelProvider.on("disconnect", () => {
                connectionCount--;
                scheduleIdleShutdown();
                for (const [
                    conversationId,
                    { connectionId },
                ] of joinedConversations.entries()) {
                    conversationManager
                        .leaveConversation(conversationId, connectionId)
                        .catch(() => {
                            // Best effort on disconnect
                        });
                }
                joinedConversations.clear();
            });

            createRpc(
                "agent-server",
                channelProvider.createChannel(AgentServerChannelName),
                invokeFunctions,
            );
        },
    );

    console.log(`Agent server started at ws://localhost:${port}`);
    scheduleIdleShutdown();
}

process.on("unhandledRejection", (reason, _promise) => {
    console.error("[agent-server] Unhandled promise rejection:", reason);
    // Log but do not exit — crashing the server kills all concurrent workers.
});

process.on("uncaughtException", (err) => {
    console.error("[agent-server] Uncaught exception:", err);
    // Log but do not exit for non-fatal errors.
});

await main();
