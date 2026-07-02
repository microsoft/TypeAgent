// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { AddressInfo, WebSocketServer } from "ws";

import { attachHeartbeat } from "../src/heartbeat.js";

// Short sweep so the deadline (2 intervals) elapses quickly. A stale
// peer is reaped in `intervalMs`..`2 * intervalMs`.
const INTERVAL_MS = 40;

const openServers: WebSocketServer[] = [];
const openClients: WebSocket[] = [];
const stops: Array<() => void> = [];

async function startServer(): Promise<{ wss: WebSocketServer; url: string }> {
    const wss = new WebSocketServer({ port: 0 });
    openServers.push(wss);
    await new Promise<void>((resolve, reject) => {
        wss.once("listening", () => resolve());
        wss.once("error", reject);
    });
    const addr = wss.address() as AddressInfo;
    return { wss, url: `ws://localhost:${addr.port}` };
}

function connect(url: string, options?: WebSocket.ClientOptions): WebSocket {
    const ws = new WebSocket(url, options);
    openClients.push(ws);
    return ws;
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
}

function waitForClose(ws: WebSocket, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("client did not close in time")),
            timeoutMs,
        );
        ws.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("condition not met in time");
        }
        await delay(5);
    }
}

afterEach(async () => {
    for (const stop of stops.splice(0)) {
        stop();
    }
    for (const ws of openClients.splice(0)) {
        try {
            ws.terminate();
        } catch {
            // already closed
        }
    }
    for (const wss of openServers.splice(0)) {
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
});

describe("attachHeartbeat", () => {
    it("terminates a client that never answers a ping", async () => {
        const { wss, url } = await startServer();
        stops.push(attachHeartbeat(wss, { intervalMs: INTERVAL_MS }));

        // autoPong:false makes ws ignore incoming pings — simulates a
        // half-open / dormant peer.
        const client = connect(url, { autoPong: false });
        await waitForOpen(client);

        await waitForClose(client, INTERVAL_MS * 10);
        // The server-side `close` (and its `wss.clients` removal) may
        // land a tick after the client observes the drop.
        await waitFor(() => wss.clients.size === 0, INTERVAL_MS * 10);
        expect(wss.clients.size).toBe(0);
    });

    it("keeps a responsive client connected across many sweeps", async () => {
        const { wss, url } = await startServer();
        stops.push(attachHeartbeat(wss, { intervalMs: INTERVAL_MS }));

        const client = connect(url); // default autoPong:true
        await waitForOpen(client);

        await delay(INTERVAL_MS * 6);
        expect(client.readyState).toBe(WebSocket.OPEN);
        expect(wss.clients.size).toBe(1);
    });

    it("invokes onStale before terminating a dead client", async () => {
        const { wss, url } = await startServer();
        let staleCount = 0;
        stops.push(
            attachHeartbeat(wss, {
                intervalMs: INTERVAL_MS,
                onStale: () => {
                    staleCount++;
                },
            }),
        );

        const client = connect(url, { autoPong: false });
        await waitForOpen(client);

        await waitForClose(client, INTERVAL_MS * 10);
        expect(staleCount).toBe(1);
    });

    it("stops sweeping after the returned stop() is called", async () => {
        const { wss, url } = await startServer();
        const stop = attachHeartbeat(wss, { intervalMs: INTERVAL_MS });
        stop();

        // With the sweep stopped, even a non-ponging client is left alone.
        const client = connect(url, { autoPong: false });
        await waitForOpen(client);

        await delay(INTERVAL_MS * 6);
        expect(client.readyState).toBe(WebSocket.OPEN);
        expect(wss.clients.size).toBe(1);
    });
});
