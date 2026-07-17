// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { ChannelProvider } from "@typeagent/agent-rpc/channel";
import {
    AgentServerInvokeFunctions,
    AgentServerChannelName,
    DiscoveryChannelName,
    createDiscoveryHandlers,
    DispatcherConnectOptions,
    JoinConversationResult,
    UserIdentity,
    getDispatcherChannelName,
    getClientIOChannelName,
} from "@typeagent/agent-server-protocol";
import type { Dispatcher } from "agent-dispatcher";
import type { PortRegistrar } from "agent-dispatcher";
import type { ConversationManager } from "./conversationManager.js";
import { resolveTunnelUrlForDiscovery } from "./tunnelResolver.js";
import { getSpeechToken } from "./speechToken.js";

/**
 * Per-connection handler signature expected by transports (the WebSocket
 * channel server, or the in-process loopback). Called once per connected
 * client with a {@link ChannelProvider} multiplexing all RPC channels for
 * that connection.
 */
export type ConnectionHandler = (
    channelProvider: ChannelProvider,
    closeFn: () => void,
) => void;

export type ConnectionHandlerDeps = {
    /** The conversation manager backing this server. */
    conversationManager: ConversationManager;
    /**
     * Invoked when the dispatcher (or an RPC client) requests a server
     * shutdown. For the standalone agent-server this kills the process; for an
     * embedded in-process server this typically quits the host app.
     */
    shutdown: () => void | Promise<void>;
    /**
     * Optional: relaunch the server process so it loads rebuilt code. Only the
     * standalone agent-server supplies this - the in-process (embedded) server
     * leaves it undefined, so `@server restart` and the restart RPC report that
     * restart isn't supported there.
     */
    restart?: () => void | Promise<void>;
    /**
     * Optional: returns true when this server is running an out-of-date build
     * (its code was rebuilt on disk after it started). When set, each joining
     * client is warned once so the user knows to restart the server. Only the
     * standalone agent-server supplies this.
     */
    isStale?: () => boolean;
    /** Returns the current resolved user identity. */
    getUserIdentity: () => UserIdentity;
    /**
     * When provided, a read-only discovery RPC channel is hosted on the
     * connection so external clients can look up agent ports. Hosts that run
     * their own discovery server (e.g. the Electron shell) should leave this
     * undefined to avoid double-hosting.
     */
    portRegistrar?: PortRegistrar;
    /** Called when a new connection is established (for connection counting). */
    onConnect?: () => void;
    /** Called when a connection disconnects (for connection counting). */
    onDisconnect?: () => void;
};

/**
 * Build the per-connection handler shared by every agent-server transport.
 * This is the single place that wires a client connection's RPC channels to
 * the {@link ConversationManager}: the agent-server invoke functions
 * (join/leave/create/list/rename/delete conversation, shutdown), the
 * per-conversation clientIO and dispatcher RPC channels, and the optional
 * discovery channel.
 */
export function createAgentServerConnectionHandler(
    deps: ConnectionHandlerDeps,
): ConnectionHandler {
    const {
        conversationManager,
        shutdown,
        restart,
        isStale,
        getUserIdentity,
        portRegistrar,
        onConnect,
        onDisconnect,
    } = deps;

    return (channelProvider: ChannelProvider, _closeFn: () => void) => {
        onConnect?.();

        // Track which conversations this connection has joined.
        // conversationId → { dispatcher, connectionId }
        const joinedConversations = new Map<
            string,
            { dispatcher: Dispatcher; connectionId: string }
        >();

        // Warn this connection about a stale server build at most once, even
        // if it joins several conversations.
        let notifiedStale = false;

        const invokeFunctions: AgentServerInvokeFunctions = {
            joinConversation: async (options?: DispatcherConnectOptions) => {
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

                    // Intercept shutdown: when the dispatcher calls
                    // clientIO.shutdown(), invoke the host's shutdown handler
                    // instead of forwarding the request to the client.
                    const wrappedClientIO = {
                        ...clientIORpcClient,
                        shutdown: () => {
                            void shutdown();
                        },
                        // Only expose restart when the host supports it (the
                        // standalone server). Left off for the in-process
                        // server so `@server restart` reports "not supported".
                        ...(restart !== undefined
                            ? {
                                  restart: () => {
                                      void restart();
                                  },
                              }
                            : {}),
                    };

                    const result = await conversationManager.joinConversation(
                        conversationId,
                        wrappedClientIO,
                        () => {
                            channelProvider.deleteChannel(
                                getDispatcherChannelName(conversationId),
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

                    // If this server is serving out-of-date code, warn the
                    // freshly-joined client once so the user knows to restart
                    // it. Sent as chat-ui's STATUS_NOTICE_EVENT ("statusNotice")
                    // with a structured payload: the shells render a persistent
                    // toast/pill (with a Restart button) and the CLI prints a
                    // yellow line. Kept as a literal so the server needn't
                    // depend on the chat-ui (DOM) package.
                    if (isStale?.() === true && !notifiedStale) {
                        notifiedStale = true;
                        try {
                            clientIORpcClient.notify(
                                undefined,
                                "statusNotice",
                                {
                                    id: "stale-build",
                                    level: "warning",
                                    title: "Server out of date",
                                    message:
                                        "This agent server was rebuilt on disk after it started, so it's running the old code.",
                                    actionLabel: "Restart server",
                                    actionCommand: "@server restart",
                                },
                                "agent-server",
                            );
                        } catch {
                            // Best effort - never fail a join because the
                            // stale-build warning couldn't be delivered.
                        }
                    }

                    const joinResult: JoinConversationResult = {
                        connectionId: result.connectionId,
                        conversationId,
                        name: result.name,
                        pendingInteractions: result.pendingInteractions ?? [],
                    };
                    if (result.queueSnapshot !== undefined) {
                        joinResult.queueSnapshot = result.queueSnapshot;
                    }
                    return joinResult;
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
                // Channel cleanup runs in the closeFn passed to
                // sharedDispatcher.join() via dispatcher.close(); don't
                // double-delete here.
                await conversationManager.leaveConversation(
                    conversationId,
                    entry.connectionId,
                );
            },

            createConversation: async (name, options) => {
                return conversationManager.createConversation(name, options);
            },

            listConversations: async (name?: string) => {
                return conversationManager.listConversations(name);
            },

            renameConversation: async (
                conversationId: string,
                newName: string,
                options,
            ) => {
                return conversationManager.renameConversation(
                    conversationId,
                    newName,
                    options,
                );
            },

            deleteConversation: async (conversationId: string) => {
                // Channel cleanup for any joined client of this conversation
                // runs in the closeFn passed to sharedDispatcher.join() via
                // sharedDispatcher.close() → closeAllClients() →
                // dispatcher.close(); don't double-delete here.
                return conversationManager.deleteConversation(conversationId);
            },
            shutdown: async () => {
                await shutdown();
            },
            restart: async () => {
                if (restart === undefined) {
                    throw new Error(
                        "Restart is not supported for the in-process agent server.",
                    );
                }
                await restart();
            },
            getUserIdentity: async () => getUserIdentity(),
            getSpeechToken: async () => getSpeechToken(),
        };

        // Clean up all conversations on disconnect
        channelProvider.on("disconnect", () => {
            onDisconnect?.();
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

        // Discovery channel: read-only port lookup for external clients
        // (browser extension, VS Code extension, CLI). Only hosted when a
        // PortRegistrar is supplied — hosts that run their own discovery
        // server leave this undefined to avoid double-hosting.
        if (portRegistrar !== undefined) {
            createRpc(
                "agent-server:discovery",
                channelProvider.createChannel(DiscoveryChannelName),
                createDiscoveryHandlers(
                    (agentName, role) => portRegistrar.lookup(agentName, role),
                    // Remote clients get a live dev-tunnel URL when one is
                    // configured; local clients (and a down/absent tunnel) fall
                    // back to localhost. See tunnelResolver.ts.
                    resolveTunnelUrlForDiscovery,
                ),
            );
        }
    };
}
