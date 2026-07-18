// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
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

// Payload for the "server is running out-of-date code" notice. Sent as
// chat-ui's STATUS_NOTICE_EVENT ("statusNotice"): the shells render a
// persistent toast that collapses to a pinned pill (with a Restart button),
// the CLI prints a yellow line. Kept as a plain literal so the server needn't
// depend on the chat-ui (DOM) package.
const STALE_BUILD_NOTICE = {
    id: "stale-build",
    level: "warning",
    title: "Server out of date",
    message:
        "This agent server was rebuilt on disk after it started, so it's running the old code.",
    actionLabel: "Restart server",
    actionCommand: "@server restart",
} as const;

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
): {
    handler: ConnectionHandler;
    /**
     * Push the stale-build notice to every currently-connected client. Called
     * by the stale-build watcher the moment a rebuild is detected, so live
     * clients see the toast immediately instead of only on their next join.
     */
    broadcastStaleNotice: () => void;
} {
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

    // Each live connection registers a fn here that pushes the stale-build
    // notice to its client (via that client's clientIO). Lets a mid-run stale
    // detection reach already-connected clients, not just ones that join later.
    const staleNotifiers = new Set<() => void>();
    const broadcastStaleNotice = () => {
        for (const notify of staleNotifiers) {
            notify();
        }
    };

    const handler: ConnectionHandler = (
        channelProvider: ChannelProvider,
        _closeFn: () => void,
    ) => {
        onConnect?.();

        // Track which conversations this connection has joined.
        // conversationId → { dispatcher, connectionId }
        const joinedConversations = new Map<
            string,
            { dispatcher: Dispatcher; connectionId: string }
        >();

        // Client-hosted agents this connection registered, per conversation.
        // conversationId → set of agent names. Used to tear them down when the
        // connection drops so they don't linger on the (longer-lived) shared
        // dispatcher.
        const clientAgents = new Map<string, Set<string>>();

        // Resolve the conversation a client-agent operation targets. When no id
        // is given, use the single joined conversation; error if there are zero
        // or many so the caller must disambiguate.
        const resolveClientAgentConversation = (
            conversationId?: string,
        ): string => {
            if (conversationId !== undefined) {
                if (!joinedConversations.has(conversationId)) {
                    throw new Error(
                        `Not joined to conversation: ${conversationId}`,
                    );
                }
                return conversationId;
            }
            if (joinedConversations.size === 1) {
                return joinedConversations.keys().next().value as string;
            }
            if (joinedConversations.size === 0) {
                throw new Error(
                    "Cannot register client agent: no conversation joined",
                );
            }
            throw new Error(
                "Cannot register client agent: multiple conversations joined; specify conversationId",
            );
        };

        // Warn this connection about a stale server build at most once, even
        // if it joins several conversations - whether the trigger is a join or
        // a mid-run broadcast.
        let notifiedStale = false;
        // Sends the stale notice to this connection's client. Kept pointed at
        // the latest joined conversation's clientIO and registered in
        // staleNotifiers while the connection is live.
        let staleNotifier: (() => void) | undefined;

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

                    // Point this connection's stale-notice sender at the
                    // current conversation's clientIO and register it so a
                    // mid-run stale detection can push to this client too. The
                    // shared notifiedStale flag keeps it to once per connection
                    // (whether triggered here on join or by a broadcast).
                    if (staleNotifier !== undefined) {
                        staleNotifiers.delete(staleNotifier);
                    }
                    staleNotifier = () => {
                        if (notifiedStale) {
                            return;
                        }
                        notifiedStale = true;
                        try {
                            clientIORpcClient.notify(
                                undefined,
                                "statusNotice",
                                STALE_BUILD_NOTICE,
                                "agent-server",
                            );
                        } catch {
                            // Best effort - never fail on a delivery error.
                        }
                    };
                    staleNotifiers.add(staleNotifier);

                    // Already stale at join time? Warn this client now.
                    if (isStale?.() === true) {
                        staleNotifier();
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
            registerClientAgent: async (param) => {
                const conversationId = resolveClientAgentConversation(
                    param.conversationId,
                );
                const { name, manifest, agentInterface } = param;
                if (clientAgents.get(conversationId)?.has(name)) {
                    throw new Error(
                        `Client agent '${name}' is already registered on conversation '${conversationId}'`,
                    );
                }
                // Build the rpc proxy on the connection's own channel provider
                // (the client hosts the real agent via createAgentRpcServer on
                // the matching agent:<name> channel).
                const appAgent = await createAgentRpcClient(
                    name,
                    channelProvider,
                    agentInterface,
                );
                try {
                    await conversationManager.addClientAgent(
                        conversationId,
                        name,
                        manifest,
                        appAgent,
                    );
                } catch (e) {
                    channelProvider.deleteChannel(`agent:${name}`);
                    throw e;
                }
                let set = clientAgents.get(conversationId);
                if (set === undefined) {
                    set = new Set();
                    clientAgents.set(conversationId, set);
                }
                set.add(name);
            },
            unregisterClientAgent: async (param) => {
                const conversationId = resolveClientAgentConversation(
                    param.conversationId,
                );
                const { name } = param;
                await conversationManager.removeClientAgent(
                    conversationId,
                    name,
                );
                channelProvider.deleteChannel(`agent:${name}`);
                clientAgents.get(conversationId)?.delete(name);
            },
        };

        // Clean up all conversations on disconnect
        channelProvider.on("disconnect", () => {
            onDisconnect?.();
            if (staleNotifier !== undefined) {
                staleNotifiers.delete(staleNotifier);
                staleNotifier = undefined;
            }
            // Remove client-hosted agents first so they don't linger on the
            // shared dispatcher after this connection's socket is gone.
            for (const [conversationId, names] of clientAgents.entries()) {
                for (const name of names) {
                    conversationManager
                        .removeClientAgent(conversationId, name)
                        .catch(() => {
                            // Best effort on disconnect
                        });
                }
            }
            clientAgents.clear();
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

    return { handler, broadcastStaleNotice };
}
