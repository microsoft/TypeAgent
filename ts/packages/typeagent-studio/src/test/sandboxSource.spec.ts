// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { StudioClientCallFunctions } from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";
import { createWebSocketRpcChannel } from "../studioServiceClient.js";
import { stubInvokeHandlers } from "./stubInvokeHandlers.js";
import { StudioServiceSandboxSource } from "../sandboxSource.js";
import { StudioServiceConnection } from "../studioServiceConnection.js";

async function startStubServer() {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    server.on("connection", (socket) => {
        let push: (e: StudioEvent) => void = () => {};
        const handlers = stubInvokeHandlers({
            listSandboxes: async () =>
                [
                    { id: "studio-default", agents: [], state: "running" },
                ] as never,
            startSandbox: async (_repoRoot, options) =>
                ({
                    id: options?.id ?? "studio-default",
                    agents: [],
                    state: "running",
                }) as never,
            subscribeEvents: async () => {
                setTimeout(
                    () =>
                        push({
                            type: "sandbox.agent.loaded",
                            ts: 1,
                        } as StudioEvent),
                    20,
                );
            },
        });
        const rpc = createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            ReturnType<typeof stubInvokeHandlers>
        >("test:stub", createWebSocketRpcChannel(socket), handlers);
        push = (e) => {
            if (socket.readyState === socket.OPEN) rpc.send("studioEvent", e);
        };
    });
    const port = (server.address() as { port: number }).port;
    return {
        endpoint: `ws://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve) => {
                for (const c of server.clients) c.terminate();
                server.close(() => resolve());
            }),
    };
}

test("StudioServiceSandboxSource delegates lifecycle + routes sandbox events", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
    });
    const source = new StudioServiceSandboxSource(connection);
    try {
        assert.equal(await connection.connect(), true);
        let changes = 0;
        source.onSandboxChanged(() => (changes += 1));

        assert.equal((await source.listSandboxes()).length, 1);
        const started = await source.startSandbox({ id: "s1" });
        assert.equal(started.id, "s1");

        const start = Date.now();
        while (changes < 1 && Date.now() - start < 2000) {
            await new Promise((r) => setTimeout(r, 10));
        }
        assert.equal(changes, 1, "sandbox.* event routed to onSandboxChanged");
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("StudioServiceSandboxSource: reads empty / mutations reject when disconnected", async () => {
    const connection = new StudioServiceConnection(undefined, {
        endpoint: "ws://127.0.0.1:1",
        baseBackoffMs: 10_000,
    });
    const source = new StudioServiceSandboxSource(connection);
    try {
        assert.equal(await connection.connect(), false);
        assert.deepEqual(await source.listSandboxes(), []);
        await assert.rejects(() => source.startSandbox());
        await assert.rejects(() => source.stopSandbox("s1"));
    } finally {
        connection.dispose();
    }
});
