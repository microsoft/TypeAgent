// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Runtime evaluator for value expression nodes.
 *
 * Called from grammarMatcher.ts `createValue()` when a CompiledValueNode
 * is one of the expression types (binaryExpression, unaryExpression, etc.).
 *
 * Security: method calls are restricted to a whitelist of safe built-in
 * string/array/number methods.  No arbitrary function execution is allowed.
 */

import type { CompiledValueNode } from "./grammarTypes.js";
import { METHOD_RETURN_TYPE_TABLES } from "./grammarValueTypeValidator.js";

/**
 * Callback type for evaluating base value nodes (literal, variable, object, array).
 * The evaluator delegates back to grammarMatcher's createValue for these.
 */
export type EvalBaseValueFn = (node: CompiledValueNode) => unknown;

// ── Safe method whitelist ─────────────────────────────────────────────────────
// Derived from the compile-time return-type tables — single source of truth.

const SAFE_METHODS = new Set<string>(
    Object.values(METHOD_RETURN_TYPE_TABLES).flatMap((s) => [...s]),
);

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
            // Short-circuit operators.
            // These use JS short-circuit semantics (returning the actual
            // operand value, not a coerced boolean).  This is correct
            // because the type system guarantees boolean operands, so
            // the result is always boolean.
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

            // Casts to `any` are safe: compile-time validation in
            // grammarValueTypeValidator.ts guarantees operand types match
            // the operator's requirements (e.g. both number for `-`).
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
            // Cast safe: compile-time type validation ensures correct operand type.
            switch (node.operator) {
                case "-":
                    return -(operand as number);
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
            // Short-circuit for optional calls: ?.() when callee is nullish.
            if (node.optional) {
                const calleeVal = evaluateValueExpr(node.callee, evalBase);
                if (calleeVal == null) {
                    return undefined;
                }
            }

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
