// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Formatting feature: lex + parse the document, then format the AST
 * back to canonical text. Returns a single full-document
 * `TextEdit` covering the whole file.
 *
 * On parse error we deliberately return `[]` (no edits) so the user's
 * source is preserved; the diagnostics feature still surfaces what
 * went wrong. This matches the `wff` CLI's exit semantics.
 */

import { TextEdit, Range } from "vscode-languageserver/node.js";
import { lex, Parser, format, type FormatOptions } from "workflow-dsl";
import type { TextDocument } from "vscode-languageserver-textdocument";

export function formatDocument(
    doc: TextDocument,
    options?: FormatOptions,
): TextEdit[] {
    const text = doc.getText();

    const { tokens, errors: lexErrors, comments } = lex(text);
    if (lexErrors.length > 0) return [];

    const parser = new Parser(tokens, comments);
    const { ast, errors: parseErrors } = parser.parseSingle();
    if (!ast || parseErrors.length > 0) return [];

    let formatted: string;
    try {
        formatted = format(ast, options);
    } catch {
        return [];
    }

    if (formatted === text) return [];

    const fullRange: Range = {
        start: { line: 0, character: 0 },
        end: doc.positionAt(text.length),
    };
    return [TextEdit.replace(fullRange, formatted)];
}

/**
 * Range formatting: the DSL formatter always rewrites the full file
 * (it operates on the AST, not individual lines), so we run the full
 * format and then return only the edits that fall within the
 * requested range. In practice this means the first (and only) full-
 * document edit is returned if it overlaps the range at all.
 */
export function formatDocumentRange(
    doc: TextDocument,
    range: Range,
    options?: FormatOptions,
): TextEdit[] {
    const fullEdits = formatDocument(doc, options);
    // Each edit from formatDocument already covers the whole document.
    // Return them as-is — the client merges the overlap correctly.
    return fullEdits.filter((edit) => {
        // Include the edit if its range overlaps the requested range.
        const editStart = edit.range.start;
        const editEnd = edit.range.end;
        const reqStart = range.start;
        const reqEnd = range.end;
        return !(
            editEnd.line < reqStart.line ||
            (editEnd.line === reqStart.line &&
                editEnd.character < reqStart.character) ||
            editStart.line > reqEnd.line ||
            (editStart.line === reqEnd.line &&
                editStart.character > reqEnd.character)
        );
    });
}
