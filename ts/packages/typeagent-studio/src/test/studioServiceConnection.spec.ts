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
import {
    StudioServiceConnection,
    type StudioConnectionState,
} from "../studioServiceConnection.js";

async function startStubServer(): Promise<{
    endpoint: string;
    push: (e: StudioEvent) => void;
    dropSockets: () => void;
    close: () => Promise<void>;
}> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const pushers = new Set<(e: StudioEvent) => void>();
    server.on("connection", (socket) => {
        const handlers = stubInvokeHandlers();
        const rpc = createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            StudioServiceInvokeFunctions
        >("test:stub", createWebSocketRpcChannel(socket), handlers);
        const p = (e: StudioEvent) => {
            if (socket.readyState === socket.OPEN) rpc.send("studioEvent", e);
        };
        pushers.add(p);
        socket.on("close", () => pushers.delete(p));
    });
    const port = (server.address() as { port: number }).port;
    return {
        endpoint: `ws://127.0.0.1:${port}`,
        push: (e) => pushers.forEach((p) => p(e)),
        // Drop connected sockets but keep the server listening, so a client's
        // retry reconnects (and rebinds) instead of failing.
        dropSockets: () => {
            for (const c of server.clients) c.terminate();
        },
        close: () =>
            new Promise<void>((resolve) => {
                for (const c of server.clients) c.terminate();
                server.close(() => resolve());
            }),
    };
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs = 2000,
): Promise<void> {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 10));
    }
}

test("connects, transitions state, and fans out events", async () => {
    const stub = await startStubServer();
    const states: StudioConnectionState[] = [];
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
    });
    connection.onStateChanged((s) => states.push(s));
    try {
        const ok = await connection.connect();
        assert.equal(ok, true);
        assert.equal(connection.currentState, "connected");
        // Immediate "disconnected" + "connecting" + "connected".
        assert.deepEqual(states, ["disconnected", "connecting", "connected"]);

        const received: StudioEvent[] = [];
        connection.onEvent((e) => received.push(e));
        stub.push({ type: "collision.detected", ts: 1 } as StudioEvent);
        const start = Date.now();
        while (received.length < 1 && Date.now() - start < 2000) {
            await new Promise((r) => setTimeout(r, 10));
        }
        assert.equal(received.length, 1);
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("connect() is single-flight", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
    });
    try {
        const [a, b] = await Promise.all([
            connection.connect(),
            connection.connect(),
        ]);
        assert.equal(a, true);
        assert.equal(b, true);
        assert.equal(connection.currentState, "connected");
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("a dropped socket transitions back to disconnected", async () => {
    const stub = await startStubServer();
    // Long backoff so the scheduled retry doesn't fire during the test.
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
        backoffMs: [60_000],
    });
    try {
        assert.equal(await connection.connect(), true);
        await stub.close();
        const start = Date.now();
        while (
            connection.currentState !== "disconnected" &&
            Date.now() - start < 2000
        ) {
            await new Promise((r) => setTimeout(r, 10));
        }
        assert.equal(connection.currentState, "disconnected");
        assert.equal(connection.getClient(), undefined);
    } finally {
        connection.dispose();
    }
});

test("connect() resolves false when unreachable", async () => {
    const connection = new StudioServiceConnection(undefined, {
        endpoint: "ws://127.0.0.1:1",
        backoffMs: [60_000],
    });
    try {
        assert.equal(await connection.connect(), false);
        assert.equal(connection.currentState, "disconnected");
    } finally {
        connection.dispose();
    }
});

test("reuses the same client across a reconnect (rebind, not recreate)", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
        backoffMs: [50],
    });
    try {
        assert.equal(await connection.connect(), true);
        const client1 = connection.getClient();
        assert.ok(client1);

        // Drop the socket; the server stays listening so the retry reconnects.
        stub.dropSockets();
        await waitFor(() => connection.currentState === "disconnected");
        // Contract preserved: no client surfaced while disconnected.
        assert.equal(connection.getClient(), undefined);

        await waitFor(() => connection.currentState === "connected");
        const client2 = connection.getClient();
        assert.ok(client2);
        // Same object, rebound to a fresh socket (reaching "connected" also
        // proves subscribeEvents was re-invoked over the rebound rpc).
        assert.equal(client2, client1);
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("delivers events over the rebound socket after a reconnect", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
        backoffMs: [50],
    });
    const received: StudioEvent[] = [];
    connection.onEvent((e) => received.push(e));
    try {
        assert.equal(await connection.connect(), true);

        stub.dropSockets();
        await waitFor(() => connection.currentState === "disconnected");
        await waitFor(() => connection.currentState === "connected");

        stub.push({ type: "collision.detected", ts: 2 } as StudioEvent);
        await waitFor(() => received.length >= 1);
        assert.equal(received.length >= 1, true);
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("keeps the same client across multiple sequential reconnects", async () => {
    const stub = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stub.endpoint,
        backoffMs: [50],
    });
    try {
        assert.equal(await connection.connect(), true);
        const client1 = connection.getClient();
        assert.ok(client1);

        for (let i = 0; i < 3; i++) {
            stub.dropSockets();
            await waitFor(() => connection.currentState === "disconnected");
            await waitFor(() => connection.currentState === "connected");
            assert.equal(connection.getClient(), client1);
        }
    } finally {
        connection.dispose();
        await stub.close();
    }
});

test("setTarget connects a fresh client to the new endpoint (no stale reuse)", async () => {
    const stubA = await startStubServer();
    const stubB = await startStubServer();
    const connection = new StudioServiceConnection(undefined, {
        endpoint: stubA.endpoint,
        backoffMs: [50],
    });
    try {
        assert.equal(await connection.connect(), true);
        const clientA = connection.getClient();
        assert.ok(clientA);

        // Re-point at a different service; the old client stored the old
        // endpoint, so it must not be reused — a fresh client connects to B.
        connection.setTarget({ endpoint: stubB.endpoint, token: "" });
        await waitFor(() => connection.currentState === "connected");
        const clientB = connection.getClient();
        assert.ok(clientB);
        assert.notEqual(clientB, clientA);
    } finally {
        connection.dispose();
        await stubA.close();
        await stubB.close();
    }
});
