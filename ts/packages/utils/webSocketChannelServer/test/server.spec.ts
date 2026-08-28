// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, test } from "@jest/globals";
import WebSocket from "ws";
import os from "node:os";

import { createWebSocketChannelServer } from "../src/server.js";

const openServers: Array<{ close: () => void }> = [];
const openClients: WebSocket[] = [];

// Fixed high ports (one per case) rather than port 0: the server object
// doesn't surface the bound port, and these tests need to dial a specific
// address to prove what the listener is reachable on.
let nextPort = 39411;
function takePort(): number {
    return nextPort++;
}

/** First non-internal IPv4 address of this machine, if it has one. */
function lanAddress(): string | undefined {
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (address.family === "IPv4" && !address.internal) {
                return address.address;
            }
        }
    }
    return undefined;
}

async function start(
    options: Parameters<typeof createWebSocketChannelServer>[0],
): Promise<void> {
    const server = await createWebSocketChannelServer(options, () => {});
    openServers.push(server);
}

function connect(
    host: string,
    port: number,
    origin?: string,
): Promise<"open" | "refused"> {
    return new Promise((resolve) => {
        const ws = new WebSocket(
            `ws://${host}:${port}`,
            origin === undefined ? undefined : { origin },
        );
        openClients.push(ws);
        ws.once("open", () => resolve("open"));
        ws.once("error", () => resolve("refused"));
    });
}

afterEach(() => {
    for (const ws of openClients.splice(0)) {
        ws.removeAllListeners();
        ws.close();
    }
    for (const server of openServers.splice(0)) {
        server.close();
    }
});

describe("createWebSocketChannelServer binding", () => {
    test("a port with no host binds loopback, not every interface", async () => {
        const port = takePort();
        await start({ port });

        await expect(connect("127.0.0.1", port)).resolves.toBe("open");

        // The channels served here are unauthenticated, so the listener must
        // not answer on this machine's network address.
        const lan = lanAddress();
        if (lan !== undefined) {
            await expect(connect(lan, port)).resolves.toBe("refused");
        }
    });

    test("an explicit host is passed through", async () => {
        const port = takePort();
        await start({ port, host: "localhost" });

        await expect(connect("localhost", port)).resolves.toBe("open");
    });
});

describe("createWebSocketChannelServer origin gate", () => {
    test("accepts native clients that send no Origin", async () => {
        const port = takePort();
        await start({ port });

        await expect(connect("127.0.0.1", port)).resolves.toBe("open");
    });

    test("accepts loopback and browser-extension origins", async () => {
        const port = takePort();
        await start({ port });

        await expect(
            connect("127.0.0.1", port, "http://localhost:3000"),
        ).resolves.toBe("open");
        await expect(
            connect("127.0.0.1", port, "chrome-extension://abcdef"),
        ).resolves.toBe("open");
    });

    test("accepts the Visual Studio chat panel's virtual-host origin", async () => {
        // The VS extension serves its WebView2 content from a virtual host
        // mapping and navigates to https://typeagent.local/index.html, so the
        // panel's upgrade carries that Origin instead of a loopback one.
        const port = takePort();
        await start({ port });

        await expect(
            connect("127.0.0.1", port, "https://typeagent.local"),
        ).resolves.toBe("open");
    });

    test("matches the Visual Studio origin exactly, not as a prefix", async () => {
        // A prefix test would accept this domain, which an attacker can
        // register.
        const port = takePort();
        await start({ port });

        await expect(
            connect("127.0.0.1", port, "https://typeagent.local.evil.example"),
        ).resolves.toBe("refused");
    });

    test("rejects a foreign web origin by default", async () => {
        const port = takePort();
        await start({ port });

        await expect(
            connect("127.0.0.1", port, "https://evil.example.com"),
        ).resolves.toBe("refused");
    });

    test("rejects the opaque origin a sandboxed iframe sends", async () => {
        // A hostile page can host a script-enabled sandboxed iframe, whose
        // handshake carries `Origin: null`. Honoring it would give that page
        // a way through to the dispatcher.
        const port = takePort();
        await start({ port });

        await expect(connect("127.0.0.1", port, "null")).resolves.toBe(
            "refused",
        );
    });

    test("an explicit predicate replaces the default policy", async () => {
        const port = takePort();
        await start({ port, isOriginAllowed: () => true });

        await expect(
            connect("127.0.0.1", port, "https://evil.example.com"),
        ).resolves.toBe("open");
    });
});
