// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    DiscoveryChannelName,
    DiscoveryInvokeFunctions,
} from "@typeagent/agent-server-protocol";
import WebSocket, { AddressInfo, WebSocketServer } from "ws";

import { discoverPort } from "../src/discovery.js";

// Each test spins up a real ws server that speaks the agent-rpc
// discovery channel protocol so we exercise the actual wire format
// (createChannelProviderAdapter + createRpc) rather than mocking out
// the framing. This mirrors what `createWebSocketChannelServer` does
// internally but lets us read the bound port off the underlying ws
// server (its wrapper doesn't expose `address()`).
type LookupArgs = { agentName: string; role?: string };

async function startDiscoveryServer(
    lookup: (args: LookupArgs) => { port: number | null },
): Promise<{ url: string; close: () => Promise<void> }> {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve, reject) => {
        wss.once("listening", () => resolve());
        wss.once("error", reject);
    });

    wss.on("connection", (ws) => {
        const channelProvider = createChannelProviderAdapter(
            "test:discovery:server",
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

        const functions: DiscoveryInvokeFunctions = {
            // exactOptionalPropertyTypes makes `role?: string` reject an
            // explicit `undefined`, so omit it conditionally.
            lookupPort: async ({ agentName, role }) => {
                const args: LookupArgs =
                    role === undefined ? { agentName } : { agentName, role };
                return lookup(args);
            },
        };
        createRpc(
            "test:discovery",
            channelProvider.createChannel(DiscoveryChannelName),
            functions,
        );
    });

    const port = (wss.address() as AddressInfo).port;
    return {
        url: `ws://localhost:${port}`,
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) {
                    client.terminate();
                }
                wss.close(() => resolve());
            }),
    };
}

describe("discoverPort", () => {
    let teardown: (() => Promise<void>) | undefined;

    afterEach(async () => {
        if (teardown !== undefined) {
            await teardown();
            teardown = undefined;
        }
    });

    it("returns 'found' with the port when the agent is registered", async () => {
        const started = await startDiscoveryServer(({ agentName, role }) => {
            expect(agentName).toBe("code");
            expect(role).toBe("default");
            return { port: 54321 };
        });
        teardown = started.close;

        const result = await discoverPort("code", "default", {
            url: started.url,
        });
        expect(result).toEqual({ kind: "found", port: 54321 });
    });

    it("returns 'not-registered' when the server reports a null port", async () => {
        const started = await startDiscoveryServer(() => ({ port: null }));
        teardown = started.close;

        const result = await discoverPort("code", undefined, {
            url: started.url,
        });
        expect(result).toEqual({ kind: "not-registered" });
    });

    it("returns 'unreachable' when nothing is listening on the URL", async () => {
        // Bind a server only to discover a free port, then immediately
        // release it so the connect attempt is guaranteed to fail. The
        // alternative (a hardcoded port like 1) is flaky across CI.
        const wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((resolve) => wss.once("listening", resolve));
        const port = (wss.address() as AddressInfo).port;
        await new Promise<void>((resolve) => wss.close(() => resolve()));

        const result = await discoverPort("code", undefined, {
            url: `ws://localhost:${port}`,
            timeoutMs: 2_000,
        });
        expect(result.kind).toBe("unreachable");
        if (result.kind === "unreachable") {
            expect(result.error).toBeInstanceOf(Error);
        }
    });

    it("returns 'unreachable' when the lookup exceeds timeoutMs", async () => {
        // Accept the WS but never resolve the lookup, so the client
        // hits the timeout branch.
        const started = await startDiscoveryServer(
            () => new Promise(() => {}) as never,
        );
        teardown = started.close;

        const start = Date.now();
        const result = await discoverPort("code", undefined, {
            url: started.url,
            timeoutMs: 250,
        });
        const elapsed = Date.now() - start;
        expect(result.kind).toBe("unreachable");
        // Sanity-check the timer fired in roughly the configured window.
        // Bounds are generous to avoid CI flakes.
        expect(elapsed).toBeGreaterThanOrEqual(200);
        expect(elapsed).toBeLessThan(2_000);
    });
});
