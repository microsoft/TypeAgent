// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow LSP server.
 *
 * Phase 0 scope: minimal capabilities. Initializes, advertises
 * incremental text-document sync, and feeds opened documents into a
 * `TextDocuments` store so integration tests can verify the server is
 * wired correctly. Actual feature handlers (diagnostics, hover,
 * completion, etc.) are added in later phases.
 *
 * The {@link createServer} helper supports two transports:
 *   - default: stdio (used by the bin entry and the VS Code extension).
 *   - injected duplex streams: used by in-process jest integration
 *     tests so we never have to spawn a child process during CI.
 */

import {
    createConnection,
    Connection,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    StreamMessageReader,
    StreamMessageWriter,
    TextDocuments,
    TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Duplex } from "node:stream";

export interface ServerInstance {
    connection: Connection;
    documents: TextDocuments<TextDocument>;
    listen(): void;
    dispose(): void;
}

export interface ServerTransport {
    input: Duplex;
    output: Duplex;
}

export function createServer(transport?: ServerTransport): ServerInstance {
    const connection = transport
        ? createConnection(
              ProposedFeatures.all,
              new StreamMessageReader(transport.input),
              new StreamMessageWriter(transport.output),
          )
        : createConnection(ProposedFeatures.all);

    const documents = new TextDocuments<TextDocument>(TextDocument);

    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: TextDocumentSyncKind.Incremental,
                },
            },
            serverInfo: {
                name: "workflow-lsp",
                version: "0.0.1",
            },
        };
    });

    connection.onInitialized(() => {
        connection.console.info("workflow-lsp initialized");
    });

    documents.listen(connection);

    return {
        connection,
        documents,
        listen: () => connection.listen(),
        dispose: () => connection.dispose(),
    };
}
