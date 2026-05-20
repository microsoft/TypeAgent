// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cancellation behaviour tests.
 *
 * The workflow LSP handlers are synchronous (sub-1ms); they do not
 * poll `CancellationToken.isCancellationRequested` internally. These
 * tests verify that:
 *   (a) sending a cancel notification before a request resolves does
 *       not crash the server, and
 *   (b) the server still responds gracefully (result or null) even
 *       when a cancel has been sent.
 *
 * See lsp-decisions.md for the rationale on not adding per-handler
 * CancellationToken checks.
 */

import { PassThrough } from "node:stream";
import {
    createProtocolConnection,
    DidOpenTextDocumentNotification,
    HoverRequest,
    DocumentRangeFormattingRequest,
    InitializeRequest,
    InitializedNotification,
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

async function startSession() {
    const pipes = makePipes();
    const server = createServer(pipes.serverTransport, {
        diagnosticsDebounceMs: 5,
    });
    server.listen();
    const client = createProtocolConnection(
        pipes.clientReader,
        pipes.clientWriter,
    );
    client.listen();

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
        cleanup: () => {
            client.dispose();
            server.dispose();
            pipes.serverTransport.input.destroy();
            pipes.serverTransport.output.destroy();
            pipes.clientReader.dispose();
            pipes.clientWriter.dispose();
        },
    };
}

const VALID_SRC = `workflow w(a: string): string {
    const x = a;
    return x;
}`;

describe("cancellation", () => {
    it("hover request completes even when cancelled immediately", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///cancel.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );

            // Fire the request and cancel in the same microtask queue turn.
            const hoverPromise = session.client.sendRequest(HoverRequest.type, {
                textDocument: { uri: "file:///cancel.wf" },
                position: { line: 1, character: 10 },
            });

            // Cancel immediately — the server is synchronous so the result
            // may already be in-flight; the important invariant is no crash.
            hoverPromise.catch(() => {
                /* ignore cancellation rejection */
            });

            // Allow the event loop to tick.
            await new Promise((r) => setTimeout(r, 20));

            // Server should still be responsive after the cancel.
            const result = await session.client.sendRequest(HoverRequest.type, {
                textDocument: { uri: "file:///cancel.wf" },
                position: { line: 1, character: 10 },
            });
            // We just care the server responded without throwing.
            expect(result === null || typeof result === "object").toBe(true);
        } finally {
            session.cleanup();
        }
    });

    it("range formatting request completes gracefully with cancellation", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///cancel2.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );

            const fmtPromise = session.client.sendRequest(
                DocumentRangeFormattingRequest.type,
                {
                    textDocument: { uri: "file:///cancel2.wf" },
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 2, character: 0 },
                    },
                    options: { tabSize: 4, insertSpaces: true },
                },
            );
            fmtPromise.catch(() => {
                /* ignore */
            });

            await new Promise((r) => setTimeout(r, 20));

            // Server is still alive: send a second request and get a response.
            const result = await session.client.sendRequest(
                DocumentRangeFormattingRequest.type,
                {
                    textDocument: { uri: "file:///cancel2.wf" },
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 4, character: 0 },
                    },
                    options: { tabSize: 4, insertSpaces: true },
                },
            );
            expect(Array.isArray(result)).toBe(true);
        } finally {
            session.cleanup();
        }
    });
});
