// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { createSessionManager, SessionManager } from "./sessionManager.js";
import { getInstanceDir, getTraceId } from "agent-dispatcher/helpers/data";
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
const envPath = new URL("../../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function main() {
    const instanceDir = getInstanceDir();

    // did the launch request a specific config? (e.g. "test" to load "config.test.json")
    const configIdx = process.argv.indexOf("--config");
    const configName =
        configIdx !== -1 ? process.argv[configIdx + 1] : undefined;

    const sessionManager: SessionManager = await createSessionManager(
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
            traceId: getTraceId(),
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

    // Pre-initialize the default session dispatcher before accepting clients,
    // so the first joinSession call is fast and concurrent joinSession calls
    // don't race to initialize the same dispatcher.
    await sessionManager.prewarmDefaultSession();

    const portIdx = process.argv.indexOf("--port");
    const port =
        portIdx !== -1 ? parseInt(process.argv[portIdx + 1], 10) : 8999;

    const wss = await createWebSocketChannelServer(
        { port },
        (channelProvider: ChannelProvider, closeFn: () => void) => {
            // Track which sessions this WebSocket connection has joined
            // sessionId → { dispatcher, connectionId }
            const joinedSessions = new Map<
                string,
                { dispatcher: Dispatcher; connectionId: string }
            >();

            const invokeFunctions: AgentServerInvokeFunctions = {
                joinSession: async (options?: DispatcherConnectOptions) => {
                    // Resolve session ID first (may auto-create default)
                    const sessionId = await sessionManager.resolveSessionId(
                        options?.sessionId,
                    );

                    if (joinedSessions.has(sessionId)) {
                        throw new Error(
                            `Already joined session '${sessionId}'. Call leaveSession() before joining again.`,
                        );
                    }

                    // Create session-namespaced channels
                    const clientIOChannel = channelProvider.createChannel(
                        getClientIOChannelName(sessionId),
                    );
                    try {
                        const clientIORpcClient =
                            createClientIORpcClient(clientIOChannel);

                        const result = await sessionManager.joinSession(
                            sessionId,
                            clientIORpcClient,
                            () => {
                                channelProvider.deleteChannel(
                                    getDispatcherChannelName(sessionId),
                                );
                                channelProvider.deleteChannel(
                                    getClientIOChannelName(sessionId),
                                );
                                joinedSessions.delete(sessionId);
                            },
                            options,
                        );

                        const dispatcherChannel = channelProvider.createChannel(
                            getDispatcherChannelName(sessionId),
                        );
                        try {
                            createDispatcherRpcServer(
                                result.dispatcher,
                                dispatcherChannel,
                            );
                        } catch (e) {
                            channelProvider.deleteChannel(
                                getDispatcherChannelName(sessionId),
                            );
                            throw e;
                        }

                        joinedSessions.set(sessionId, {
                            dispatcher: result.dispatcher,
                            connectionId: result.connectionId,
                        });

                        return {
                            connectionId: result.connectionId,
                            sessionId,
                            name: result.name,
                            pendingInteractions:
                                result.pendingInteractions ?? [],
                        };
                    } catch (e) {
                        channelProvider.deleteChannel(
                            getClientIOChannelName(sessionId),
                        );
                        throw e;
                    }
                },

                leaveSession: async (sessionId: string) => {
                    const entry = joinedSessions.get(sessionId);
                    if (entry === undefined) {
                        throw new Error(`Not joined to session: ${sessionId}`);
                    }
                    channelProvider.deleteChannel(
                        getDispatcherChannelName(sessionId),
                    );
                    channelProvider.deleteChannel(
                        getClientIOChannelName(sessionId),
                    );
                    joinedSessions.delete(sessionId);
                    await sessionManager.leaveSession(
                        sessionId,
                        entry.connectionId,
                    );
                },

                createSession: async (name: string) => {
                    return sessionManager.createSession(name);
                },

                listSessions: async (name?: string) => {
                    return sessionManager.listSessions(name);
                },

                renameSession: async (sessionId: string, newName: string) => {
                    return sessionManager.renameSession(sessionId, newName);
                },

                deleteSession: async (sessionId: string) => {
                    // If this client is in the session being deleted,
                    // clean up local channels first
                    const entry = joinedSessions.get(sessionId);
                    if (entry !== undefined) {
                        channelProvider.deleteChannel(
                            getDispatcherChannelName(sessionId),
                        );
                        channelProvider.deleteChannel(
                            getClientIOChannelName(sessionId),
                        );
                        joinedSessions.delete(sessionId);
                    }
                    return sessionManager.deleteSession(sessionId);
                },
                shutdown: async () => {
                    console.log("Shutdown requested, stopping agent server...");
                    wss.close();
                    await sessionManager.close();
                    process.exit(0);
                },
            };

            // Clean up all sessions on WebSocket disconnect
            channelProvider.on("disconnect", () => {
                for (const [
                    sessionId,
                    { connectionId },
                ] of joinedSessions.entries()) {
                    sessionManager
                        .leaveSession(sessionId, connectionId)
                        .catch(() => {
                            // Best effort on disconnect
                        });
                }
                joinedSessions.clear();
            });

            createRpc(
                "agent-server",
                channelProvider.createChannel(AgentServerChannelName),
                invokeFunctions,
            );
        },
    );

    console.log(`Agent server started at ws://localhost:${port}`);
}

await main();
