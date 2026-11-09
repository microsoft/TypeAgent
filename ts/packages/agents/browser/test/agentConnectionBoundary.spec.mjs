// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { AgentWebSocketServer } from "../dist/agent/agentWebSocketServer.mjs";

async function connect(server, clientId, sessionId = "session", origin) {
    const query = new URLSearchParams({ clientId, sessionId });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/?${query}`, {
        ...(origin ? { origin } : {}),
    });
    const provider = createChannelProviderAdapter("boundary-test", (message) =>
        socket.send(JSON.stringify(message)),
    );
    socket.on("message", (bytes) => {
        const message = JSON.parse(bytes.toString());
        if (message.name !== undefined) provider.notifyMessage(message);
    });
    const rpc = createRpc(
        "boundary-service",
        provider.createChannel("agentService"),
    );
    createRpc("boundary-control", provider.createChannel("browserControl"), {
        runBrowserAction: async (actionName) => ({ actionName }),
    });
    await once(socket, "open");
    return { socket, rpc };
}

function handlers(label = "corpus") {
    return {
        memoryListCorpora: async () => [label],
        memoryImportDocument: async (request) => ({
            sourceId: label,
            ...request,
        }),
    };
}

for (const [name, clientId, origin] of [
    ["native no-Origin", "native", undefined],
    ["inline browser", "inlineBrowser", undefined],
    ["extension", "extension", "chrome-extension://extension"],
    ["loopback", "web", "http://localhost:9000"],
]) {
    test(`${name} routes ordinary Markdown memory RPC without PDF handshakes`, async () => {
        const server = await AgentWebSocketServer.start();
        try {
            server.registerSession("session", {
                agentInvokeHandlers: handlers(),
            });
            const { socket, rpc } = await connect(
                server,
                clientId,
                "session",
                origin,
            );
            socket.send("null");
            socket.send("not-json");
            assert.deepEqual(await rpc.invoke("memoryListCorpora", {}), [
                "corpus",
            ]);
            const request = {
                corpusId: "corpus",
                title: "Paper",
                markdown: "# Paper",
            };
            assert.deepEqual(
                await rpc.invoke("memoryImportDocument", request),
                {
                    sourceId: "corpus",
                    ...request,
                },
            );
            await assert.rejects(rpc.invoke("pdfAuthorize", {}));
            assert.deepEqual(
                await server
                    .getClient("session", clientId)
                    .browserControlRpc.invoke(
                        "runBrowserAction",
                        "ordinaryAction",
                        {},
                        "browser",
                    ),
                { actionName: "ordinaryAction" },
            );
        } finally {
            await server.close();
        }
    });
}

test("late registration wires ordinary memory handlers", async () => {
    const server = await AgentWebSocketServer.start();
    try {
        const { rpc } = await connect(server, "client");
        server.registerSession("session", { agentInvokeHandlers: handlers() });
        assert.deepEqual(await rpc.invoke("memoryListCorpora", {}), ["corpus"]);
    } finally {
        await server.close();
    }
});

test("session routing and duplicate reconnect stay scoped to their session", async () => {
    const server = await AgentWebSocketServer.start();
    try {
        for (const sessionId of ["first", "second"]) {
            server.registerSession(sessionId, {
                agentInvokeHandlers: handlers(sessionId),
            });
        }
        const first = await connect(server, "client", "first");
        const second = await connect(server, "client", "second");
        const closed = once(first.socket, "close");
        const replacement = await connect(server, "client", "first");
        assert.equal((await closed)[0], 1013);
        assert.deepEqual(
            await replacement.rpc.invoke("memoryListCorpora", {}),
            ["first"],
        );
        assert.deepEqual(await second.rpc.invoke("memoryListCorpora", {}), [
            "second",
        ]);
        const disconnected = once(replacement.socket, "close");
        server.unregisterSession("first");
        await disconnected;
        assert.deepEqual(await second.rpc.invoke("memoryListCorpora", {}), [
            "second",
        ]);
    } finally {
        await server.close();
    }
});

test("general Origin boundary rejects arbitrary web pages before registration", async () => {
    const server = await AgentWebSocketServer.start();
    try {
        const socket = new WebSocket(
            `ws://127.0.0.1:${server.port}/?clientId=web&sessionId=session`,
            {
                origin: "https://attacker.example",
            },
        );
        const [error] = await once(socket, "error");
        assert.match(error.message, /403/);
        assert.equal(server.listClients().length, 0);
    } finally {
        await server.close();
    }
});
