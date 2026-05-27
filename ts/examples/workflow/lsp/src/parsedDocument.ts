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
 *
 * Multi-workflow: a `.wf` file may declare more than one workflow.
 * `workflows` is the per-workflow array (AST + symbol table + property
 * refs for each declaration), while `symbols` and `propertyRefs` are
 * flat, document-wide concatenations of the per-workflow data. The
 * concatenated arrays are position-keyed, so features that look up by
 * `(line, col)` (hover/definition/references/semanticTokens) work
 * transparently across workflow boundaries. Features that need the
 * AST of the workflow containing the cursor use `findWorkflowAt`.
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

export interface ParsedWorkflow {
    decl: WorkflowDecl;
    symbols: SymbolTable;
}

export interface ParsedDocument {
    version: number;
    text: string;
    tokens: Token[];
    comments: LexComment[];
    /** Per-workflow parsed data, in source order. Empty if parsing failed. */
    workflows: ParsedWorkflow[];
    /**
     * Concatenated symbol table across all workflows. Position-keyed
     * lookups (defs/refs/taskRefs) work transparently because each
     * entry carries its own `loc`.
     */
    symbols: SymbolTable;
    /** Combined property refs across all workflows. */
    propertyRefs: PropertyRef[];
    /**
     * Convenience alias for `workflows[0]?.decl`. Several features were
     * written before multi-workflow support; they keep using `ast` for
     * single-workflow documents. New code should prefer
     * `findWorkflowAt` or iterate `workflows`.
     */
    ast?: WorkflowDecl;
}

const cache = new Map<string, ParsedDocument>();

const EMPTY_SYMBOLS: SymbolTable = { defs: [], refs: [], taskRefs: [] };

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
        workflows: [],
        symbols: { defs: [], refs: [], taskRefs: [] },
        propertyRefs: [],
    };
    if (lexErrors.length === 0) {
        const parser = new Parser(tokens, comments);
        const { module } = parser.parseModule();
        const decls = module.workflows;
        // Build per-workflow symbol tables. Workflows are independent scopes:
        // a binding in one workflow does not resolve references in another, so
        // the resolver is run separately for each declaration. The per-workflow
        // tables are stored on ParsedWorkflow.symbols for cursor-local features
        // (go-to-def, rename) that use findWorkflowAt; the flat entry.symbols
        // below is a position-keyed concatenation for document-wide lookups.
        for (const decl of decls) {
            const symbols = buildSymbolTable(decl);
            entry.workflows.push({ decl, symbols });
            entry.symbols.defs.push(...symbols.defs);
            entry.symbols.refs.push(...symbols.refs);
            entry.symbols.taskRefs.push(...symbols.taskRefs);
        }
        // Single multi-workflow call: property refs are file-wide
        // (only consumed via the combined `parsed.propertyRefs` array).
        const checker = new TypeChecker(loadTaskSchemas());
        entry.propertyRefs = checker.collectPropertyRefs(decls);
        if (entry.workflows.length > 0) {
            entry.ast = entry.workflows[0]!.decl;
        }
    }
    cache.set(doc.uri, entry);
    return entry;
}

/**
 * Locate the workflow whose source region contains the 1-based
 * `(line, col)` position. Workflows are stored in source order; we
 * pick the last one whose declaration starts at or before the cursor.
 * Falls back to the first workflow when the cursor sits in the
 * preamble (imports / comments) so cursor-anchored features still
 * have a sensible AST to operate on.
 */
export function findWorkflowAt(
    parsed: ParsedDocument,
    line: number,
    col: number,
): ParsedWorkflow | undefined {
    if (parsed.workflows.length === 0) return undefined;
    let pick: ParsedWorkflow | undefined;
    for (const w of parsed.workflows) {
        const loc = w.decl.loc;
        if (loc.line < line || (loc.line === line && loc.col <= col)) {
            pick = w;
        } else {
            break;
        }
    }
    return pick ?? parsed.workflows[0];
}

export { EMPTY_SYMBOLS };

export function invalidate(uri: string): void {
    cache.delete(uri);
}

export function clearCache(): void {
    cache.clear();
}
