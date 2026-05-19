// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Code-action provider for the workflow DSL.
 *
 * Supported actions:
 *
 * 1. **Surround with attempts** — when the cursor/selection is inside
 *    a task call, offer to wrap the nearest ConstStatement in an
 *    `attempts(3) { … } fallback (err) { throw err; }` block.
 *
 * 2. **Extract to const** — when text is selected and consists of a
 *    non-trivial expression (not a bare identifier or literal), offer
 *    to extract it to a new `const _extracted = <expr>;` binding
 *    before the enclosing statement. The placeholder name is
 *    `_extracted`; the user is expected to rename it via `F2`.
 *
 * Both actions are surfaced as `source` kind so they don't compete
 * with the diagnostic quick-fix slot.
 *
 * Limitations (tracked in lsp-review-log.md):
 * - "Insert missing required arg" would require typechecker error codes
 *   which the DSL doesn't expose yet.
 * - "Inline single-use const" requires a data-flow scan that's more
 *   involved than warranted for a first pass.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CodeAction,
    CodeActionKind,
    Range,
    TextEdit,
    WorkspaceEdit,
} from "vscode-languageserver/node.js";
import type { Statement } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";
import { toLspPosition } from "../util/position.js";

/** 0-based LSP range → 1-based line/col for comparison with SourceLocation. */
function rangeOverlaps(
    range: Range,
    stmtLine: number,
    stmtCol: number,
): boolean {
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    return stmtLine >= startLine && stmtLine <= endLine;
}

function stmtContainsOffset(
    stmt: Statement,
    range: Range,
): boolean {
    return rangeOverlaps(range, stmt.loc.line, stmt.loc.col);
}

/** Walk statements to find the innermost one that contains range. */
function findEnclosingStatement(
    stmts: Statement[],
    range: Range,
): Statement | undefined {
    for (const s of stmts) {
        if (!stmtContainsOffset(s, range)) continue;
        // Try inner bodies.
        if (s.kind === "IfStatement") {
            const inner =
                findEnclosingStatement(s.then, range) ??
                (s.else_ ? findEnclosingStatement(s.else_, range) : undefined);
            if (inner) return inner;
        } else if (s.kind === "SwitchStatement") {
            for (const arm of s.arms) {
                const inner = findEnclosingStatement(arm.body, range);
                if (inner) return inner;
            }
        }
        return s;
    }
    return undefined;
}

/** Compute the leading whitespace indent of the line containing a statement. */
function indentOf(text: string, stmt: Statement): string {
    // Walk backwards from the statement's offset to the start of its line.
    let pos = stmt.loc.offset ?? 0;
    while (pos > 0 && text[pos - 1] !== "\n") pos--;
    let end = pos;
    while (end < text.length && (text[end] === " " || text[end] === "\t"))
        end++;
    return text.slice(pos, end);
}

export function computeCodeActions(
    doc: TextDocument,
    range: Range,
): CodeAction[] {
    const parsed = getParsed(doc);
    if (!parsed.ast) return [];
    const text = doc.getText();
    const stmts = parsed.ast.body;
    const actions: CodeAction[] = [];

    const enclosing = findEnclosingStatement(stmts, range);

    // --- Action 1: Surround with attempts ---
    if (
        enclosing &&
        enclosing.kind === "ConstStatement" &&
        enclosing.value.kind === "TaskCallExpr"
    ) {
        const indent = indentOf(text, enclosing);
        const stmtStart = toLspPosition(enclosing.loc);

        // Find the end of the statement (approximate: next newline after loc)
        let endOffset = enclosing.loc.offset ?? 0;
        while (endOffset < text.length && text[endOffset] !== "\n") endOffset++;
        const stmtEnd = doc.positionAt(endOffset);

        // Read the current statement text.
        const stmtText = text.slice(
            doc.offsetAt(stmtStart),
            endOffset,
        ).trimEnd();

        const newText =
            `${indent}attempts(3) {\n` +
            `${indent}    ${stmtText.trimStart()}\n` +
            `${indent}} fallback (err) {\n` +
            `${indent}    throw err;\n` +
            `${indent}}`;

        const edit: WorkspaceEdit = {
            changes: {
                [doc.uri]: [
                    TextEdit.replace(
                        { start: stmtStart, end: stmtEnd },
                        newText,
                    ),
                ],
            },
        };
        actions.push({
            title: "Surround with attempts(3) … fallback",
            kind: CodeActionKind.RefactorRewrite,
            edit,
        });
    }

    // --- Action 2: Extract selected range to const ---
    const selectionText = text
        .slice(doc.offsetAt(range.start), doc.offsetAt(range.end))
        .trim();

    if (
        selectionText.length > 0 &&
        enclosing &&
        enclosing.kind === "ConstStatement"
    ) {
        // Quick heuristic: selection looks like a sub-expression (no newlines,
        // reasonably short, not already the full RHS).
        const fullRhsStart = text.indexOf("=", enclosing.loc.offset ?? 0);
        const fullRhsText =
            fullRhsStart >= 0
                ? text
                      .slice(fullRhsStart + 1)
                      .split(";")[0]!
                      .trim()
                : "";
        const isFullRhs = selectionText === fullRhsText;

        if (!isFullRhs && !selectionText.includes("\n") && selectionText.length > 2) {
            const indent = indentOf(text, enclosing);
            const insertPos = toLspPosition(enclosing.loc);
            const extractEdit: WorkspaceEdit = {
                changes: {
                    [doc.uri]: [
                        // Insert the new binding before the enclosing statement.
                        TextEdit.insert(
                            insertPos,
                            `${indent}const _extracted = ${selectionText};\n`,
                        ),
                        // Replace the selected expression with the new name.
                        TextEdit.replace(range, "_extracted"),
                    ],
                },
            };
            actions.push({
                title: "Extract to const",
                kind: CodeActionKind.RefactorExtract,
                edit: extractEdit,
            });
        }
    }

    return actions;
}
