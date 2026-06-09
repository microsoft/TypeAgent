// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Stub `AgentServerConnection` for unit tests. Holds an in-memory
 * conversation list and records calls, plus a per-method
 * `onCall` injection point for forcing failures and races.
 */

import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    AgentServerConnection,
    ConversationDispatcher,
    ConversationInfo,
} from "../src/index.js";

export function makeInfo(
    id: string,
    name: string,
    createdAt: string = "2026-01-01T00:00:00Z",
    clientCount: number = 0,
): ConversationInfo {
    return { conversationId: id, name, createdAt, clientCount };
}

export type StubCallLog = {
    method: string;
    args: unknown[];
}[];

export type StubConnectionOptions = {
    list?: ConversationInfo[];
    /**
     * Per-method interceptor. Returns either:
     *  - `undefined` to use the default behavior,
     *  - a value to return (resolved promise),
     *  - or throws / returns a rejecting promise to simulate failures.
     *
     * Useful for forcing race scenarios (e.g. throw on first
     * createConversation, succeed on second) — return undefined after
     * decrementing your own counter.
     */
    intercept?: {
        listConversations?: (
            name: string | undefined,
            callIndex: number,
        ) => ConversationInfo[] | Promise<ConversationInfo[]> | undefined;
        createConversation?: (
            name: string,
            callIndex: number,
        ) => ConversationInfo | Promise<ConversationInfo> | undefined;
        joinConversation?: (
            clientIO: ClientIO,
            options: any,
            callIndex: number,
        ) =>
            | ConversationDispatcher
            | Promise<ConversationDispatcher>
            | undefined;
        leaveConversation?: (
            id: string,
            callIndex: number,
        ) => void | Promise<void> | undefined;
        deleteConversation?: (
            id: string,
            callIndex: number,
        ) => void | Promise<void> | undefined;
        renameConversation?: (
            id: string,
            newName: string,
            callIndex: number,
        ) => void | Promise<void> | undefined;
    };
};

export function makeStubConnection(
    opts: StubConnectionOptions = {},
): AgentServerConnection & {
    state: ConversationInfo[];
    calls: StubCallLog;
} {
    const state: ConversationInfo[] = [...(opts.list ?? [])];
    const calls: StubCallLog = [];
    const callCounters: Record<string, number> = {};

    const nextCount = (m: string) => {
        const n = callCounters[m] ?? 0;
        callCounters[m] = n + 1;
        return n;
    };

    const makeDispatcher = (id: string, name: string): ConversationDispatcher =>
        ({
            // ConversationDispatcher shape; we only exercise the fields
            // used by the helpers under test.
            conversationId: id,
            name,
            connectionId: `conn-${id}`,
            dispatcher: {
                close: async () => undefined,
            } as any,
        }) as ConversationDispatcher;

    const stub: AgentServerConnection = {
        async listConversations(name?: string) {
            const idx = nextCount("listConversations");
            calls.push({ method: "listConversations", args: [name] });
            const override = await opts.intercept?.listConversations?.(
                name,
                idx,
            );
            if (override !== undefined) return override;
            if (name === undefined) return [...state];
            // Match the real server's substring (includes) filter
            // rather than exact match — the helpers re-filter
            // client-side, but tests added later may rely on the
            // server's substring semantics.
            const norm = name.trim().toLowerCase();
            return state.filter((c) => c.name.toLowerCase().includes(norm));
        },

        async createConversation(name: string) {
            const idx = nextCount("createConversation");
            calls.push({ method: "createConversation", args: [name] });
            const override = await opts.intercept?.createConversation?.(
                name,
                idx,
            );
            if (override !== undefined) {
                // Mirror real server behavior: a newly-created conversation
                // is visible to subsequent listConversations / joinConversation
                // calls. Tests that want to model a phantom create should
                // explicitly intercept the follow-on calls too.
                if (
                    !state.some(
                        (c) => c.conversationId === override.conversationId,
                    )
                ) {
                    state.push(override);
                }
                return override;
            }
            const norm = name.trim().toLowerCase();
            if (state.some((c) => c.name.toLowerCase() === norm)) {
                throw new Error(`Conversation '${name}' already exists`);
            }
            const info = makeInfo(`id-${state.length + 1}`, name);
            state.push(info);
            return info;
        },

        async joinConversation(clientIO: ClientIO, options: any) {
            const idx = nextCount("joinConversation");
            calls.push({ method: "joinConversation", args: [options] });
            const override = await opts.intercept?.joinConversation?.(
                clientIO,
                options,
                idx,
            );
            if (override !== undefined) return override;
            const id = options?.conversationId;
            const found = state.find((c) => c.conversationId === id);
            if (!found) {
                throw new Error(`Conversation not found: ${id}`);
            }
            return makeDispatcher(found.conversationId, found.name);
        },

        async leaveConversation(id: string) {
            const idx = nextCount("leaveConversation");
            calls.push({ method: "leaveConversation", args: [id] });
            await opts.intercept?.leaveConversation?.(id, idx);
        },

        async deleteConversation(id: string) {
            const idx = nextCount("deleteConversation");
            calls.push({ method: "deleteConversation", args: [id] });
            const override = await opts.intercept?.deleteConversation?.(
                id,
                idx,
            );
            if (override !== undefined) return;
            const i = state.findIndex((c) => c.conversationId === id);
            if (i >= 0) state.splice(i, 1);
        },

        async renameConversation(id: string, newName: string) {
            const idx = nextCount("renameConversation");
            calls.push({
                method: "renameConversation",
                args: [id, newName],
            });
            const override = await opts.intercept?.renameConversation?.(
                id,
                newName,
                idx,
            );
            if (override !== undefined) return;
            const c = state.find((c) => c.conversationId === id);
            if (!c) throw new Error(`Conversation not found: ${id}`);
            c.name = newName;
        },

        async shutdown() {},
        async close() {},
    };

    return Object.assign(stub, { state, calls });
}

export const fakeClientIO = {} as ClientIO;
