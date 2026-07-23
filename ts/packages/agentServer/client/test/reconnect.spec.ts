// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AgentServerChannelName,
    AgentServerInvokeFunctions,
    ConversationInfo,
} from "@typeagent/agent-server-protocol";
import WebSocket, { WebSocketServer } from "ws";

import { connectAgentServer } from "../src/agentServerClient.js";
import { fakeClientIO } from "./conversation-stubConnection.js";

// Spin up a real ws server that speaks the agent-rpc control channel so the
// reconnect/rebind path is exercised over the actual wire format.
async function startStubServer(convs: ConversationInfo[]): Promise<{
    url: string;
    dropSockets: () => void;
    liveSocketCount: () => number;
    close: () => Promise<void>;
}> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
        wss.once("listening", () => resolve());
        wss.once("error", reject);
    });

    wss.on("connection", (ws) => {
        const channelProvider = createChannelProviderAdapter(
            "test:agent-server:server",
            (message) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            },
        );
        ws.on("message", (data: Buffer) => {
            try {
                channelProvider.notifyMessage(JSON.parse(data.toString()));
            } catch {
                // ignore malformed
            }
        });
        ws.on("close", () => channelProvider.notifyDisconnected());

        const handlers = {
            listConversations: async () => convs,
            joinConversation: async () => ({
                conversationId: "c1",
                connectionId: "conn-1",
                name: "Shell",
            }),
            createConversation: async (name: string) => ({
                conversationId: "c-new",
                name,
            }),
            leaveConversation: async () => {},
            renameConversation: async () => {},
            deleteConversation: async () => {},
            shutdown: async () => {},
        };
        createRpc<
            Record<string, never>,
            Record<string, never>,
            AgentServerInvokeFunctions
        >(
            "test:agent-server",
            channelProvider.createChannel(AgentServerChannelName),
            handlers as unknown as AgentServerInvokeFunctions,
        );
    });

    const port = (wss.address() as { port: number }).port;
    return {
        url: `ws://127.0.0.1:${port}`,
        dropSockets: () => {
            for (const c of wss.clients) c.terminate();
        },
        liveSocketCount: () => wss.clients.size,
        close: () =>
            new Promise<void>((resolve) => {
                for (const c of wss.clients) c.terminate();
                wss.close(() => resolve());
            }),
    };
}

function makeInfo(id: string, name: string): ConversationInfo {
    return { conversationId: id, name } as ConversationInfo;
}

describe("connectAgentServer reconnect (rebind)", () => {
    test("reuses the connection and rebinds the control rpc across a reconnect", async () => {
        const stub = await startStubServer([makeInfo("a", "Shell")]);
        let dropped = 0;
        const connection = await connectAgentServer(stub.url, () => {
            dropped++;
        });
        try {
            const before = await connection.listConversations();
            expect(before.map((c) => c.conversationId)).toEqual(["a"]);

            // Drop the socket; the server stays listening so reconnect succeeds.
            stub.dropSockets();
            await new Promise((r) => setTimeout(r, 50));
            expect(dropped).toBeGreaterThanOrEqual(1);

            const ok = await connection.reconnect();
            expect(ok).toBe(true);

            // The same connection's control rpc works again over the rebound
            // channel (a poisoned, non-rebindable rpc would have thrown).
            const after = await connection.listConversations();
            expect(after.map((c) => c.conversationId)).toEqual(["a"]);
        } finally {
            await connection.close();
            await stub.close();
        }
    });

    test("a superseded socket's onclose after reconnect does not fire onDisconnect", async () => {
        const stub = await startStubServer([]);
        let dropped = 0;
        const connection = await connectAgentServer(stub.url, () => {
            dropped++;
        });
        try {
            // Proactively reconnect while the first socket is still open. This
            // bumps the transport generation and (via the defensive close)
            // makes the first socket's onclose arrive AFTER the supersede, so
            // the generation guard must swallow it.
            expect(await connection.reconnect()).toBe(true);
            await new Promise((r) => setTimeout(r, 100));
            // The superseded socket closed, but its onclose is guarded out.
            expect(dropped).toBe(0);
            // The defensive close dropped the old socket — only the new one is
            // live on the server (no leaked open socket).
            expect(stub.liveSocketCount()).toBe(1);
            // The connection still works over the rebound channel.
            expect(await connection.listConversations()).toEqual([]);
        } finally {
            await connection.close();
            await stub.close();
        }
    });

    test("a second drop after reconnect still fires onDisconnect", async () => {
        const stub = await startStubServer([]);
        let dropped = 0;
        const connection = await connectAgentServer(stub.url, () => {
            dropped++;
        });
        try {
            stub.dropSockets();
            await new Promise((r) => setTimeout(r, 50));
            expect(dropped).toBe(1);

            expect(await connection.reconnect()).toBe(true);

            // A second drop of the (new) live socket must fire onDisconnect
            // again — the generation guard must not permanently suppress it.
            stub.dropSockets();
            await new Promise((r) => setTimeout(r, 50));
            expect(dropped).toBe(2);
        } finally {
            await connection.close();
            await stub.close();
        }
    });

    test("reconnect() resolves false when the server is unreachable", async () => {
        const stub = await startStubServer([]);
        const connection = await connectAgentServer(stub.url, () => {});
        await stub.close();
        await new Promise((r) => setTimeout(r, 50));
        expect(await connection.reconnect()).toBe(false);
        await connection.close();
    });

    test("reconnect() resolves false after the connection is closed", async () => {
        const stub = await startStubServer([]);
        const connection = await connectAgentServer(stub.url, () => {});
        await connection.close();
        // A closed connection must not be resurrected by a stray reconnect().
        expect(await connection.reconnect()).toBe(false);
        await stub.close();
    });
});

describe("connectAgentServer leaveConversation on a dead channel", () => {
    test("dispatcher.close() resolves instead of throwing after a socket drop", async () => {
        const stub = await startStubServer([makeInfo("c1", "Shell")]);
        const connection = await connectAgentServer(stub.url, () => {});
        try {
            const conv = await connection.joinConversation(fakeClientIO);
            expect(conv.conversationId).toBe("c1");

            // Server drops the socket; the client's control channel
            // disconnects, so a subsequent control rpc rejects with
            // "Agent channel disconnected".
            stub.dropSockets();
            await new Promise((r) => setTimeout(r, 50));

            // dispatcher.close() leaves the conversation. The local channels are
            // already torn down and the server has vanished, so the moot server
            // notification must be swallowed rather than bubble up. In the shell
            // this previously popped an "Error closing instance" dialog on
            // window close after the agent server had disconnected.
            await expect(conv.dispatcher.close()).resolves.toBeUndefined();
        } finally {
            await connection.close();
            await stub.close();
        }
    });
});
