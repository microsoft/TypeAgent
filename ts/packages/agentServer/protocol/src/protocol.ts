// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";

export type DispatcherConnectOptions = {
    filter?: boolean; // filter to message for own request. Default is false (no filtering)
    clientType?: "shell" | "extension"; // identifies the connecting client type
    conversationId?: string; // join a specific conversation by UUID. If omitted, connects to the default conversation.
};

export type ConversationInfo = {
    conversationId: string;
    name: string;
    clientCount: number;
    createdAt: string; // ISO 8601
};

export type JoinConversationResult = {
    connectionId: string;
    conversationId: string;
    name: string;
    /**
     * Any pending interactions that are awaiting a client response.
     * Sent on join so reconnecting clients can resume showing prompts.
     */
    pendingInteractions?: PendingInteractionRequest[];
};

/**
 * Identity of the OS user the agent-server process is running as.
 * Used by clients that can't do Office SSO (e.g. the Excel add-in) so
 * they can show the user's initial instead of a generic "U" avatar.
 * This is a convenience signal, not a security claim.
 */
export type UserIdentity = {
    username: string; // OS username, e.g. "robgruen"
    displayName: string; // Git user.name if set, else username
    initial: string; // Single uppercase character for avatars
};

export type AgentServerInvokeFunctions = {
    joinConversation: (
        options?: DispatcherConnectOptions,
    ) => Promise<JoinConversationResult>;
    leaveConversation: (conversationId: string) => Promise<void>;
    createConversation: (name: string) => Promise<ConversationInfo>;
    listConversations: (name?: string) => Promise<ConversationInfo[]>;
    renameConversation: (
        conversationId: string,
        newName: string,
    ) => Promise<void>;
    deleteConversation: (conversationId: string) => Promise<void>;
    shutdown: () => Promise<void>;
    getUserIdentity: () => Promise<UserIdentity>;
};

/**
 * Fallback UserIdentity for clients that fail to reach the server. Keeps
 * the UI from having to guard for undefined everywhere.
 */
export const DefaultUserIdentity: UserIdentity = {
    username: "user",
    displayName: "user",
    initial: "U",
};

export const AgentServerChannelName = "agent-server";

/**
 * Channel name for the port-discovery RPC endpoint hosted by agent-server.
 * External clients (browser extension, VS Code extension, CLI) open this
 * channel to look up which port a given app-agent + role is currently bound
 * to. The dispatcher's `PortRegistrar` is the source of truth.
 */
export const DiscoveryChannelName = "discovery";

/**
 * Default TCP port the agent-server listens on. Centralized here so every
 * client that defaults to "the local agent-server" stays in sync if we ever
 * change it. Override via `--port`/`AGENT_SERVER_PORT` on the server side
 * and via the `port` argument on the client side.
 */
export const AGENT_SERVER_DEFAULT_PORT = 8999;

/** Convenience: the matching default WebSocket URL. */
export const AGENT_SERVER_DEFAULT_URL = `ws://localhost:${AGENT_SERVER_DEFAULT_PORT}`;

/**
 * Well-known agent name for the agent-server itself. Used by external
 * clients via `lookupPort` to discover the configured server port when
 * they bootstrapped from a different known port. The agent-server
 * special-cases this name in its discovery handler.
 */
export const AGENT_SERVER_DISCOVERY_NAME = "agent-server";

/**
 * RPC surface for the discovery channel. Read-only on purpose: clients can
 * ask "where is agent X's role Y?" but cannot mutate the registrar — only
 * agents themselves (in-process, via SessionContext.registerPort) can do
 * that.
 */
export type DiscoveryInvokeFunctions = {
    /**
     * Look up the port currently registered for `(agentName, role)`.
     *
     * `role` is an agent-defined free-form string — the discovery
     * protocol does not enumerate valid values; each agent owns its
     * own role namespace and should publish constants for callers to
     * import. Omit `role` (or pass undefined) to look up the agent's
     * default role, which matches what `setLocalHostPort` registered
     * for agents that pre-date the multi-role API.
     *
     * Well-known: `agentName === "agent-server"` returns the
     * agent-server's own listening port (registered as a regular
     * allocation under that name), so clients that bootstrap from a
     * known port can discover the configured one.
     *
     * Returns `null` (not undefined) so the JSON-RPC response is always a
     * defined value; callers should treat null as "no allocation found,
     * try again later" rather than a hard error.
     */
    lookupPort: (param: {
        agentName: string;
        role?: string;
    }) => Promise<{ port: number | null }>;
};

/**
 * Build the read-only discovery RPC handler set from a lookup callback.
 *
 * Both the agent-server and the standalone Electron shell host this
 * channel — the agent-server multiplexes it onto its main WS, the
 * standalone shell stands up a dedicated WS for it. They share this
 * factory so the wire-level behavior (including null-for-not-found
 * normalization) stays in lockstep.
 *
 * The callback shape — rather than passing the `IPortRegistrar`
 * directly — keeps this package free of an `agent-dispatcher` dep,
 * which would otherwise create a downward dependency from the
 * protocol-only package onto the dispatcher core.
 */
export function createDiscoveryHandlers(
    lookup: (agentName: string, role?: string) => number | undefined,
): DiscoveryInvokeFunctions {
    return {
        lookupPort: async ({ agentName, role }) => ({
            port: lookup(agentName, role) ?? null,
        }),
    };
}

/** Build the dispatcher channel name for a given conversation. */
export function getDispatcherChannelName(conversationId: string): string {
    return `dispatcher:${conversationId}`;
}

/** Build the clientIO channel name for a given conversation. */
export function getClientIOChannelName(conversationId: string): string {
    return `clientio:${conversationId}`;
}

// =============================================
// Client Type Registry
// =============================================
// Module-level registry mapping connectionId → clientType.
// Shared between the agent server (writes) and agents (reads)
// because they run in the same Node.js process.

const clientTypeRegistry = new Map<string, string>();

/** Register a client type when a client joins the dispatcher. */
export function registerClientType(
    connectionId: string,
    clientType: string,
): void {
    clientTypeRegistry.set(connectionId, clientType);
}

/** Get the client type for a given connectionId. */
export function getClientType(connectionId: string): string | undefined {
    return clientTypeRegistry.get(connectionId);
}

/** Remove a client from the registry when it disconnects. */
export function unregisterClient(connectionId: string): void {
    clientTypeRegistry.delete(connectionId);
}
