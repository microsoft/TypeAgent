// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    Diagnostic as LspDiagnostic,
    DiagnosticSeverity,
    DefinitionParams,
    ReferenceParams,
    HoverParams,
    DocumentFormattingParams,
    DocumentSymbolParams,
    SymbolKind,
    TextEdit,
    Range,
    Position,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    loadGrammarFromBuffer,
    getSymbolIndex,
    format,
    type LoadResult,
    type SymbolIndex,
    type Diagnostic,
} from "grammar-tools-core";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Per-document caches
const grammarCache = new Map<string, LoadResult>();
const symbolCache = new Map<string, SymbolIndex>();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            documentFormattingProvider: true,
            documentSymbolProvider: true,
        },
    };
});

// ---------------------------------------------------------------------------
// Document change -> diagnostics
// ---------------------------------------------------------------------------

documents.onDidChangeContent((change) => {
    validateDocument(change.document);
});

function validateDocument(doc: TextDocument): void {
    const text = doc.getText();
    const uri = doc.uri;

    // Parse and cache
    const result = loadGrammarFromBuffer(uriToId(uri), text);
    grammarCache.set(uri, result);
    symbolCache.delete(uri); // invalidate

    const diagnostics: LspDiagnostic[] = [];

    if (!result.ok) {
        for (const d of result.diagnostics) {
            diagnostics.push(toLspDiagnostic(d, doc));
        }
    } else if (result.diagnostics) {
        for (const d of result.diagnostics) {
            diagnostics.push(toLspDiagnostic(d, doc));
        }
    }

    connection.sendDiagnostics({ uri, diagnostics });
}

function toLspDiagnostic(d: Diagnostic, doc: TextDocument): LspDiagnostic {
    const severity =
        d.severity === "error"
            ? DiagnosticSeverity.Error
            : d.severity === "warning"
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information;

    return {
        range: {
            start: Position.create(d.range.start.line, d.range.start.character),
            end: Position.create(d.range.end.line, d.range.end.character),
        },
        severity,
        message: d.message,
        source: d.source ?? "agr",
    };
}

// ---------------------------------------------------------------------------
// Go-to-definition
// ---------------------------------------------------------------------------

connection.onDefinition((params: DefinitionParams) => {
    const index = getIndex(params.textDocument.uri);
    if (!index) return null;

    const word = getWordAtPosition(params.textDocument.uri, params.position);
    if (!word) return null;

    const sym = index.byId.get(word);
    if (!sym) return null;

    return {
        uri: fileIdToUri(sym.location.fileId, params.textDocument.uri),
        range: Range.create(
            sym.location.range.start.line,
            sym.location.range.start.character,
            sym.location.range.end.line,
            sym.location.range.end.character,
        ),
    };
});

// ---------------------------------------------------------------------------
// Find references
// ---------------------------------------------------------------------------

connection.onReferences((params: ReferenceParams) => {
    const index = getIndex(params.textDocument.uri);
    if (!index) return null;

    const word = getWordAtPosition(params.textDocument.uri, params.position);
    if (!word) return null;

    const refs = index.references(word);
    if (!refs || refs.length === 0) return null;

    const locations = refs.map((r) => ({
        uri: fileIdToUri(r.fileId, params.textDocument.uri),
        range: Range.create(
            r.range.start.line,
            r.range.start.character,
            r.range.end.line,
            r.range.end.character,
        ),
    }));

    // Include definition if requested
    if (params.context.includeDeclaration) {
        const sym = index.byId.get(word);
        if (sym) {
            locations.unshift({
                uri: fileIdToUri(sym.location.fileId, params.textDocument.uri),
                range: Range.create(
                    sym.location.range.start.line,
                    sym.location.range.start.character,
                    sym.location.range.end.line,
                    sym.location.range.end.character,
                ),
            });
        }
    }

    return locations;
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params: HoverParams) => {
    const index = getIndex(params.textDocument.uri);
    if (!index) return null;

    const word = getWordAtPosition(params.textDocument.uri, params.position);
    if (!word) return null;

    const sym = index.byId.get(word);
    if (!sym) return null;

    const refs = index.references(word);
    const refCount = refs.length;

    const lines = ["```agr", sym.signature, "```"];
    if (refCount > 0) {
        lines.push("", `${refCount} reference${refCount === 1 ? "" : "s"}`);
    }

    return {
        contents: { kind: "markdown" as const, value: lines.join("\n") },
    };
});

// ---------------------------------------------------------------------------
// Document symbols (outline)
// ---------------------------------------------------------------------------

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
    const index = getIndex(params.textDocument.uri);
    if (!index) return null;

    return index.symbols.map((sym) => ({
        name: `<${sym.id}>`,
        kind: SymbolKind.Function,
        range: Range.create(
            sym.location.range.start.line,
            sym.location.range.start.character,
            sym.location.range.end.line,
            sym.location.range.end.character,
        ),
        selectionRange: Range.create(
            sym.location.range.start.line,
            sym.location.range.start.character,
            sym.location.range.end.line,
            sym.location.range.end.character,
        ),
    }));
});

// ---------------------------------------------------------------------------
// Document formatting
// ---------------------------------------------------------------------------

connection.onDocumentFormatting((params: DocumentFormattingParams) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const formatted = format(text);

    if (formatted === text) return [];

    // Replace entire document
    const lastLine = doc.lineCount - 1;
    const lastLineText = doc.getText(
        Range.create(lastLine, 0, lastLine, Number.MAX_SAFE_INTEGER),
    );

    return [
        TextEdit.replace(
            Range.create(0, 0, lastLine, lastLineText.length),
            formatted,
        ),
    ];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIndex(uri: string): SymbolIndex | null {
    let index = symbolCache.get(uri);
    if (index) return index;

    const result = grammarCache.get(uri);
    if (!result || !result.ok) return null;

    index = getSymbolIndex(result.grammar);
    symbolCache.set(uri, index);
    return index;
}

function getWordAtPosition(uri: string, pos: Position): string | null {
    const doc = documents.get(uri);
    if (!doc) return null;

    const text = doc.getText();
    const offset = doc.offsetAt(pos);

    // Find word boundaries: rule names are inside < > or after $( or just identifiers
    // Strategy: find the <Name> or identifier under cursor
    let start = offset;
    let end = offset;

    // Check if we're inside a <RuleName> reference
    // Scan backward for < (or start of identifier)
    let insideAngleBrackets = false;
    let scanBack = offset;
    while (scanBack > 0) {
        const ch = text[scanBack - 1];
        if (ch === "<") {
            insideAngleBrackets = true;
            start = scanBack; // start after the <
            break;
        }
        if (!isIdentChar(ch)) break;
        scanBack--;
    }

    if (insideAngleBrackets) {
        // Scan forward to find >
        end = offset;
        while (
            end < text.length &&
            text[end] !== ">" &&
            isIdentChar(text[end])
        ) {
            end++;
        }
    } else {
        // Plain identifier: expand backward and forward
        start = offset;
        while (start > 0 && isIdentChar(text[start - 1])) {
            start--;
        }
        end = offset;
        while (end < text.length && isIdentChar(text[end])) {
            end++;
        }
    }

    if (start === end) return null;
    return text.substring(start, end);
}

function isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_]/.test(ch);
}

function uriToId(uri: string): string {
    // Extract filename from URI for use as grammar ID
    const lastSlash = uri.lastIndexOf("/");
    return lastSlash >= 0 ? uri.substring(lastSlash + 1) : uri;
}

function fileIdToUri(fileId: string, contextUri: string): string {
    // If fileId matches the filename part of contextUri, return contextUri
    const contextFile = uriToId(contextUri);
    if (fileId === contextFile) return contextUri;
    // Otherwise, try to resolve relative to the context
    const lastSlash = contextUri.lastIndexOf("/");
    if (lastSlash >= 0) {
        return contextUri.substring(0, lastSlash + 1) + fileId;
    }
    return fileId;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
