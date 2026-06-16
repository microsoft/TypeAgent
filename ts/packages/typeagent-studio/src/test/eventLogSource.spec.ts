// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type {
    StudioServiceInvokeFunctions,
    StudioClientCallFunctions,
} from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";
import { createWebSocketRpcChannel } from "../studioServiceClient.js";
import { stubInvokeHandlers } from "./stubInvokeHandlers.js";
import { StudioServiceEventSource } from "../eventLogSource.js";
import { StudioServiceConnection } from "../studioServiceConnection.js";

const SEED: StudioEvent[] = [
    { type: "sandbox.start", ts: 1 } as StudioEvent,
    { type: "sandbox.stop", ts: 2 } as StudioEvent,
];

/**
 * Real ws server speaking the Studio protocol: `queryRecentEvents` returns a
 * fixed seed; `subscribeEvents` pushes one live event shortly after.
 */
async function startStubServer(): Promise<{
    endpoint: string;
    close: () => Promise<void>;
}> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    server.on("connection", (socket) => {
        let push: (e: StudioEvent) => void = () => {};
        const handlers = stubInvokeHandlers({
            queryRecentEvents: async () => SEED,
            subscribeEvents: async () => {
                // Push a live event a beat after subscription (a real agent
                // pushes when events occur, not synchronously on subscribe).
                setTimeout(
                    () =>
                        push({
                            type: "collision.detected",
                            ts: 3,
                        } as StudioEvent),
                    20,
                );
            },
        });
        const rpc = createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            StudioServiceInvokeFunctions
        >("test:stub-server", createWebSocketRpcChannel(socket), handlers);
        push = (e) => {
            if (socket.readyState === socket.OPEN) {
                rpc.send("studioEvent", e);
            }
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

/** Wait until `predicate` is true or time out. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs)
            throw new Error("waitFor timed out");
        await new Promise((r) => setTimeout(r, 10));
    }
}

test("StudioServiceEventSource (over the shared connection) seeds + fans out live events", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
    });
    const source = new StudioServiceEventSource(connection);
    try {
        assert.equal(await connection.connect(), true);
        const received: StudioEvent[] = [];
        // Register before any awaited round-trip so the one-shot push isn't missed.
        const sub = source.onAnyEvent((e) => received.push(e));

        const seed = await source.queryRecentEvents(200);
        assert.deepEqual(
            seed.map((e) => e.type),
            ["sandbox.start", "sandbox.stop"],
        );

        // The live event is pushed ~20ms after subscribeEvents (done at connect).
        await waitFor(() => received.length === 1);
        assert.equal(received[0].type, "collision.detected");
        sub.dispose();
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("StudioServiceEventSource returns empty when the connection is down", async () => {
    const connection = new StudioServiceConnection(undefined, {
        endpoint: "ws://127.0.0.1:1", // nothing listening
        backoffMs: [10_000],
    });
    const source = new StudioServiceEventSource(connection);
    try {
        assert.equal(await connection.connect(), false);
        assert.deepEqual(await source.queryRecentEvents(10), []);
    } finally {
        connection.dispose();
    }
});
