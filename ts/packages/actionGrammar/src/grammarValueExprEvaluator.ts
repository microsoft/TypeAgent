// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Runtime evaluator for value expression nodes.
 *
 * Called from grammarMatcher.ts `createValue()` when a CompiledValueNode
 * is one of the expression types (binaryExpression, unaryExpression, etc.).
 *
 * Security: method calls are restricted to a whitelist of safe built-in
 * string/array methods.  No arbitrary function execution is allowed.
 */

import type { CompiledValueNode } from "./grammarTypes.js";

/**
 * Callback type for evaluating base value nodes (literal, variable, object, array).
 * The evaluator delegates back to grammarMatcher's createValue for these.
 */
export type EvalBaseValueFn = (node: CompiledValueNode) => unknown;

// ── Safe method whitelist ─────────────────────────────────────────────────────

const SAFE_METHODS = new Set<string>([
    // String methods
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "slice",
    "concat",
    "includes",
    "startsWith",
    "endsWith",
    "split",
    "indexOf",
    "lastIndexOf",
    "toString",
    "substring",
    "replace",
    "replaceAll",
    "padStart",
    "padEnd",
    "charAt",
    "at",
    "repeat",
    // Array methods
    "join",
    "flat",
    "flatMap",
    "map",
    "filter",
    "find",
    "findIndex",
    "every",
    "some",
    "reverse",
    "sort",
    "keys",
    "values",
    "entries",
    "indexOf",
    "lastIndexOf",
    "includes",
    "slice",
    "concat",
]);

/**
 * Evaluate a compiled value expression node, producing a runtime value.
 *
 * @param node       The expression node to evaluate
 * @param evalBase   Callback to evaluate base nodes (literal, variable, object, array)
 *                   — delegates back to grammarMatcher's createValue.
 */
export function evaluateValueExpr(
    node: CompiledValueNode,
    evalBase: EvalBaseValueFn,
): unknown {
    switch (node.type) {
        // ── Base types — delegate back ────────────────────────────────────
        case "literal":
        case "variable":
        case "object":
        case "array":
            return evalBase(node);

        // ── Binary expression ─────────────────────────────────────────────
        case "binaryExpression": {
            // Short-circuit operators
            if (node.operator === "&&") {
                const left = evaluateValueExpr(node.left, evalBase);
                return left ? evaluateValueExpr(node.right, evalBase) : left;
            }
            if (node.operator === "||") {
                const left = evaluateValueExpr(node.left, evalBase);
                return left ? left : evaluateValueExpr(node.right, evalBase);
            }
            if (node.operator === "??") {
                const left = evaluateValueExpr(node.left, evalBase);
                return left != null
                    ? left
                    : evaluateValueExpr(node.right, evalBase);
            }

            const left = evaluateValueExpr(node.left, evalBase);
            const right = evaluateValueExpr(node.right, evalBase);

            switch (node.operator) {
                case "+":
                    return (left as any) + (right as any);
                case "-":
                    return (left as any) - (right as any);
                case "*":
                    return (left as any) * (right as any);
                case "/":
                    return (left as any) / (right as any);
                case "%":
                    return (left as any) % (right as any);
                case "===":
                    return left === right;
                case "!==":
                    return left !== right;
                case "<":
                    return (left as any) < (right as any);
                case ">":
                    return (left as any) > (right as any);
                case "<=":
                    return (left as any) <= (right as any);
                case ">=":
                    return (left as any) >= (right as any);
            }
            break; // unreachable — all operators handled
        }

        // ── Unary expression ──────────────────────────────────────────────
        case "unaryExpression": {
            const operand = evaluateValueExpr(node.operand, evalBase);
            switch (node.operator) {
                case "-":
                    return -(operand as any);
                case "+":
                    return +(operand as any);
                case "!":
                    return !operand;
                case "typeof":
                    return typeof operand;
            }
            break; // unreachable — all operators handled
        }

        // ── Conditional (ternary) ─────────────────────────────────────────
        case "conditionalExpression": {
            const test = evaluateValueExpr(node.test, evalBase);
            return test
                ? evaluateValueExpr(node.consequent, evalBase)
                : evaluateValueExpr(node.alternate, evalBase);
        }

        // ── Member access ─────────────────────────────────────────────────
        case "memberExpression": {
            const obj = evaluateValueExpr(node.object, evalBase);
            if (node.optional && obj == null) {
                return undefined;
            }
            const key =
                typeof node.property === "string"
                    ? node.property
                    : (evaluateValueExpr(node.property, evalBase) as
                          | string
                          | number);
            return (obj as any)?.[key];
        }

        // ── Method / function call ────────────────────────────────────────
        case "callExpression": {
            const args = node.arguments.map((a) =>
                evaluateValueExpr(a, evalBase),
            );

            // Only method calls are supported (callee must be a memberExpression).
            if (node.callee.type !== "memberExpression") {
                throw new Error(
                    "Free function calls are not supported in grammar value expressions. Use obj.method() form.",
                );
            }

            const memberNode = node.callee;
            const obj = evaluateValueExpr(memberNode.object, evalBase);

            if (memberNode.optional && obj == null) {
                return undefined;
            }

            const methodName =
                typeof memberNode.property === "string"
                    ? memberNode.property
                    : String(evaluateValueExpr(memberNode.property, evalBase));

            if (!SAFE_METHODS.has(methodName)) {
                throw new Error(
                    `Method '${methodName}' is not allowed in grammar value expressions. ` +
                        `Allowed methods: ${Array.from(SAFE_METHODS).sort().join(", ")}`,
                );
            }

            const fn = (obj as any)?.[methodName];
            if (typeof fn !== "function") {
                throw new Error(
                    `'${methodName}' is not a function on the target value`,
                );
            }
            return fn.apply(obj, args);
        }

        // ── Spread ────────────────────────────────────────────────────────
        case "spreadElement": {
            // Spread is handled by the parent array/object context.
            // If we reach here directly, just return the inner value.
            return evaluateValueExpr(node.argument, evalBase);
        }

        // ── Template literal ──────────────────────────────────────────────
        case "templateLiteral": {
            const parts: string[] = [];
            for (let i = 0; i < node.quasis.length; i++) {
                parts.push(node.quasis[i]);
                if (i < node.expressions.length) {
                    const val = evaluateValueExpr(
                        node.expressions[i],
                        evalBase,
                    );
                    parts.push(String(val));
                }
            }
            return parts.join("");
        }

        default:
            throw new Error(
                `Unknown value expression node type '${(node as any).type}'`,
            );
    }
}
