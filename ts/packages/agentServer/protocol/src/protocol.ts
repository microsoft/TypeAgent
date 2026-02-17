// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherConnectOptions = {
    filter?: boolean; // filter to message for own request. Default is false (no filtering)
    clientType?: "shell" | "extension"; // identifies the connecting client type
};

export type AgentServerInvokeFunctions = {
    join: (options?: DispatcherConnectOptions) => Promise<string>;
};

export const enum ChannelName {
    AgentServer = "agent-server",
    Dispatcher = "dispatcher",
    ClientIO = "clientio",
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
