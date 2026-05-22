// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Per-document lex/parse + symbol-table cache.
 *
 * Features (hover, completion, definition, references, semanticTokens)
 * need the same parsed AST + symbol table; doing the work once per
 * document version saves CPU and lets diagnostics, formatting, and
 * the cursor-driven features stay consistent.
 *
 * Eviction: the cache is keyed by URI; when a new version arrives we
 * recompute on next access. We don't keep stale entries by version
 * because the AST is cheap to recompute and the LSP doesn't currently
 * need historical snapshots.
 */

import {
    lex,
    Parser,
    TypeChecker,
    type WorkflowDecl,
    type LexComment,
    type Token,
    type PropertyRef,
} from "workflow-dsl";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { buildSymbolTable, type SymbolTable } from "./symbolResolver.js";
import { loadTaskSchemas } from "./taskSchemas.js";

export interface ParsedDocument {
    version: number;
    text: string;
    tokens: Token[];
    comments: LexComment[];
    ast?: WorkflowDecl;
    symbols?: SymbolTable;
    propertyRefs?: PropertyRef[];
}

const cache = new Map<string, ParsedDocument>();

export function getParsed(doc: TextDocument): ParsedDocument {
    const existing = cache.get(doc.uri);
    if (existing && existing.version === doc.version) return existing;

    const text = doc.getText();
    const { tokens, errors: lexErrors, comments } = lex(text);
    const entry: ParsedDocument = {
        version: doc.version,
        text,
        tokens,
        comments,
    };
    if (lexErrors.length === 0) {
        const parser = new Parser(tokens, comments);
        const { ast } = parser.parseSingle();
        if (ast) {
            entry.ast = ast;
            entry.symbols = buildSymbolTable(ast);
            const checker = new TypeChecker(loadTaskSchemas());
            entry.propertyRefs = checker.collectPropertyRefs(ast);
        }
    }
    cache.set(doc.uri, entry);
    return entry;
}

export function invalidate(uri: string): void {
    cache.delete(uri);
}

export function clearCache(): void {
    cache.clear();
}
