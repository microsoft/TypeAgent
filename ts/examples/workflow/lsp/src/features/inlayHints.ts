// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { InlayHint, InlayHintKind, Range } from "vscode-languageserver/node.js";
import type { Expr, Statement, WorkflowDecl } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";
import type { TaskSchema } from "../taskSchemas.js";

/**
 * Inlay hints for the workflow DSL.
 *
 * For `const x = <taskCall(...)>`, emit a `: <returnType>` hint between
 * the binding name and `=` (mirroring TypeScript-style hints). The
 * return type is read from the matching task schema's `outputSchema`.
 *
 * Anchors are computed by scanning the document text from the `const`
 * keyword forward to the `=` token, which is reliable since the DSL
 * disallows `=` inside type annotations or destructuring patterns.
 */

function describeJsonType(schema: unknown): string {
    if (!schema || typeof schema !== "object") return "any";
    const s = schema as { type?: unknown };
    if (typeof s.type === "string") return s.type;
    if (Array.isArray(s.type)) return s.type.join(" | ");
    return "any";
}

function returnTypeOf(expr: Expr, schemas: TaskSchema[]): string | null {
    if (expr.kind !== "TaskCallExpr") return null;
    const schema = schemas.find((s) => s.name === expr.task);
    if (!schema) return null;
    return describeJsonType(schema.outputSchema);
}

function* iterStatements(stmts: Statement[]): IterableIterator<Statement> {
    for (const s of stmts) {
        yield s;
        switch (s.kind) {
            case "IfStatement":
                yield* iterStatements(s.then);
                if (s.else_) yield* iterStatements(s.else_);
                break;
            case "SwitchStatement":
                for (const c of s.arms) yield* iterStatements(c.body);
                if (s.default_) yield* iterStatements(s.default_);
                break;
        }
    }
}

export function computeInlayHints(
    doc: TextDocument,
    schemas: TaskSchema[],
    range?: Range,
): InlayHint[] {
    const parsed = getParsed(doc);
    if (!parsed.ast) return [];
    const ast: WorkflowDecl = parsed.ast;
    const text = doc.getText();
    const hints: InlayHint[] = [];
    const rangeStartOffset = range ? doc.offsetAt(range.start) : 0;
    const rangeEndOffset = range ? doc.offsetAt(range.end) : text.length;

    for (const stmt of iterStatements(ast.body)) {
        if (stmt.kind !== "ConstStatement" || stmt.isSynthetic) continue;
        if (stmt.loc.offset < rangeStartOffset) continue;
        if (stmt.loc.offset >= rangeEndOffset) continue;

        const annotation = returnTypeOf(stmt.value, schemas);
        if (!annotation) continue;

        // Find the binding name end offset: `const <name> [: T] [= ...]`.
        // Skip the `const` keyword (5 chars) plus whitespace to land at name.
        let nameStart = stmt.loc.offset;
        if (text.startsWith("const", nameStart)) nameStart += 5;
        while (nameStart < text.length && /\s/.test(text[nameStart]!))
            nameStart++;
        if (!text.startsWith(stmt.name, nameStart)) continue;
        const nameEnd = nameStart + stmt.name.length;
        // Skip if the source already has a `:` after the name (typed const).
        let probe = nameEnd;
        while (probe < text.length && /\s/.test(text[probe]!)) probe++;
        if (text[probe] === ":") continue;

        hints.push({
            position: doc.positionAt(nameEnd),
            label: `: ${annotation}`,
            kind: InlayHintKind.Type,
            paddingLeft: false,
            paddingRight: true,
        });
    }
    return hints;
}
