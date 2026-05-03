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
