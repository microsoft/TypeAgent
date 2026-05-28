// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Semantic tokens feature.
 *
 * Colorizes identifier references by what they resolve to:
 *  - workflow parameters and lambda parameters    -> "parameter"
 *  - top-level const bindings                     -> "variable" + "readonly" modifier
 *  - task calls (e.g. `shell.exec`)               -> "function"
 *  - resolved property accesses (e.g. `.stdout`)  -> "property"
 *  - type arguments (e.g. `<{ name: string }>`)   -> "type"
 *
 * Bare identifiers that don't resolve to anything (parse errors,
 * unknown names) are skipped - the diagnostics feature already
 * surfaces those.
 *
 * The token legend is exposed at server registration time so VS Code
 * picks the right theme colors.
 */

import {
    SemanticTokens,
    SemanticTokensBuilder,
    SemanticTokensLegend,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TypeExpr, Statement, Expr } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";

function assertNever(x: never): never {
    throw new Error(`Unexpected value: ${x}`);
}

const TOKEN_TYPES = [
    "parameter",
    "variable",
    "function",
    "property",
    "type",
] as const;
type TokenType = (typeof TOKEN_TYPES)[number];

const TYPE_INDEX: Record<TokenType, number> = {
    parameter: 0,
    variable: 1,
    function: 2,
    property: 3,
    type: 4,
};

const TOKEN_MODIFIERS = ["readonly"] as const;
type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** Bitmask for a set of modifiers. */
function modifierMask(...mods: TokenModifier[]): number {
    return mods.reduce((acc, m) => acc | (1 << TOKEN_MODIFIERS.indexOf(m)), 0);
}

export const semanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
};

type Entry = {
    line: number;
    col: number;
    length: number;
    type: TokenType;
    modifier: number;
};

export function computeSemanticTokens(doc: TextDocument): SemanticTokens {
    const parsed = getParsed(doc);
    const builder = new SemanticTokensBuilder();
    if (!parsed.symbols) return builder.build();

    // Sort by (line, col) so the LSP delta encoding is monotonic.
    const entries: Entry[] = [];

    for (const ref of parsed.symbols.refs) {
        if (!ref.def) continue;
        const isParam =
            ref.def.kind === "param" || ref.def.kind === "lambdaParam";
        entries.push({
            line: ref.loc.line - 1,
            col: ref.loc.col - 1,
            length: ref.name.length,
            type: isParam ? "parameter" : "variable",
            // Const bindings are immutable - mark readonly so themes color them
            // distinctly from mutable variables (matches TypeScript behavior).
            modifier: !isParam ? modifierMask("readonly") : 0,
        });
    }
    for (const task of parsed.symbols.taskRefs) {
        entries.push({
            line: task.loc.line - 1,
            col: task.loc.col - 1,
            length: task.name.length,
            type: "function",
            modifier: 0,
        });
    }

    // Emit property tokens for resolved property accesses (e.g. `.stdout`).
    for (const ref of parsed.propertyRefs ?? []) {
        entries.push({
            line: ref.line - 1,
            col: ref.col - 1,
            length: ref.length,
            type: "property",
            modifier: 0,
        });
    }

    // Emit type tokens for type arguments in task calls (e.g. `<{ name: string }>`).
    for (const wf of parsed.workflows) {
        collectTypeArgTokens(wf.decl.body, entries);
    }

    entries.sort((a, b) => a.line - b.line || a.col - b.col);

    for (const e of entries) {
        builder.push(e.line, e.col, e.length, TYPE_INDEX[e.type], e.modifier);
    }
    return builder.build();
}

// ---- Type argument token collection ----

/** Emit "type" tokens for each named type in task call type args. */
function collectTypeArgTokens(stmts: Statement[], out: Entry[]): void {
    for (const s of stmts) walkStmt(s, out);
}

function walkStmt(s: Statement, out: Entry[]): void {
    switch (s.kind) {
        case "ConstStatement":
        case "DestructuringConst":
            walkExpr(s.value, out);
            return;
        case "ReturnStatement":
        case "ThrowStatement":
            walkExpr(s.value, out);
            return;
        case "IfStatement":
            walkExpr(s.condition, out);
            collectTypeArgTokens(s.then, out);
            if (s.else_) collectTypeArgTokens(s.else_, out);
            return;
        case "SwitchStatement":
            walkExpr(s.discriminant, out);
            for (const arm of s.arms) collectTypeArgTokens(arm.body, out);
            if (s.default_) collectTypeArgTokens(s.default_, out);
            return;
        case "BreakStatement":
            return;
        default:
            assertNever(s);
    }
}

function walkExpr(e: Expr, out: Entry[]): void {
    switch (e.kind) {
        case "TaskCallExpr":
            if (e.typeArgs) {
                for (const ta of e.typeArgs) emitTypeExprTokens(ta, out);
            }
            for (const a of e.args) walkExpr(a.value, out);
            return;
        case "WorkflowCallExpr":
            for (const a of e.args) walkExpr(a.value, out);
            return;
        case "BinaryExpr":
            walkExpr(e.left, out);
            walkExpr(e.right, out);
            return;
        case "UnaryExpr":
            walkExpr(e.operand, out);
            return;
        case "TernaryExpr":
            walkExpr(e.condition, out);
            walkExpr(e.consequent, out);
            walkExpr(e.alternate, out);
            return;
        case "TemplateLiteralExpr":
            for (const part of e.expressions) walkExpr(part, out);
            return;
        case "ArrayLiteralExpr":
            for (const el of e.elements) walkExpr(el, out);
            return;
        case "ObjectLiteralExpr":
            for (const en of e.entries) walkExpr(en.value, out);
            return;
        case "AttemptsNode":
            walkExpr(e.count, out);
            collectTypeArgTokens(e.body, out);
            if (e.fallback) collectTypeArgTokens(e.fallback.body, out);
            return;
        case "MapNode":
        case "FilterNode":
            walkExpr(e.collection, out);
            collectTypeArgTokens(e.body, out);
            return;
        case "ParallelNode":
            for (const br of e.bodies) collectTypeArgTokens(br.body, out);
            if (e.maxConcurrency) walkExpr(e.maxConcurrency, out);
            return;
        case "ParallelMapNode":
            walkExpr(e.collection, out);
            collectTypeArgTokens(e.body, out);
            if (e.maxConcurrency) walkExpr(e.maxConcurrency, out);
            return;
        case "DottedNameExpr":
        case "StringLiteralExpr":
        case "NumberLiteralExpr":
        case "BooleanLiteralExpr":
        case "NullLiteralExpr":
            return;
        default:
            assertNever(e);
    }
}

/** Emit "type" tokens for named types in a TypeExpr (recursively). */
function emitTypeExprTokens(te: TypeExpr, out: Entry[]): void {
    switch (te.kind) {
        case "NamedType":
            out.push({
                line: te.loc.line - 1,
                col: te.loc.col - 1,
                length: te.name.length,
                type: "type",
                modifier: 0,
            });
            return;
        case "ArrayType":
            emitTypeExprTokens(te.element, out);
            return;
        case "ObjectType":
            for (const f of te.fields) {
                emitTypeExprTokens(f.type, out);
            }
            return;
        default:
            assertNever(te);
    }
}
