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
import type { Statement, Expr } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";
import { toLspPosition } from "../util/position.js";

/**
 * Collect every identifier reference (head segment of a DottedNameExpr)
 * that appears inside an expression sub-tree.  Used to safety-check the
 * inline-const refactoring: if any of these names resolves to a
 * different definition at a use site than at the declaration site, the
 * inline is unsafe (variable shadowing).
 */
function collectIdentifiers(expr: Expr, out: Set<string>): void {
    switch (expr.kind) {
        case "DottedNameExpr":
            out.add(expr.segments[0]!);
            return;
        case "TaskCallExpr":
        case "WorkflowCallExpr":
            for (const a of expr.args) collectIdentifiers(a.value, out);
            return;
        case "TemplateLiteralExpr":
            for (const e of expr.expressions) collectIdentifiers(e, out);
            return;
        case "ArrayLiteralExpr":
            for (const e of expr.elements) collectIdentifiers(e, out);
            return;
        case "ObjectLiteralExpr":
            for (const entry of expr.entries)
                collectIdentifiers(entry.value, out);
            return;
        case "BinaryExpr":
            collectIdentifiers(expr.left, out);
            collectIdentifiers(expr.right, out);
            return;
        case "UnaryExpr":
            collectIdentifiers(expr.operand, out);
            return;
        case "TernaryExpr":
            collectIdentifiers(expr.condition, out);
            collectIdentifiers(expr.consequent, out);
            collectIdentifiers(expr.alternate, out);
            return;
        // StringLiteralExpr / NumberLiteralExpr / BooleanLiteralExpr /
        // NullLiteralExpr have no identifier sub-references.
        default:
            return;
    }
}

/**
 * Print a small subset of expression kinds back to surface syntax for
 * use in the concat→template rewrite.  Returns null for any
 * unsupported shape so the caller can skip the action rather than
 * emit syntactically-suspect text.
 */
function exprToSource(expr: Expr): string | null {
    switch (expr.kind) {
        case "StringLiteralExpr":
            return `${expr.quote}${expr.raw}${expr.quote}`;
        case "NumberLiteralExpr":
            return String(expr.value);
        case "BooleanLiteralExpr":
            return String(expr.value);
        case "NullLiteralExpr":
            return "null";
        case "DottedNameExpr":
            return expr.segments.join(".");
        default:
            return null;
    }
}

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

function stmtContainsOffset(stmt: Statement, range: Range): boolean {
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
        const stmtText = text
            .slice(doc.offsetAt(stmtStart), endOffset)
            .trimEnd();

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
        const rhsStart = enclosing.value.loc.offset;
        let fullRhsText = "";
        if (rhsStart !== undefined) {
            const si = text.indexOf(";", rhsStart);
            fullRhsText = text.slice(rhsStart, si >= 0 ? si : text.length).trim();
        }
        const isFullRhs = selectionText === fullRhsText;

        if (
            !isFullRhs &&
            !selectionText.includes("\n") &&
            selectionText.length > 2
        ) {
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
    // Safety: refuse to inline if any identifier in the RHS would resolve
    // differently at a use site than at the declaration site (shadowing).
    if (enclosing && enclosing.kind === "ConstStatement" && parsed.symbols) {
        const constName = enclosing.name;
        const safeToInline = (() => {
            if (!constName || constName.startsWith("__synthetic_"))
                return false;
            // Collect identifier names used in the RHS expression tree.
            const rhsIdentifiers = new Set<string>();
            collectIdentifiers(enclosing.value, rhsIdentifiers);
            // Conservative shadow-check: refuse the action if any RHS-referenced
            // name has more than one definition anywhere in the workflow. This
            // is over-conservative (a definition in an unrelated branch will
            // also veto the inline) but it is sound and easy to reason about.
            for (const name of rhsIdentifiers) {
                let count = 0;
                for (const def of parsed.symbols!.defs) {
                    if (def.name === name) count++;
                }
                if (count > 1) return false;
            }
            return true;
        })();

        if (safeToInline) {
            const refs = parsed.symbols.refs.filter(
                (r) => r.name === constName && r.def?.kind === "const",
            );
            if (refs.length > 0) {
                // Extract the RHS text from the AST node's source offset.
                const rhsStart = enclosing.value.loc.offset;
                let rhsRaw = "";
                if (rhsStart !== undefined) {
                    const si = text.indexOf(";", rhsStart);
                    rhsRaw = text.slice(rhsStart, si >= 0 ? si : text.length).trim();
                }
                if (rhsRaw.length > 0) {
                    // Build the edit: replace each reference, then delete the decl line.
                    const refEdits: TextEdit[] = refs.flatMap((r) => {
                        if (r.loc.line < 1 || r.loc.col < 1) return [];
                        const refStart = {
                            line: r.loc.line - 1,
                            character: r.loc.col - 1,
                        };
                        const refEnd = {
                            line: r.loc.line - 1,
                            character: r.loc.col - 1 + constName!.length,
                        };
                        return [TextEdit.replace({ start: refStart, end: refEnd }, rhsRaw)];
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
    // Walk the AST to find a `string.concat([…])` call inside the enclosing
    // statement. Only offer the rewrite when every array element is a
    // shape we can faithfully re-emit (string / dotted name / numeric /
    // boolean / null literal). Range info is taken from the AST loc fields,
    // which avoids the brittle regex used in earlier revisions.
    if (enclosing && enclosing.kind === "ConstStatement") {
        const found = findConcatCall(enclosing.value);
        if (found) {
            const elements = found.arrayArg.elements;
            const parts: string[] = [];
            let allRepresentable = true;
            for (const el of elements) {
                if (el.kind === "StringLiteralExpr") {
                    // String literals contribute their cooked content
                    // directly (no `${…}` wrapper). We use the raw form;
                    // backtick-incompatible escapes are preserved.
                    parts.push(el.raw);
                } else {
                    const src = exprToSource(el);
                    if (src === null) {
                        allRepresentable = false;
                        break;
                    }
                    parts.push(`\${${src}}`);
                }
            }
            if (allRepresentable && elements.length > 0) {
                const templateLiteral = "`" + parts.join("") + "`";
                // Compute the source range for the entire concat call using
                // AST offsets. Start is the call's loc.offset; end is found
                // by counting parens/brackets forward from that offset.
                const callStartOffset = found.call.loc.offset ?? -1;
                if (callStartOffset >= 0) {
                    const callEndOffset = findMatchingClose(
                        text,
                        callStartOffset,
                    );
                    if (callEndOffset > callStartOffset) {
                        const editRange: Range = {
                            start: doc.positionAt(callStartOffset),
                            end: doc.positionAt(callEndOffset),
                        };
                        actions.push({
                            title: "Convert to template literal",
                            kind: CodeActionKind.RefactorRewrite,
                            edit: {
                                changes: {
                                    [doc.uri]: [
                                        TextEdit.replace(
                                            editRange,
                                            templateLiteral,
                                        ),
                                    ],
                                },
                            },
                        });
                    }
                }
            }
        }
    }

    return actions;
}

/**
 * Find a `string.concat(<ArrayLiteralExpr>)` call inside an expression
 * tree. Returns the call node together with the (single) array-literal
 * argument, or null if no such call is present.
 */
function findConcatCall(expr: Expr): {
    call: Expr & { kind: "TaskCallExpr" };
    arrayArg: Expr & { kind: "ArrayLiteralExpr" };
} | null {
    if (
        expr.kind === "TaskCallExpr" &&
        expr.task === "string.concat" &&
        expr.args.length === 1 &&
        expr.args[0]!.value.kind === "ArrayLiteralExpr"
    ) {
        return {
            call: expr,
            arrayArg: expr.args[0]!.value as Expr & {
                kind: "ArrayLiteralExpr";
            },
        };
    }
    // Recurse into sub-expressions.
    switch (expr.kind) {
        case "TaskCallExpr":
        case "WorkflowCallExpr":
            for (const a of expr.args) {
                const f = findConcatCall(a.value);
                if (f) return f;
            }
            return null;
        case "ArrayLiteralExpr":
            for (const e of expr.elements) {
                const f = findConcatCall(e);
                if (f) return f;
            }
            return null;
        case "ObjectLiteralExpr":
            for (const entry of expr.entries) {
                const f = findConcatCall(entry.value);
                if (f) return f;
            }
            return null;
        case "BinaryExpr": {
            return findConcatCall(expr.left) ?? findConcatCall(expr.right);
        }
        case "TernaryExpr":
            return (
                findConcatCall(expr.condition) ??
                findConcatCall(expr.consequent) ??
                findConcatCall(expr.alternate)
            );
        case "UnaryExpr":
            return findConcatCall(expr.operand);
        case "TemplateLiteralExpr":
            for (const e of expr.expressions) {
                const f = findConcatCall(e);
                if (f) return f;
            }
            return null;
        default:
            return null;
    }
}

/**
 * Given a call-like source position (cursor at or before `task.name(`),
 * walk forward in the source text and return the offset just past the
 * matching `)`, honouring nested `(`, `[`, `{` and string literals.
 * Returns -1 if the matching close cannot be found.
 */
function findMatchingClose(text: string, start: number): number {
    // Find the first `(` at or after start.
    let i = start;
    while (i < text.length && text[i] !== "(") i++;
    if (i >= text.length) return -1;
    const stack: string[] = ["("];
    i++;
    let inStr: string | null = null;
    while (i < text.length && stack.length > 0) {
        const c = text[i]!;
        if (inStr !== null) {
            if (c === "\\") {
                i += 2;
                continue;
            }
            if (c === inStr) inStr = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            i++;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") stack.push(c);
        else if (c === ")" || c === "]" || c === "}") {
            stack.pop();
        }
        i++;
    }
    return stack.length === 0 ? i : -1;
}
