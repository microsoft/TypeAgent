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
import {
    StudioServiceConnection,
    type StudioConnectionState,
} from "../studioServiceConnection.js";

async function startStubServer(): Promise<{
    endpoint: string;
    push: (e: StudioEvent) => void;
    close: () => Promise<void>;
}> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const pushers = new Set<(e: StudioEvent) => void>();
    server.on("connection", (socket) => {
        const handlers: StudioServiceInvokeFunctions = {
            getStudioInfo: async () => ({
                repoRootInfo: { repoRoot: "/repo/ts", agentsDirFound: true },
                agentLocations: [],
            }),
            listCollisions: async () => [],
            scanGrammarCollisions: async () => ({
                scanned: [],
                skipped: [],
                collisionCount: 0,
            }),
            clearCollisions: async () => 0,
            queryRecentEvents: async () => [],
            listCorpusAgents: async () => [],
            replayCorpus: async () => ({
                runId: "r",
                summary: {} as never,
                rows: [],
            }),
            subscribeEvents: async () => {},
            unsubscribeEvents: async () => {},
        };
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
        close: () =>
            new Promise<void>((resolve) => {
                for (const c of server.clients) c.terminate();
                server.close(() => resolve());
            }),
    };
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
