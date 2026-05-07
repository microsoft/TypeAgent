// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The agent-server client API was renamed `*Session` -> `*Conversation` in
// PR #2289 (post-merge). Rather than rename every call site in the bridge
// (and every webview message field), expose a thin compatibility shim that
// preserves the old `*Session` shape.

import type {
    AgentServerConnection,
    ConversationInfo,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";

export type SessionInfo = ConversationInfo & { sessionId: string };

export type SessionDispatcher = {
    dispatcher: Dispatcher;
    sessionId: string;
    name: string;
};

export type LegacyConnectOptions = Omit<
    DispatcherConnectOptions,
    "conversationId"
> & {
    sessionId?: string;
};

export type LegacyAgentServerConnection = {
    joinSession(
        clientIO: ClientIO,
        options?: LegacyConnectOptions,
    ): Promise<SessionDispatcher>;
    leaveSession(sessionId: string): Promise<void>;
    createSession(name: string): Promise<SessionInfo>;
    listSessions(name?: string): Promise<SessionInfo[]>;
    renameSession(sessionId: string, newName: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    shutdown(): Promise<void>;
    close(): Promise<void>;
};

function adaptInfo(c: ConversationInfo): SessionInfo {
    return { ...c, sessionId: c.conversationId };
}

export function wrapLegacy(
    c: AgentServerConnection,
): LegacyAgentServerConnection {
    return {
        async joinSession(io, opts) {
            const { sessionId, ...rest } = opts ?? {};
            const r = await c.joinConversation(io, {
                ...rest,
                conversationId: sessionId,
            });
            return {
                dispatcher: r.dispatcher,
                sessionId: r.conversationId,
                name: r.name,
            };
        },
        leaveSession: (id) => c.leaveConversation(id),
        createSession: async (n) => adaptInfo(await c.createConversation(n)),
        listSessions: async (n) =>
            (await c.listConversations(n)).map(adaptInfo),
        renameSession: (id, n) => c.renameConversation(id, n),
        deleteSession: (id) => c.deleteConversation(id),
        shutdown: () => c.shutdown(),
        close: () => c.close(),
    };
}
