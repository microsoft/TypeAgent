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
import { StudioServiceCollisionsSource } from "../collisionsSource.js";
import { StudioServiceConnection } from "../studioServiceConnection.js";

/**
 * Real ws server speaking the Studio protocol. `subscribeEvents` pushes a
 * `collision.detected` then a `sandbox.agent.loaded` event a beat later so the
 * source's listener fanout can be observed.
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
            scanGrammarCollisions: async () => ({
                scanned: ["player"],
                skipped: [],
                collisionCount: 0,
            }),
            subscribeEvents: async () => {
                setTimeout(() => {
                    push({ type: "collision.detected", ts: 1 } as StudioEvent);
                    push({
                        type: "sandbox.agent.loaded",
                        ts: 2,
                    } as StudioEvent);
                }, 20);
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

test("StudioServiceCollisionsSource delegates scan/clear and routes events", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
    });
    const source = new StudioServiceCollisionsSource(connection);
    try {
        assert.equal(await connection.connect(), true);
        // Register listeners BEFORE any awaited round-trips so the one-shot
        // push (~20ms after subscribe) isn't missed.
        let collisions = 0;
        let agentLoads = 0;
        source.onCollisionDetected(() => (collisions += 1));
        source.onAgentLoadChanged(() => (agentLoads += 1));

        const scan = await source.scanGrammarCollisions();
        assert.deepEqual(scan.scanned, ["player"]);
        assert.equal(await source.clearCollisions(), 0);

        const start = Date.now();
        while (
            (collisions < 1 || agentLoads < 1) &&
            Date.now() - start < 2000
        ) {
            await new Promise((r) => setTimeout(r, 10));
        }
        assert.equal(collisions, 1, "collision.detected routed");
        assert.equal(agentLoads, 1, "sandbox.agent.loaded routed");
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("StudioServiceCollisionsSource lists empty / throws on scan when disconnected", async () => {
    const connection = new StudioServiceConnection(undefined, {
        endpoint: "ws://127.0.0.1:1",
        backoffMs: [10_000],
    });
    const source = new StudioServiceCollisionsSource(connection);
    try {
        assert.equal(await connection.connect(), false);
        assert.deepEqual(await source.listCollisions(), []);
        assert.equal(await source.clearCollisions(), 0);
        await assert.rejects(() => source.scanGrammarCollisions());
    } finally {
        connection.dispose();
    }
});
