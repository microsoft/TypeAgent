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
import { computeDiagnostics } from "./features/diagnostics.js";
import { formatDocument, formatDocumentRange } from "./features/formatting.js";
import { computeDocumentSymbols } from "./features/symbols.js";
import { computeHover } from "./features/hover.js";
import { computeDefinition } from "./features/definition.js";
import { computeReferences } from "./features/references.js";
import { computeCompletions } from "./features/completion.js";
import {
    computeSemanticTokens,
    semanticTokensLegend,
} from "./features/semanticTokens.js";
import { computeSignatureHelp } from "./features/signatureHelp.js";
import { computeInlayHints } from "./features/inlayHints.js";
import {
    computePrepareRename,
    computeRename,
} from "./features/rename.js";
import { compileIR, type CompileIRParams } from "./features/compileIR.js";
import { computeCodeActions } from "./features/codeActions.js";
import { invalidate } from "./parsedDocument.js";
import { loadTaskSchemas } from "./taskSchemas.js";

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

export interface ServerOptions {
    /** Debounce window for diagnostics, in ms. Default 100ms. */
    diagnosticsDebounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 100;

export function createServer(
    transport?: ServerTransport,
    options: ServerOptions = {},
): ServerInstance {
    const debounceMs = options.diagnosticsDebounceMs ?? DEFAULT_DEBOUNCE_MS;

    const connection = transport
        ? createConnection(
              ProposedFeatures.all,
              new StreamMessageReader(transport.input),
              new StreamMessageWriter(transport.output),
          )
        : createConnection(ProposedFeatures.all);

    const documents = new TextDocuments<TextDocument>(TextDocument);
    const schemas = loadTaskSchemas();
    const pendingDiagnostics = new Map<string, NodeJS.Timeout>();

    connection.onInitialize((_params: InitializeParams): InitializeResult => {
        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: TextDocumentSyncKind.Incremental,
                },
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                documentSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                completionProvider: { triggerCharacters: ["."] },
                signatureHelpProvider: { triggerCharacters: ["(", ","] },
                inlayHintProvider: true,
                renameProvider: { prepareProvider: true },
                codeActionProvider: { codeActionKinds: ["refactor.rewrite", "refactor.extract", "refactor.inline"] },
                semanticTokensProvider: {
                    legend: semanticTokensLegend,
                    full: true,
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

    function scheduleDiagnostics(uri: string) {
        const existing = pendingDiagnostics.get(uri);
        if (existing) clearTimeout(existing);
        const handle = setTimeout(() => {
            pendingDiagnostics.delete(uri);
            const doc = documents.get(uri);
            if (!doc) return;
            const diagnostics = computeDiagnostics(doc.getText(), schemas);
            void connection.sendDiagnostics({ uri, diagnostics });
        }, debounceMs);
        // Don't keep the event loop alive just for diagnostics.
        if (typeof handle.unref === "function") handle.unref();
        pendingDiagnostics.set(uri, handle);
    }

    documents.onDidChangeContent((change) => {
        invalidate(change.document.uri);
        scheduleDiagnostics(change.document.uri);
    });

    documents.onDidClose((event) => {
        invalidate(event.document.uri);
        const t = pendingDiagnostics.get(event.document.uri);
        if (t) clearTimeout(t);
        pendingDiagnostics.delete(event.document.uri);
        void connection.sendDiagnostics({
            uri: event.document.uri,
            diagnostics: [],
        });
    });

    connection.onDocumentFormatting((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return formatDocument(doc, { indent: params.options.tabSize });
    });

    connection.onDocumentRangeFormatting((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return formatDocumentRange(doc, params.range, {
            indent: params.options.tabSize,
        });
    });

    connection.onDocumentSymbol((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return computeDocumentSymbols(doc);
    });

    connection.onHover((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computeHover(doc, params.position, schemas);
    });

    connection.onDefinition((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computeDefinition(doc, params.position);
    });

    connection.onReferences((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computeReferences(
            doc,
            params.position,
            params.context.includeDeclaration,
        );
    });

    connection.onCompletion((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return computeCompletions(doc, schemas, params.position);
    });

    connection.onSignatureHelp((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computeSignatureHelp(doc, params.position, schemas);
    });

    connection.languages.inlayHint.on((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return computeInlayHints(doc, schemas, params.range);
    });

    connection.onPrepareRename((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computePrepareRename(doc, params.position);
    });

    connection.onRenameRequest((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return computeRename(doc, params.position, params.newName);
    });

    connection.onCodeAction((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return computeCodeActions(doc, params.range);
    });

    connection.onRequest(
        "workflow/compileIR",
        (params: CompileIRParams) => compileIR(documents, params, schemas),
    );

    connection.languages.semanticTokens.on((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return { data: [] };
        return computeSemanticTokens(doc);
    });

    documents.listen(connection);

    return {
        connection,
        documents,
        listen: () => connection.listen(),
        dispose: () => {
            for (const t of pendingDiagnostics.values()) clearTimeout(t);
            pendingDiagnostics.clear();
            connection.dispose();
        },
    };
}
