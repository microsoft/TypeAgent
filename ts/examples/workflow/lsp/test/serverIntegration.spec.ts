// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration tests for the server's diagnostics + didClose handling.
 *
 * Uses the in-process duplex transport from createServer so we can
 * drive the server over real JSON-RPC without spawning a child.
 */

import { PassThrough } from "node:stream";
import {
    createProtocolConnection,
    DidOpenTextDocumentNotification,
    DidCloseTextDocumentNotification,
    InitializeRequest,
    InitializedNotification,
    PublishDiagnosticsNotification,
    PublishDiagnosticsParams,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-languageserver-protocol/node.js";
import { createServer } from "../src/server.js";

function makePipes() {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    return {
        serverTransport: { input: clientToServer, output: serverToClient },
        clientReader: new StreamMessageReader(serverToClient),
        clientWriter: new StreamMessageWriter(clientToServer),
    };
}

async function startSession(debounceMs = 5) {
    const pipes = makePipes();
    const server = createServer(pipes.serverTransport, {
        diagnosticsDebounceMs: debounceMs,
    });
    server.listen();
    const client = createProtocolConnection(
        pipes.clientReader,
        pipes.clientWriter,
    );
    client.listen();

    const publishes: PublishDiagnosticsParams[] = [];
    client.onNotification(PublishDiagnosticsNotification.type, (p) =>
        publishes.push(p),
    );

    await client.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
    });
    await client.sendNotification(InitializedNotification.type, {});

    return {
        client,
        server,
        publishes,
        cleanup: () => {
            client.dispose();
            server.dispose();
            pipes.serverTransport.input.end();
            pipes.serverTransport.output.end();
        },
    };
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs)
                return reject(new Error("waitFor timed out"));
            setTimeout(tick, 5).unref();
        };
        tick();
    });
}

describe("server integration", () => {
    it("publishes diagnostics on didOpen", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///t.wf",
                        languageId: "workflow",
                        version: 1,
                        text: "workflow w(): string { return unknownIdent; }",
                    },
                },
            );

            await waitFor(() => session.publishes.length >= 1);
            expect(session.publishes[0]!.uri).toBe("file:///t.wf");
            expect(session.publishes[0]!.diagnostics.length).toBeGreaterThan(0);
        } finally {
            session.cleanup();
        }
    });

    it("clears diagnostics on didClose", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///t.wf",
                        languageId: "workflow",
                        version: 1,
                        text: "workflow broken( {",
                    },
                },
            );
            await waitFor(
                () =>
                    session.publishes.some(
                        (p) => p.diagnostics.length > 0,
                    ),
            );

            await session.client.sendNotification(
                DidCloseTextDocumentNotification.type,
                { textDocument: { uri: "file:///t.wf" } },
            );

            await waitFor(() =>
                session.publishes.some(
                    (p) =>
                        p.uri === "file:///t.wf" &&
                        p.diagnostics.length === 0,
                ),
            );
        } finally {
            session.cleanup();
        }
    });
});
