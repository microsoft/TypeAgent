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
import type { ConfigDrift } from "@typeagent/config";
import type { MacroManager } from "@typeagent/copilot-macros";
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

const MAX_IDENTITY_LENGTH = 64;

/**
 * Validate an optional client-supplied identity field, falling back to a
 * server-derived default when it is absent. Bounds are cheap insurance against
 * a buggy client filling the group map (and the "which device?" prompt) with
 * junk.
 */
function checkIdentityField(
    field: string,
    value: string | undefined,
    fallback: string,
): string {
    if (value === undefined) {
        return fallback;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new Error(`Invalid ${field}: must not be empty`);
    }
    if (trimmed.length > MAX_IDENTITY_LENGTH) {
        throw new Error(
            `Invalid ${field}: must be at most ${MAX_IDENTITY_LENGTH} characters`,
        );
    }
    return trimmed;
}

export type ConnectionHandlerDeps = {
    /** The conversation manager backing this server. */
    conversationManager: ConversationManager;
    macroManager: MacroManager;
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
    /**
     * Optional: a startup snapshot of how this server's local config differs
     * from the shared Key Vault. When set, each joining client is warned that
     * its local config is out of sync with the vault. Only the standalone
     * agent-server supplies this; it is computed once before the server
     * accepts clients, so (unlike {@link isStale}) it never changes mid-run.
     */
    configDrift?: ConfigDrift;
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
    // Once clicked, the button disables and shows this while the restart runs.
    // The notice is retracted by STALE_BUILD_DISMISS when the client rejoins
    // the fresh (non-stale) successor.
    actionBusyLabel: "Restarting...",
    actionBusyMessage:
        "Restarting the agent server. This notice will clear once it reconnects.",
} as const;

// Retracts STALE_BUILD_NOTICE on a client. Sent when a client joins a server
// that is NOT stale, so a pill left over from a previous (pre-restart)
// connection is cleared - the fresh successor never re-pushes the notice (it
// isn't stale), so without this the old pill would linger forever.
const STALE_BUILD_DISMISS = {
    id: "stale-build",
    dismiss: true,
} as const;

// Stable id for the "local config differs from the shared Key Vault" notice.
const CONFIG_DRIFT_NOTICE_ID = "config-drift";

// Cap how many key names are listed in the drift message so a large drift
// doesn't produce a wall of text; the remainder is summarized as "and N more".
const CONFIG_DRIFT_MAX_KEYS = 6;

// Build the config-drift notice payload from a startup drift snapshot. Sent as
// chat-ui's STATUS_NOTICE_EVENT ("statusNotice") on connect, the same delivery
// path as STALE_BUILD_NOTICE. Kept a plain object (no chat-ui import) so the
// server needn't depend on the DOM package. The message lists differing key
// NAMES only - never values - so no secret can leak to a client.
function makeConfigDriftNotice(drift: ConfigDrift) {
    const keys = drift.driftedKeys;
    const shown = keys.slice(0, CONFIG_DRIFT_MAX_KEYS);
    const remainder = keys.length - shown.length;
    const list =
        remainder > 0
            ? `${shown.join(", ")}, and ${remainder} more`
            : shown.join(", ");
    const count = keys.length === 1 ? "1 setting" : `${keys.length} settings`;
    const verb = keys.length === 1 ? "differs" : "differ";
    return {
        id: CONFIG_DRIFT_NOTICE_ID,
        level: "warning",
        title: "Local config differs from Key Vault",
        message:
            `${count} in your local config ${verb} from the shared vault ` +
            `(${drift.vaultName}): ${list}.`,
    };
}

// Retracts the config-drift notice on a client that connects to a server with
// no drift - clears a pill left over from a previous connection (e.g. after the
// user reconciled their local config and restarted).
const CONFIG_DRIFT_DISMISS = {
    id: CONFIG_DRIFT_NOTICE_ID,
    dismiss: true,
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
        macroManager,
        shutdown,
        restart,
        isStale,
        configDrift,
        getUserIdentity,
        portRegistrar,
        onConnect,
        onDisconnect,
    } = deps;

    // Built once from the startup config-drift snapshot (undefined when the
    // local config matches the vault, no vault is configured, or drift
    // detection was skipped). Reused for every joining client.
    const configDriftNotice =
        configDrift !== undefined
            ? makeConfigDriftNotice(configDrift)
            : undefined;

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
        // conversationId → (agent name → instanceId). Keyed by instance, not
        // just by name, so tearing this connection down removes only its own
        // instances and leaves other devices on the same agent alone.
        const clientAgents = new Map<string, Map<string, string>>();

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
            armMacroRecording: async (request) =>
                macroManager.armRecording(request),
            getMacroRecordingState: async (sessionId) =>
                macroManager.getRecordingState(sessionId),
            claimMacroRecording: async (request) =>
                macroManager.claimRecording(request),
            cancelMacroRecording: async (sessionId) =>
                macroManager.cancelRecording(sessionId),
            failMacroRecording: async (sessionId, tokenId, error) =>
                macroManager.failRecording(sessionId, tokenId, error),
            finalizeMacroRecording: async (request) =>
                macroManager.finalizeRecording(request),
            listMacros: async (request) => macroManager.listMacros(request),
            searchMacros: async (request) => macroManager.searchMacros(request),
            inspectMacro: async (request) => macroManager.inspectMacro(request),
            getMacroRequirements: async (request) =>
                macroManager.getMacroRequirements(request),
            createMacroFromTrace: async (request) =>
                macroManager.createMacroFromTrace(request),
            validateMacro: async (request) =>
                macroManager.validateMacro(request),
            approveMacro: async (request) => macroManager.approveMacro(request),
            disableMacro: async (request) => macroManager.disableMacro(request),
            deleteMacro: async (request) => macroManager.deleteMacro(request),
            runMacro: async (request) => macroManager.runMacro(request),
            submitMacroCandidate: async (request) =>
                macroManager.submitMacroCandidate(request),
            cancelMacroRun: async (runId) => macroManager.cancelMacroRun(runId),
            getMacroRun: async (runId) => macroManager.getMacroRun(runId),

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
                            {
                                trustedContextPropagation: true,
                            },
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

                    // Deliver the on-join stale notice (or its retract) AFTER
                    // this join RPC's response is sent. The client creates its
                    // per-conversation clientIO channel only once
                    // joinConversation resolves, and the shared channel router
                    // DROPS messages addressed to a not-yet-created channel (no
                    // buffering) - so a push from inside this handler is
                    // silently lost. setImmediate runs in the check phase, after
                    // the microtask that sends the response; the WebSocket
                    // preserves order, so the client has created the channel by
                    // the time this notify arrives.
                    const joinStaleNotifier = staleNotifier;
                    setImmediate(() => {
                        if (isStale?.() === true) {
                            // Already stale at join time - warn this client now.
                            joinStaleNotifier();
                        } else {
                            // Not stale - retract any stale-build pill this
                            // client still shows from a previous connection to a
                            // since-restarted server (the fresh successor won't
                            // re-push it).
                            try {
                                clientIORpcClient.notify(
                                    undefined,
                                    "statusNotice",
                                    STALE_BUILD_DISMISS,
                                    "agent-server",
                                );
                            } catch {
                                // Best effort - never fail on a delivery error.
                            }
                        }

                        // Config-drift notice: on connect, warn when this
                        // server's local config differs from the shared Key
                        // Vault, or retract a stale pill when it doesn't. A
                        // startup snapshot (computed before the server accepts
                        // clients), so unlike the stale-build notice it never
                        // changes mid-run and needs no broadcast path.
                        // Idempotent across re-joins via the stable notice id.
                        try {
                            clientIORpcClient.notify(
                                undefined,
                                "statusNotice",
                                configDriftNotice ?? CONFIG_DRIFT_DISMISS,
                                "agent-server",
                            );
                        } catch {
                            // Best effort - never fail on a delivery error.
                        }
                    });

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

            findConversations: async (query: string, maxMatches?: number) => {
                return conversationManager.findConversations(query, maxMatches);
            },

            searchConversationContent: async (
                query: string,
                maxMatches?: number,
            ) => {
                // The wire/command path passes a plain query string; treat it
                // as a natural-language question (the index blends in a
                // message-text match too).
                return conversationManager.searchConversationContent(
                    { question: query },
                    maxMatches,
                );
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
                const connectionId =
                    joinedConversations.get(conversationId)!.connectionId;
                // A client that sends no instanceId is a single instance tied
                // to its connection: synthesising the id from the connection
                // keeps it distinct from other devices, and means it does not
                // survive a reconnect (which is exactly the old behaviour).
                const instanceId = checkIdentityField(
                    "instanceId",
                    param.instanceId,
                    `connection:${connectionId}`,
                );
                const displayName = checkIdentityField(
                    "displayName",
                    param.displayName,
                    name,
                );

                const registered = clientAgents.get(conversationId);
                if (registered?.has(name)) {
                    // This connection is re-registering the same name (the
                    // client rebuilt its rpc server). Drop the stale channel so
                    // the new proxy can claim it.
                    channelProvider.deleteChannel(`agent:${name}`);
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
                        instanceId,
                        displayName,
                        connectionId,
                    );
                } catch (e) {
                    channelProvider.deleteChannel(`agent:${name}`);
                    throw e;
                }
                let map = clientAgents.get(conversationId);
                if (map === undefined) {
                    map = new Map();
                    clientAgents.set(conversationId, map);
                }
                map.set(name, instanceId);
            },
            unregisterClientAgent: async (param) => {
                const conversationId = resolveClientAgentConversation(
                    param.conversationId,
                );
                const { name } = param;
                const connectionId =
                    joinedConversations.get(conversationId)!.connectionId;
                // Fall back to the instance this connection registered. The
                // ownership check below makes an instanceId naming another
                // device's instance inert, so a client can never unregister
                // someone else's agent.
                const instanceId =
                    param.instanceId ??
                    clientAgents.get(conversationId)?.get(name) ??
                    conversationManager.findClientAgentInstance(
                        conversationId,
                        name,
                        connectionId,
                    );
                if (instanceId !== undefined) {
                    await conversationManager.removeClientAgent(
                        conversationId,
                        name,
                        instanceId,
                        { ownerConnectionId: connectionId },
                    );
                }
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
            // shared dispatcher after this connection's socket is gone. Only
            // this connection's own instances go, and only if they still name
            // this connection: a phone that slept may already have reconnected
            // and re-registered the same instanceId on a live socket.
            for (const [conversationId, agents] of clientAgents.entries()) {
                const connectionId =
                    joinedConversations.get(conversationId)?.connectionId;
                for (const [name, instanceId] of agents.entries()) {
                    conversationManager
                        .removeClientAgent(conversationId, name, instanceId, {
                            ownerConnectionId: connectionId,
                        })
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
