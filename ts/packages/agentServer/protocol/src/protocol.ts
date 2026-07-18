// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";
import type { QueueSnapshot } from "@typeagent/dispatcher-types";
import type { AppAgentManifest } from "@typeagent/agent-sdk";
import type { AgentInterfaceFunctionName } from "@typeagent/agent-rpc/server";

export type DispatcherConnectOptions = {
    filter?: boolean; // filter to message for own request. Default is false (no filtering)
    clientType?: "shell" | "extension"; // identifies the connecting client type
    conversationId?: string; // join a specific conversation by UUID. If omitted, connects to the default conversation.
};

/**
 * Origin of a conversation. Absent (undefined) means a native TypeAgent
 * conversation. `"copilot"` marks a read-only mirror imported from GitHub
 * Copilot Chat's session store.
 */
export type ConversationSource = "copilot";

export type ConversationInfo = {
    conversationId: string;
    name: string;
    clientCount: number;
    createdAt: string; // ISO 8601
    /**
     * Where this conversation came from. Omitted for native TypeAgent
     * conversations; set to `"copilot"` for imported mirrors. Clients use it to
     * badge the conversation and (together with {@link readOnly}) decide whether
     * to allow input.
     */
    source?: ConversationSource;
    /**
     * When true, the conversation is a read-only view (e.g. a Copilot mirror)
     * and clients should disable the input box. Omitted/false for normal
     * conversations.
     */
    readOnly?: boolean;
};

export type ConversationNameCollisionBehavior = "error" | "appendNumber";

export type ConversationNameCollisionOptions = {
    /**
     * How to handle an existing conversation with the same name.
     * Defaults to "error".
     */
    nameCollisionBehavior?: ConversationNameCollisionBehavior;
};

export type CreateConversationOptions = ConversationNameCollisionOptions;

export type RenameConversationOptions = ConversationNameCollisionOptions;

export type JoinConversationResult = {
    connectionId: string;
    conversationId: string;
    name: string;
    /**
     * Any pending interactions that are awaiting a client response.
     * Sent on join so reconnecting clients can resume showing prompts.
     */
    pendingInteractions?: PendingInteractionRequest[];
    /** Server-side queue snapshot at join time. Omitted when idle/empty;
     *  older clients ignore the field. */
    queueSnapshot?: QueueSnapshot;
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

/**
 * Short-lived Azure Speech authorization token, vended by the server (which
 * owns the `speech:` config) to clients that render a microphone affordance
 * (e.g. the VS Code shell webview). Clients build a
 * `SpeechConfig.fromAuthorizationToken("aad#<endpoint>#<token>", region)` from
 * these fields. The token expires after ~10 minutes; `expire` is the ms-since-
 * epoch at which callers should request a fresh one.
 */
export type SpeechToken = {
    token: string;
    expire: number; // ms since epoch
    region: string;
    endpoint: string;
};

export type AgentServerInvokeFunctions = {
    joinConversation: (
        options?: DispatcherConnectOptions,
    ) => Promise<JoinConversationResult>;
    leaveConversation: (conversationId: string) => Promise<void>;
    createConversation: (
        name: string,
        options?: CreateConversationOptions,
    ) => Promise<ConversationInfo>;
    listConversations: (name?: string) => Promise<ConversationInfo[]>;
    renameConversation: (
        conversationId: string,
        newName: string,
        options?: RenameConversationOptions,
    ) => Promise<void>;
    deleteConversation: (conversationId: string) => Promise<void>;
    shutdown: () => Promise<void>;
    getUserIdentity: () => Promise<UserIdentity>;
    /**
     * Vend a short-lived Azure Speech authorization token from the server's
     * `speech:` config. Returns `undefined` when speech is not configured or
     * a token can't be acquired, so clients can gracefully hide/disable the
     * mic affordance.
     */
    getSpeechToken: () => Promise<SpeechToken | undefined>;
    /**
     * Register a client-hosted app agent with a joined conversation's
     * dispatcher. The agent's handlers run in the connecting client's process
     * (over agent-rpc on the connection's channel provider); the server builds
     * an rpc proxy from `agentInterface` and installs it as a dynamic agent.
     * The agent is removed automatically when the connection drops or leaves
     * the conversation.
     *
     * The client must create its agent-rpc server on the `agent:<name>`
     * channel (via createAgentRpcServer over the connection channel provider)
     * before calling this. Rejects if an agent with `name` is already
     * registered on the target conversation (e.g. a second client trying to
     * register the same singleton agent).
     */
    registerClientAgent: (param: RegisterClientAgentParams) => Promise<void>;
    /** Unregister a previously registered client-hosted agent. */
    unregisterClientAgent: (
        param: UnregisterClientAgentParams,
    ) => Promise<void>;
};

export type RegisterClientAgentParams = {
    name: string;
    manifest: AppAgentManifest;
    agentInterface: AgentInterfaceFunctionName[];
    /**
     * Target conversation. If omitted, the server uses the connection's single
     * joined conversation (and errors if the connection has joined none or
     * more than one).
     */
    conversationId?: string;
};

export type UnregisterClientAgentParams = {
    name: string;
    conversationId?: string;
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
        /**
         * Hint that the request originates from a remote (non-loopback)
         * client, so the server should answer with a tunnel `url` (when one
         * is configured and live) rather than a localhost realm. Optional and
         * backward compatible — omitted by local clients, which only ever
         * need the port. See the dev-tunnel discovery design.
         */
        remote?: boolean;
    }) => Promise<{
        port: number | null;
        /**
         * A fully-qualified WebSocket URL (e.g. a `wss://…devtunnels.ms`
         * tunnel address) the caller should connect to instead of
         * `ws://localhost:<port>`. Present only when the server resolved a
         * live tunnel mapping for `port` and the request was remote-realm.
         * Absent → fall back to the localhost realm using `port`.
         */
        url?: string;
    }>;
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
    /**
     * Optional URL resolver. When supplied and it returns a string for the
     * resolved `(agentName, port, remote)`, that URL is attached to the
     * response so remote clients connect to a tunnel address instead of
     * localhost. Hosts that don't support tunneling (e.g. the standalone
     * shell) simply omit it and behavior is unchanged. The agent-server supplies
     * a resolver that reads the dev-tunnel config and checks host liveness.
     */
    resolveUrl?: (
        agentName: string,
        port: number,
        remote?: boolean,
    ) => string | undefined | Promise<string | undefined>,
): DiscoveryInvokeFunctions {
    return {
        lookupPort: async ({ agentName, role, remote }) => {
            const port = lookup(agentName, role) ?? null;
            if (port === null) {
                return { port };
            }
            const url = await resolveUrl?.(agentName, port, remote);
            return url ? { port, url } : { port };
        },
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
