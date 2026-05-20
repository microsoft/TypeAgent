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
 *    non-trivial expression, offer to extract it to a `const _extracted`
 *    binding before the enclosing statement.
 *
 * 3. **Inline const** — when the cursor is on a `const` definition with
 *    at least one reference, offer to replace all references with the
 *    RHS value and delete the declaration.
 *
 * 4. **concat→template** — when the cursor is inside a
 *    `string.concat([ … ])` call, offer to rewrite it as a template
 *    literal.
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

    // --- Action 3: Inline const ---
    // Offer when the cursor is on a ConstStatement (single binding only).
    if (enclosing && enclosing.kind === "ConstStatement" && parsed.symbols) {
        const constName = enclosing.name;
        // Skip synthetic const wrappers (bare expression statements).
        if (constName && !constName.startsWith("__synthetic_")) {
            const refs = parsed.symbols.refs.filter(
                (r) => r.name === constName && r.def?.kind === "const",
            );
            if (refs.length > 0) {
                // Extract the RHS text (everything after `=` up to the next `;`).
                const eqIdx = text.indexOf("=", enclosing.loc.offset ?? 0);
                const rhsRaw =
                    eqIdx >= 0
                        ? text.slice(eqIdx + 1).split(";")[0]?.trim() ?? ""
                        : "";
                if (rhsRaw.length > 0) {
                    // Build the edit: replace each reference, then delete the decl line.
                    const refEdits: TextEdit[] = refs.map((r) => {
                        const refStart = {
                            line: r.loc.line - 1,
                            character: r.loc.col - 1,
                        };
                        const refEnd = {
                            line: r.loc.line - 1,
                            character: r.loc.col - 1 + constName.length,
                        };
                        return TextEdit.replace(
                            { start: refStart, end: refEnd },
                            rhsRaw,
                        );
                    });

                    // Delete the entire const statement line.
                    const declLine = enclosing.loc.line - 1;
                    const lineStartPos = { line: declLine, character: 0 };
                    const lineEndPos = { line: declLine + 1, character: 0 };
                    refEdits.push(
                        TextEdit.del({ start: lineStartPos, end: lineEndPos }),
                    );

                    actions.push({
                        title: `Inline const '${constName}'`,
                        kind: CodeActionKind.RefactorInline,
                        edit: {
                            changes: { [doc.uri]: refEdits },
                        },
                    });
                }
            }
        }
    }

    // --- Action 4: concat→template literal ---
    // Detect `string.concat(["literal", expr, "literal"])` at the cursor line
    // and offer to rewrite as a template literal.
    const cursorLine = range.start.line;
    const lineStart = doc.offsetAt({ line: cursorLine, character: 0 });
    const lineEnd = doc.offsetAt({ line: cursorLine + 1, character: 0 });
    const lineText = text.slice(lineStart, lineEnd);

    // Simple regex: matches string.concat([ ... ])
    const concatRe = /string\.concat\(\s*\[([^\]]+)\]\s*\)/;
    const m = concatRe.exec(lineText);
    if (m) {
        const innerList = m[1]!;
        // Split on commas not inside quotes (simple heuristic for DSL usage).
        const parts: string[] = [];
        let buf = "";
        let inStr = false;
        let strChar = "";
        for (const ch of innerList) {
            if (!inStr && (ch === '"' || ch === "'")) {
                inStr = true;
                strChar = ch;
            } else if (inStr && ch === strChar) {
                inStr = false;
            }
            if (!inStr && ch === ",") {
                parts.push(buf.trim());
                buf = "";
            } else {
                buf += ch;
            }
        }
        if (buf.trim()) parts.push(buf.trim());

        const templateInner = parts
            .map((p) => {
                const strMatch = /^["'](.*)["']$/.exec(p);
                return strMatch ? strMatch[1]! : `\${${p}}`;
            })
            .join("");
        const templateLiteral = "`" + templateInner + "`";

        const matchStart = lineStart + m.index;
        const matchEnd = matchStart + m[0].length;
        const editRange: Range = {
            start: doc.positionAt(matchStart),
            end: doc.positionAt(matchEnd),
        };

        actions.push({
            title: "Convert to template literal",
            kind: CodeActionKind.RefactorRewrite,
            edit: {
                changes: {
                    [doc.uri]: [TextEdit.replace(editRange, templateLiteral)],
                },
            },
        });
    }

    return actions;
}
