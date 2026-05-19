// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    Position,
    Range,
    WorkspaceEdit,
    TextEdit,
} from "vscode-languageserver/node.js";
import { getParsed } from "../parsedDocument.js";
import { findReferenceAt, type SymbolDef } from "../symbolResolver.js";
import { pointRange } from "../util/position.js";

/**
 * Rename support for the workflow DSL.
 *
 * Only user-declared symbols (params, consts, lambda params) are
 * renamable. Built-in task names (`shell.exec`, `string.join`, ...)
 * are rejected because they live in the engine, not the document.
 *
 * The rename operation rewrites the declaration plus every reference
 * recorded in the symbol table. Because the DSL is single-file in v1,
 * every edit targets the same URI.
 */

const VALID_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function defAt(
    doc: TextDocument,
    position: Position,
): { def: SymbolDef; range: Range } | null {
    const parsed = getParsed(doc);
    if (!parsed.ast || !parsed.symbols) return null;
    const symbols = parsed.symbols;

    const line1 = position.line + 1;
    const col1 = position.character + 1;

    // Check if cursor sits directly on a Def location.
    for (const def of symbols.defs) {
        if (
            def.loc.line === line1 &&
            col1 >= def.loc.col &&
            col1 <= def.loc.col + def.name.length
        ) {
            return {
                def,
                range: pointRange(def.loc, def.name.length),
            };
        }
    }

    // Otherwise check references.
    const ref = findReferenceAt(symbols, line1, col1);
    if (ref && ref.def) {
        return {
            def: ref.def,
            range: pointRange(ref.loc, ref.name.length),
        };
    }
    return null;
}

export function computePrepareRename(
    doc: TextDocument,
    position: Position,
): Range | null {
    const hit = defAt(doc, position);
    return hit ? hit.range : null;
}

export function computeRename(
    doc: TextDocument,
    position: Position,
    newName: string,
): WorkspaceEdit | null {
    if (!VALID_IDENT.test(newName)) return null;

    const hit = defAt(doc, position);
    if (!hit) return null;

    const parsed = getParsed(doc);
    if (!parsed.symbols) return null;
    const def = hit.def;
    const edits: TextEdit[] = [];

    edits.push(
        TextEdit.replace(pointRange(def.loc, def.name.length), newName),
    );
    for (const ref of parsed.symbols.refs) {
        if (ref.def === def) {
            edits.push(
                TextEdit.replace(
                    pointRange(ref.loc, ref.name.length),
                    newName,
                ),
            );
        }
    }

    return { changes: { [doc.uri]: edits } };
}
