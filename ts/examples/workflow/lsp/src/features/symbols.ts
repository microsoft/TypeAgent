// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Document symbols feature.
 *
 * Surfaces the workflow declaration, its parameters, and any
 * top-level `ConstStatement` / `DestructuringConst` bindings as a
 * tree so the outline view and `@` symbol navigator work.
 *
 * Phase 1 scope: top-level constants only. Nested constants inside
 * `if` / `switch` arms could be added but tend to clutter the outline;
 * revisit after dogfooding.
 */

import {
    DocumentSymbol,
    SymbolKind,
    Range,
} from "vscode-languageserver/node.js";
import {
    lex,
    Parser,
    type WorkflowDecl,
    type Statement,
    type ParamDecl,
    type SourceLocation,
} from "workflow-dsl";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { toLspPosition } from "../util/position.js";

export function computeDocumentSymbols(doc: TextDocument): DocumentSymbol[] {
    const text = doc.getText();
    const { tokens, errors: lexErrors, comments } = lex(text);
    if (lexErrors.length > 0) return [];

    const parser = new Parser(tokens, comments);
    const { ast } = parser.parseSingle();
    if (!ast) return [];

    return [workflowSymbol(ast, doc)];
}

function workflowSymbol(wf: WorkflowDecl, doc: TextDocument): DocumentSymbol {
    const children: DocumentSymbol[] = [];

    for (const p of wf.params) {
        children.push(paramSymbol(p));
    }

    for (const stmt of wf.body) {
        const sym = statementSymbol(stmt);
        if (sym) children.push(sym);
    }

    const fullRange: Range = {
        start: { line: 0, character: 0 },
        end: doc.positionAt(doc.getText().length),
    };

    return {
        name: wf.name,
        kind: SymbolKind.Function,
        range: fullRange,
        selectionRange: locToRange(wf.loc, wf.name.length),
        children,
    };
}

function paramSymbol(p: ParamDecl): DocumentSymbol {
    const range = locToRange(p.loc, p.name.length);
    return {
        name: p.name,
        kind: SymbolKind.Variable,
        range,
        selectionRange: range,
    };
}

function statementSymbol(stmt: Statement): DocumentSymbol | undefined {
    if (stmt.kind === "ConstStatement") {
        if (stmt.isSynthetic) return undefined;
        const range = locToRange(stmt.loc, stmt.name.length);
        return {
            name: stmt.name,
            kind: SymbolKind.Constant,
            range,
            selectionRange: range,
        };
    }
    if (stmt.kind === "DestructuringConst") {
        const range = locToRange(stmt.loc, 1);
        return {
            name: `{ ${stmt.names.join(", ")} }`,
            kind: SymbolKind.Constant,
            range,
            selectionRange: range,
        };
    }
    return undefined;
}

function locToRange(loc: SourceLocation, length: number): Range {
    const start = toLspPosition({ line: loc.line, col: loc.col });
    return {
        start,
        end: { line: start.line, character: start.character + Math.max(1, length) },
    };
}
