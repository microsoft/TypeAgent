// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, jest, test } from "@jest/globals";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import {
    createAgentServerConnection,
    type AgentServerConnection,
} from "@typeagent/agent-server-client";
import type { DispatcherConnectOptions } from "@typeagent/agent-server-protocol";
import type { MacroManager } from "@typeagent/copilot-macros";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-types";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import {
    StructuredActionBindings,
    type StructuredActionLease,
} from "../src/structuredActionBindings.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function fixture() {
    const session = {};
    const bindings = new StructuredActionBindings(() => session);
    let nextConnection = 0;
    const joinedOptions: (DispatcherConnectOptions | undefined)[] = [];
    const resolveConversationId = jest.fn(
        async (id?: string) => id ?? "default",
    );
    const leases = new Map<string, StructuredActionLease>();
    const closeCallbacks = new Map<string, () => void>();
    const left = deferred();
    let pause:
        | {
              entered: ReturnType<typeof deferred>;
              resume: ReturnType<typeof deferred>;
          }
        | undefined;
    const leaveConversation = jest.fn(
        async (_conversationId: string, connectionId: string) => {
            leases.get(connectionId)?.release();
            leases.delete(connectionId);
            closeCallbacks.get(connectionId)?.();
            closeCallbacks.delete(connectionId);
            left.resolve();
        },
    );
    const manager = {
        resolveConversationId,
        async joinConversation(
            conversationId: string,
            _clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ) {
            joinedOptions.push(options);
            const connectionId = String(++nextConnection);
            const lease =
                options?.structuredActions === undefined
                    ? undefined
                    : bindings.acquire(
                          conversationId,
                          connectionId,
                          options.structuredActions.resumeToken,
                      );
            if (lease !== undefined) {
                leases.set(connectionId, lease);
            }
            closeCallbacks.set(connectionId, closeFn);
            const paused = pause;
            pause = undefined;
            paused?.entered.resolve();
            await paused?.resume.promise;
            return {
                dispatcher: {} as Dispatcher,
                connectionId,
                name: "Test conversation",
                pendingInteractions: [],
                ...(lease === undefined
                    ? {}
                    : {
                          structuredActions: { resumeToken: lease.resumeToken },
                      }),
            };
        },
        leaveConversation,
    } as unknown as ConversationManager;
    const { handler } = createAgentServerConnectionHandler({
        conversationManager: manager,
        macroManager: {} as MacroManager,
        shutdown() {},
        getUserIdentity: () => ({
            username: "test",
            displayName: "test",
            initial: "T",
        }),
    });
    const connections: AgentServerConnection[] = [];
    const disconnectors = new Map<AgentServerConnection, () => void>();
    return {
        joinedOptions,
        resolveConversationId,
        leaveConversation,
        leases,
        left: left.promise,
        pauseNextJoin() {
            pause = { entered: deferred(), resume: deferred() };
            return {
                entered: pause.entered.promise,
                resume: pause.resume.resolve,
            };
        },
        disconnect(connection: AgentServerConnection) {
            disconnectors.get(connection)?.();
        },
        connect() {
            let client: ChannelProviderAdapter | undefined;
            const server = createChannelProviderAdapter("server", (message) =>
                client?.notifyMessage(message),
            );
            client = createChannelProviderAdapter("client", (message) =>
                server.notifyMessage(message),
            );
            handler(server, () => {});
            const connection = createAgentServerConnection(client, () => {});
            const clientAdapter = client;
            disconnectors.set(connection, () => {
                server.notifyDisconnected();
                clientAdapter.notifyDisconnected();
            });
            connections.push(connection);
            return connection;
        },
        async close() {
            for (const connection of connections) {
                await connection.close();
            }
            bindings.close();
        },
    };
}

describe("structured join RPC plumbing", () => {
    test("returns a private capability to the originator and accepts explicit resume", async () => {
        const server = fixture();
        try {
            const first = await server
                .connect()
                .joinConversation({} as ClientIO, {
                    conversationId: "conversation",
                    structuredActions: {},
                });
            expect(first.structuredActions?.resumeToken).toMatch(
                /^[A-Za-z0-9_-]{43}$/,
            );
            if (first.structuredActions === undefined) {
                throw new Error("Expected structured binding");
            }
            const second = await server
                .connect()
                .joinConversation({} as ClientIO, {
                    conversationId: "conversation",
                    structuredActions: first.structuredActions,
                });
            expect(second.structuredActions).toEqual(first.structuredActions);
            expect(second.connectionId).not.toBe(first.connectionId);
            expect(server.joinedOptions[1]?.structuredActions).toEqual(
                first.structuredActions,
            );
            expect(first.pendingInteractions).toEqual([]);
            expect(first.queueSnapshot).toBeUndefined();
        } finally {
            await server.close();
        }
    });

    test("does not allocate a default conversation for a malformed structured join", async () => {
        const server = fixture();
        try {
            await expect(
                server.connect().joinConversation({} as ClientIO, {
                    structuredActions: {},
                }),
            ).rejects.toThrow("explicit target conversationId");
            expect(server.resolveConversationId).not.toHaveBeenCalled();
            expect(server.joinedOptions).toEqual([]);
        } finally {
            await server.close();
        }
    });

    test("failed resume does not silently create a new capability", async () => {
        const server = fixture();
        try {
            await expect(
                server.connect().joinConversation({} as ClientIO, {
                    conversationId: "conversation",
                    structuredActions: { resumeToken: "a".repeat(43) },
                }),
            ).rejects.toThrow("resume state is unavailable");
        } finally {
            await server.close();
        }
    });

    test("legacy joins do not receive a structured capability", async () => {
        const server = fixture();
        try {
            const joined = await server
                .connect()
                .joinConversation({} as ClientIO);
            expect(joined.conversationId).toBe("default");
            expect(joined.structuredActions).toBeUndefined();
        } finally {
            await server.close();
        }
    });

    test("disconnect during async join releases the acquired ownership", async () => {
        const server = fixture();
        const paused = server.pauseNextJoin();
        try {
            const connection = server.connect();
            const pending = connection.joinConversation({} as ClientIO, {
                conversationId: "conversation",
                structuredActions: {},
            });
            const rejected = expect(pending).rejects.toThrow("disconnected");
            await paused.entered;
            expect(server.leases.size).toBe(1);
            const lease = [...server.leases.values()][0];
            server.disconnect(connection);
            await rejected;
            paused.resume();
            await server.left;
            expect(server.leaveConversation).toHaveBeenCalledWith(
                "conversation",
                "1",
            );
            expect(server.leases.size).toBe(0);
            expect(lease.access().canDiscoverSchema("list")).toBe(false);
        } finally {
            paused.resume();
            await server.close();
        }
    });
});
