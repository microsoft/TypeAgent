// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Round-trip writer for value expression nodes.
 *
 * Called from grammarRuleWriter.ts `writeValueNode()` when a ValueNode
 * is one of the expression types (binaryExpression, unaryExpression, etc.).
 *
 * Handles operator precedence–based parenthesization so that
 *   parse → write → re-parse
 * produces the same AST.
 */

import { BINARY_PRECEDENCE } from "./grammarTypes.js";
import type { BinaryValueExprOp } from "./grammarTypes.js";
import type { ValueNode } from "./grammarRuleParser.js";

// ── Operator precedence table ─────────────────────────────────────────────────
// Imported from grammarTypes.ts — single source of truth.  The parser encodes
// the same precedence implicitly via its recursive-descent call chain;
// round-trip tests verify the two stay in sync.
//
// Per ECMA-262 §13.13, `??` cannot be mixed with `||` or `&&` without
// explicit parentheses.  `isCoalescingConflict` enforces this in the
// writer so round-tripping always produces valid expressions.

const NULLISH_OPS: ReadonlySet<BinaryValueExprOp> = new Set(["??"]);
const LOGICAL_OPS: ReadonlySet<BinaryValueExprOp> = new Set(["||", "&&"]);

/** True when parent and child mix `??` with `||`/`&&`. */
function isCoalescingConflict(
    parentOp: BinaryValueExprOp,
    child: ValueNode,
): boolean {
    if (child.type !== "binaryExpression") return false;
    const childOp = child.operator;
    return (
        (NULLISH_OPS.has(parentOp) && LOGICAL_OPS.has(childOp)) ||
        (LOGICAL_OPS.has(parentOp) && NULLISH_OPS.has(childOp))
    );
}

function precedenceOf(node: ValueNode): number {
    if (node.type === "binaryExpression") {
        return BINARY_PRECEDENCE[node.operator];
    }
    if (node.type === "conditionalExpression") {
        return 0; // Ternary is lowest
    }
    return 100; // Atoms and postfix — never need parens
}

/**
 * Callback type for writing base value nodes (literal, variable, object, array).
 * The writer delegates back to grammarRuleWriter's writeValueNode for these.
 */
export type WriteBaseValueFn = (node: ValueNode) => void;

/**
 * Callback type for writing raw text.
 */
export type WriteFn = (text: string) => void;

export interface ValueExprWriterContext {
    write: WriteFn;
    writeBase: WriteBaseValueFn;
}

/**
 * Write a compiled value expression node to text.
 */
export function writeValueExprNode(
    ctx: ValueExprWriterContext,
    node: ValueNode,
): void {
    switch (node.type) {
        // ── Base types — delegate back ────────────────────────────────────
        case "literal":
        case "variable":
        case "object":
        case "array":
            ctx.writeBase(node);
            return;

        // ── Binary expression ─────────────────────────────────────────────
        case "binaryExpression": {
            const prec = BINARY_PRECEDENCE[node.operator];
            writeWithParens(ctx, node.left, prec, "left", node.operator);
            ctx.write(` ${node.operator} `);
            writeWithParens(ctx, node.right, prec, "right", node.operator);
            return;
        }

        // ── Unary expression ──────────────────────────────────────────────
        case "unaryExpression": {
            if (node.operator === "typeof") {
                ctx.write("typeof ");
            } else {
                ctx.write(node.operator);
            }
            // Wrap operand in parens if it's a binary or ternary expression
            const needsParens =
                node.operand.type === "binaryExpression" ||
                node.operand.type === "conditionalExpression";
            if (needsParens) ctx.write("(");
            writeValueExprNode(ctx, node.operand);
            if (needsParens) ctx.write(")");
            return;
        }

        // ── Conditional (ternary) ─────────────────────────────────────────
        case "conditionalExpression":
            writeValueExprNode(ctx, node.test);
            ctx.write(" ? ");
            writeValueExprNode(ctx, node.consequent);
            ctx.write(" : ");
            writeValueExprNode(ctx, node.alternate);
            return;

        // ── Member access ─────────────────────────────────────────────────
        case "memberExpression": {
            // Wrap the object in parens if it's a lower-precedence node
            const needsParens =
                node.object.type === "binaryExpression" ||
                node.object.type === "conditionalExpression" ||
                node.object.type === "unaryExpression";
            if (needsParens) ctx.write("(");
            writeValueExprNode(ctx, node.object);
            if (needsParens) ctx.write(")");

            if (node.computed) {
                ctx.write(node.optional ? "?.[" : "[");
                writeValueExprNode(ctx, node.property as ValueNode);
                ctx.write("]");
            } else {
                ctx.write(node.optional ? "?." : ".");
                ctx.write(node.property as string);
            }
            return;
        }

        // ── Call expression ───────────────────────────────────────────────
        case "callExpression":
            writeValueExprNode(ctx, node.callee);
            ctx.write(node.optional ? "?.(" : "(");
            for (let i = 0; i < node.arguments.length; i++) {
                if (i > 0) ctx.write(", ");
                writeValueExprNode(ctx, node.arguments[i]);
            }
            ctx.write(")");
            return;

        // ── Spread ────────────────────────────────────────────────────────
        case "spreadElement":
            ctx.write("...");
            writeValueExprNode(ctx, node.argument);
            return;

        // ── Template literal ──────────────────────────────────────────────
        case "templateLiteral":
            ctx.write("`");
            for (let i = 0; i < node.quasis.length; i++) {
                ctx.write(escapeTemplateChars(node.quasis[i]));
                if (i < node.expressions.length) {
                    ctx.write("${");
                    writeValueExprNode(ctx, node.expressions[i]);
                    ctx.write("}");
                }
            }
            ctx.write("`");
            return;

        default:
            throw new Error(
                `Unknown value expression node type '${(node as any).type}'`,
            );
    }
}

function writeWithParens(
    ctx: ValueExprWriterContext,
    child: ValueNode,
    parentPrec: number,
    side: "left" | "right",
    parentOp?: BinaryValueExprOp,
): void {
    const childPrec = precedenceOf(child);
    // All binary operators are left-associative per the JS specification
    // (including `??`, see ECMA-262 §13.13 — "ShortCircuitExpression").
    // Parenthesize if child has lower precedence, or equal precedence on
    // the right side to preserve left-to-right evaluation order.
    //
    // Per ECMA-262 §13.13, `??` must always be parenthesized when nested
    // inside `||`/`&&` and vice versa — regardless of precedence.
    const needsParens =
        childPrec < parentPrec ||
        (childPrec === parentPrec && side === "right") ||
        (parentOp !== undefined && isCoalescingConflict(parentOp, child));
    if (needsParens) ctx.write("(");
    writeValueExprNode(ctx, child);
    if (needsParens) ctx.write(")");
}

function escapeTemplateChars(s: string): string {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
}
