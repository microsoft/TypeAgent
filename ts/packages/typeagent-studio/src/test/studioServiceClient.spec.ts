// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type {
    StudioInfo,
    StudioServiceInvokeFunctions,
    StudioClientCallFunctions,
} from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";
import {
    StudioServiceClient,
    createWebSocketRpcChannel,
} from "../studioServiceClient.js";
import { stubInvokeHandlers } from "./stubInvokeHandlers.js";

const STUB_INFO: StudioInfo = {
    repoRootInfo: { repoRoot: "/repo/ts", agentsDirFound: true },
    agentLocations: [
        { root: "/repo/ts/packages/agents", exists: true, agentCount: 3 },
    ],
};

/**
 * Start a real ws server that speaks the Studio service protocol with stub
 * handlers, so the client is exercised over an actual socket. Returns the bound
 * `ws://` endpoint and a close fn.
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
            getStudioInfo: async () => STUB_INFO,
            subscribeEvents: async () => {
                // Emit one event shortly after subscription.
                setTimeout(
                    () =>
                        push({
                            type: "collision.detected",
                            ts: 1,
                        } as StudioEvent),
                    0,
                );
            },
        });
        const rpc = createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            StudioServiceInvokeFunctions
        >("test:stub-server", createWebSocketRpcChannel(socket), handlers);
        push = (e) => rpc.send("studioEvent", e);
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

test("StudioServiceClient round-trips getStudioInfo over a real socket", async () => {
    const stub = await startStubServer();
    const client = await StudioServiceClient.connect({
        endpoint: stub.endpoint,
    });
    assert.ok(client, "client should connect to the stub endpoint");
    try {
        const info = await client!.getStudioInfo();
        assert.equal(info.repoRootInfo.repoRoot, "/repo/ts");
        assert.equal(info.agentLocations[0].agentCount, 3);
    } finally {
        client!.close();
        await stub.close();
    }
});

test("StudioServiceClient receives pushed events after subscribeEvents", async () => {
    const stub = await startStubServer();
    const received: StudioEvent[] = [];
    const client = await StudioServiceClient.connect({
        endpoint: stub.endpoint,
        onEvent: (e) => received.push(e),
    });
    assert.ok(client);
    try {
        await client!.subscribeEvents();
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(received.length, 1);
        assert.equal(received[0].type, "collision.detected");
    } finally {
        client!.close();
        await stub.close();
    }
});

test("StudioServiceClient.connect returns undefined when no endpoint is supplied", async () => {
    // No discovery fallback — without a launcher-resolved endpoint, connect is a
    // graceful no-op (the caller keeps retrying until a target is set).
    const client = await StudioServiceClient.connect({ repoRoot: "/repo/ts" });
    assert.equal(client, undefined);
});

test("StudioServiceClient presents the capability token as a Bearer header", async () => {
    const TOKEN = "a".repeat(64);
    // A server that only accepts the right Bearer token.
    const server = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
        verifyClient: (info, cb) => {
            const auth = info.req.headers.authorization;
            cb(auth === `Bearer ${TOKEN}`, 401, "Unauthorized");
        },
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    server.on("connection", (socket) => {
        const handlers = stubInvokeHandlers({
            getStudioInfo: async () => STUB_INFO,
        });
        createRpc<
            Record<string, never>,
            StudioClientCallFunctions,
            StudioServiceInvokeFunctions
        >("test:auth-server", createWebSocketRpcChannel(socket), handlers);
    });
    const port = (server.address() as { port: number }).port;
    const endpoint = `ws://127.0.0.1:${port}`;
    const close = () =>
        new Promise<void>((resolve) => {
            for (const c of server.clients) c.terminate();
            server.close(() => resolve());
        });
    try {
        // Correct token → connects and round-trips.
        const ok = await StudioServiceClient.connect({
            endpoint,
            token: TOKEN,
        });
        assert.ok(ok, "should connect with the correct token");
        assert.equal(
            (await ok!.getStudioInfo()).repoRootInfo.repoRoot,
            "/repo/ts",
        );
        ok!.close();

        // Wrong token → upgrade rejected → undefined (graceful).
        const bad = await StudioServiceClient.connect({
            endpoint,
            token: "b".repeat(64),
        });
        assert.equal(bad, undefined);
    } finally {
        await close();
    }
});
