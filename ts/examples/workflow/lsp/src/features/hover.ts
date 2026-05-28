// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Hover feature.
 *
 * Triggered by `textDocument/hover`. Resolves the identifier under
 * the cursor to either:
 *  - a bound symbol (param / const / lambda param) with its declaring
 *    snippet, or
 *  - a builtin task name with its input/output schema summary.
 *
 * Returns `null` (no hover) when the cursor is over whitespace, a
 * literal, or a name we can't resolve.
 */

import { Hover, MarkupKind } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
    TypeChecker,
    formatType,
    resolveTypeParams,
    type TaskCallExpr,
    type TypeExpr,
    type Statement,
    type Expr,
} from "workflow-dsl";
import { getParsed, findWorkflowAt } from "../parsedDocument.js";
import { fromLspPosition } from "../util/position.js";
import {
    findReferenceAt,
    findTaskReferenceAt,
    findDefinitionAt,
    type SymbolDef,
} from "../symbolResolver.js";
import { type TaskSchema, isGenericTaskSchema } from "../taskSchemas.js";

export function computeHover(
    doc: TextDocument,
    position: { line: number; character: number },
    schemas: TaskSchema[],
): Hover | null {
    const parsed = getParsed(doc);
    if (parsed.workflows.length === 0) return null;

    const { line, col } = fromLspPosition(position);

    const taskRef = findTaskReferenceAt(parsed.symbols, line, col);
    if (taskRef) {
        const schema = schemas.find((s) => s.name === taskRef.name);
        if (schema) {
            // Look for the actual TaskCallExpr node to check for type args
            const wf = findWorkflowAt(parsed, line, col);
            const taskCall = wf
                ? findTaskCallAt(wf.decl.body, line, col)
                : undefined;
            return taskHover(schema, taskCall);
        }
        return null;
    }

    const ref = findReferenceAt(parsed.symbols, line, col);
    const def = ref?.def ?? findDefinitionAt(parsed.symbols, line, col);
    if (!def) return null;

    // Look up the inferred type via a single multi-workflow pass.
    // The merged map is keyed by file-wide unique source offset, so
    // the workflow boundary doesn't matter.
    let typeLabel: string | undefined;
    const symbolTypes = new TypeChecker(schemas).collectSymbolTypes(
        parsed.workflows.map((w) => w.decl),
    );
    const info = symbolTypes.get(def.loc.offset);
    if (info && info.kind !== "unresolved") {
        typeLabel = formatType(info);
    }

    return symbolHover(def, typeLabel);
}

function symbolHover(def: SymbolDef, typeLabel?: string): Hover {
    let declaration: string;
    if (def.kind === "param") {
        declaration = typeLabel
            ? `(parameter) ${def.name}: ${typeLabel}`
            : `(parameter) ${def.name}`;
    } else if (def.kind === "lambdaParam") {
        declaration = typeLabel
            ? `(parameter) ${def.name}: ${typeLabel}`
            : `(parameter) ${def.name}`;
    } else {
        // const binding
        declaration = typeLabel
            ? `const ${def.name}: ${typeLabel}`
            : `const ${def.name}`;
    }
    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: `\`\`\`workflow\n${declaration}\n\`\`\``,
        },
    };
}

function taskHover(schema: TaskSchema, taskCall?: TaskCallExpr): Hover {
    const lines: string[] = [];
    lines.push(`**${schema.name}** &mdash; built-in task`);

    // Show type parameters if declared
    if (isGenericTaskSchema(schema) && schema.typeParameters.length > 0) {
        const paramLabels = schema.typeParameters.map((p) =>
            p.default ? `${p.name} = unknown` : p.name,
        );
        lines.push("");
        lines.push(`Type parameters: \`<${paramLabels.join(", ")}>\``);
    }

    // Compute effective output schema (applying type args if present)
    let outputSchema = schema.outputSchema;
    if (
        taskCall?.typeArgs &&
        taskCall.typeArgs.length > 0 &&
        isGenericTaskSchema(schema)
    ) {
        outputSchema = resolveTypeParams(
            schema.outputSchema,
            schema.typeParameters,
            taskCall.typeArgs.map((ta) => typeExprToJsonSchema(ta)),
        );
    }

    lines.push("");
    lines.push("```json");
    lines.push("input: " + JSON.stringify(schema.inputSchema));
    lines.push("output: " + JSON.stringify(outputSchema));
    lines.push("```");
    return {
        contents: { kind: MarkupKind.Markdown, value: lines.join("\n") },
    };
}

// ---- Helpers ----

/** Convert a DSL TypeExpr to a plain JSON Schema object. */
function typeExprToJsonSchema(te: TypeExpr): Record<string, unknown> {
    switch (te.kind) {
        case "NamedType":
            switch (te.name) {
                case "string":
                    return { type: "string" };
                case "number":
                    return { type: "number" };
                case "integer":
                    return { type: "integer" };
                case "boolean":
                    return { type: "boolean" };
                case "never":
                    return { not: {} };
                case "unknown":
                    return {};
                default:
                    return {};
            }
        case "ArrayType":
            return { type: "array", items: typeExprToJsonSchema(te.element) };
        case "ObjectType": {
            const props: Record<string, unknown> = {};
            const req: string[] = [];
            for (const f of te.fields) {
                props[f.name] = typeExprToJsonSchema(f.type);
                if (!f.optional) req.push(f.name);
            }
            return { type: "object", required: req, properties: props };
        }
    }
}

/** Walk statements to find the TaskCallExpr at a given position. */
function findTaskCallAt(
    stmts: Statement[],
    line: number,
    col: number,
): TaskCallExpr | undefined {
    for (const s of stmts) {
        const found = findTaskCallInStmt(s, line, col);
        if (found) return found;
    }
    return undefined;
}

function findTaskCallInStmt(
    s: Statement,
    line: number,
    col: number,
): TaskCallExpr | undefined {
    switch (s.kind) {
        case "ConstStatement":
        case "DestructuringConst":
            return findTaskCallInExpr(s.value, line, col);
        case "ReturnStatement":
        case "ThrowStatement":
            return findTaskCallInExpr(s.value, line, col);
        case "IfStatement": {
            const r =
                findTaskCallInExpr(s.condition, line, col) ??
                findTaskCallAt(s.then, line, col);
            if (r) return r;
            return s.else_ ? findTaskCallAt(s.else_, line, col) : undefined;
        }
        case "SwitchStatement": {
            const r = findTaskCallInExpr(s.discriminant, line, col);
            if (r) return r;
            for (const arm of s.arms) {
                const f = findTaskCallAt(arm.body, line, col);
                if (f) return f;
            }
            return s.default_
                ? findTaskCallAt(s.default_, line, col)
                : undefined;
        }
        case "BreakStatement":
            return undefined;
    }
}

function findTaskCallInExpr(
    e: Expr,
    line: number,
    col: number,
): TaskCallExpr | undefined {
    switch (e.kind) {
        case "TaskCallExpr":
            if (
                e.loc.line === line &&
                col >= e.loc.col &&
                col <= e.loc.col + e.task.length
            ) {
                return e;
            }
            for (const a of e.args) {
                const f = findTaskCallInExpr(a.value, line, col);
                if (f) return f;
            }
            return undefined;
        case "WorkflowCallExpr":
            for (const a of e.args) {
                const f = findTaskCallInExpr(a.value, line, col);
                if (f) return f;
            }
            return undefined;
        case "BinaryExpr":
            return (
                findTaskCallInExpr(e.left, line, col) ??
                findTaskCallInExpr(e.right, line, col)
            );
        case "UnaryExpr":
            return findTaskCallInExpr(e.operand, line, col);
        case "TernaryExpr":
            return (
                findTaskCallInExpr(e.condition, line, col) ??
                findTaskCallInExpr(e.consequent, line, col) ??
                findTaskCallInExpr(e.alternate, line, col)
            );
        case "TemplateLiteralExpr":
            for (const part of e.expressions) {
                const f = findTaskCallInExpr(part, line, col);
                if (f) return f;
            }
            return undefined;
        case "ArrayLiteralExpr":
            for (const el of e.elements) {
                const f = findTaskCallInExpr(el, line, col);
                if (f) return f;
            }
            return undefined;
        case "ObjectLiteralExpr":
            for (const en of e.entries) {
                const f = findTaskCallInExpr(en.value, line, col);
                if (f) return f;
            }
            return undefined;
        case "AttemptsNode": {
            const r =
                findTaskCallInExpr(e.count, line, col) ??
                findTaskCallAt(e.body, line, col);
            if (r) return r;
            return e.fallback
                ? findTaskCallAt(e.fallback.body, line, col)
                : undefined;
        }
        case "MapNode":
        case "FilterNode":
            return (
                findTaskCallInExpr(e.collection, line, col) ??
                findTaskCallAt(e.body, line, col)
            );
        case "ParallelNode":
            for (const br of e.bodies) {
                const f = findTaskCallAt(br.body, line, col);
                if (f) return f;
            }
            return e.maxConcurrency
                ? findTaskCallInExpr(e.maxConcurrency, line, col)
                : undefined;
        case "ParallelMapNode":
            return (
                findTaskCallInExpr(e.collection, line, col) ??
                findTaskCallAt(e.body, line, col) ??
                (e.maxConcurrency
                    ? findTaskCallInExpr(e.maxConcurrency, line, col)
                    : undefined)
            );
        default:
            return undefined;
    }
}
