// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Phase 0 integration smoke test: spin the server up on an in-process
 * stream pair, send `initialize`, and assert the capability response.
 */

import { PassThrough } from "node:stream";
import {
    createProtocolConnection,
    InitializeRequest,
    InitializedNotification,
    StreamMessageReader,
    StreamMessageWriter,
    TextDocumentSyncKind,
} from "vscode-languageserver-protocol/node.js";
import { createServer } from "../src/server.js";

function makePipes() {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const clientReader = new StreamMessageReader(serverToClient);
    const clientWriter = new StreamMessageWriter(clientToServer);
    return {
        serverTransport: { input: clientToServer, output: serverToClient },
        clientReader,
        clientWriter,
    };
}

describe("workflow-lsp server (phase 0)", () => {
    it("returns capabilities on initialize", async () => {
        const { serverTransport, clientReader, clientWriter } = makePipes();

        const server = createServer(serverTransport);
        server.listen();

        const client = createProtocolConnection(clientReader, clientWriter);
        client.listen();

        try {
            const result = await client.sendRequest(InitializeRequest.type, {
                processId: process.pid,
                rootUri: null,
                capabilities: {},
                workspaceFolders: null,
            });
            await client.sendNotification(InitializedNotification.type, {});

            expect(result.serverInfo?.name).toBe("workflow-lsp");
            expect(
                (result.capabilities.textDocumentSync as any).openClose,
            ).toBe(true);
            expect((result.capabilities.textDocumentSync as any).change).toBe(
                TextDocumentSyncKind.Incremental,
            );
        } finally {
            client.dispose();
            server.dispose();
            clientReader.dispose();
            clientWriter.dispose();
            serverTransport.input.destroy();
            serverTransport.output.destroy();
        }
    });
});
