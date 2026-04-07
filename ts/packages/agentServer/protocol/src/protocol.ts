// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherConnectOptions = {
    filter?: boolean; // filter to message for own request. Default is false (no filtering)
    clientType?: "shell" | "extension"; // identifies the connecting client type
    sessionId?: string; // join a specific session by UUID. If omitted, connects to the default session.
};

export type SessionInfo = {
    sessionId: string;
    name: string;
    clientCount: number;
    createdAt: string; // ISO 8601
};

export type JoinSessionResult = {
    connectionId: string;
    sessionId: string;
    name: string;
};

export type AgentServerInvokeFunctions = {
    joinSession: (
        options?: DispatcherConnectOptions,
    ) => Promise<JoinSessionResult>;
    leaveSession: (sessionId: string) => Promise<void>;
    createSession: (name: string) => Promise<SessionInfo>;
    listSessions: (name?: string) => Promise<SessionInfo[]>;
    renameSession: (sessionId: string, newName: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    shutdown: () => Promise<void>;
};

export const AgentServerChannelName = "agent-server";

/** Build the dispatcher channel name for a given session. */
export function getDispatcherChannelName(sessionId: string): string {
    return `dispatcher:${sessionId}`;
}

/** Build the clientIO channel name for a given session. */
export function getClientIOChannelName(sessionId: string): string {
    return `clientio:${sessionId}`;
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
