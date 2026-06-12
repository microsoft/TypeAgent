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
import { StudioServiceEventSource } from "../eventLogSource.js";

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
        const handlers: StudioServiceInvokeFunctions = {
            getStudioInfo: async () => ({
                repoRootInfo: { repoRoot: "/repo/ts", agentsDirFound: true },
                agentLocations: [],
            }),
            listCollisions: async () => [],
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
        };
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

test("StudioServiceEventSource seeds via queryRecentEvents and fans out live events", async () => {
    const stub = await startStubServer();
    const source = await StudioServiceEventSource.connect({
        endpoint: stub.endpoint,
    });
    assert.ok(source, "source should connect to the stub endpoint");
    try {
        const seed = await source!.queryRecentEvents(200);
        assert.deepEqual(
            seed.map((e) => e.type),
            ["sandbox.start", "sandbox.stop"],
        );

        const received: StudioEvent[] = [];
        const sub = source!.onAnyEvent((e) => received.push(e));
        // The live event is pushed ~20ms after subscribeEvents (done at
        // connect); the listener is attached above before it fires.
        await new Promise((r) => setTimeout(r, 80));
        assert.equal(received.length, 1);
        assert.equal(received[0].type, "collision.detected");

        // Disposing the listener stops further fanout.
        sub.dispose();
    } finally {
        source!.dispose();
        await stub.close();
    }
});

test("StudioServiceEventSource.connect returns undefined when discovery finds nothing", async () => {
    const source = await StudioServiceEventSource.connect({
        agentServerUrl: "ws://127.0.0.1:1", // nothing listening
    });
    assert.equal(source, undefined);
});

test("StudioServiceEventSource invokes onClosed when the socket drops", async () => {
    const stub = await startStubServer();
    let closed = false;
    const source = await StudioServiceEventSource.connect({
        endpoint: stub.endpoint,
        onClosed: () => {
            closed = true;
        },
    });
    assert.ok(source);
    try {
        // Server-side close should propagate to the client's onClose.
        await stub.close();
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(closed, true);
    } finally {
        source!.dispose();
    }
});
