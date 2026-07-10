// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Structural derivation of a rule's *implicit* value expression when it
 * has no explicit `->` expression.
 *
 * A rule with exactly one variable-bearing part implicitly forwards that
 * part's value - this mirrors the AST matcher's implicit-default rule
 * (see grammarMatcher.ts) and is the single source of truth shared by:
 *   - grammarOptimizer.ts's `getImplicitDefaultValue`, used by the
 *     value-substitution branch of `tryPromoteTrailing` to fold each
 *     member's effective value into the parent's value expression.
 *   - nfaCompiler.ts's `deriveEffectiveValue`, which additionally handles
 *     single-variable rules and decides whether an ambiguous/missing
 *     value should throw.
 */

import type {
    CompiledValueNode,
    GrammarPart,
    GrammarRule,
} from "./grammarTypes.js";

/**
 * Find the single part (if any) that carries a variable across a rule's
 * parts, so its value can stand in for the whole rule's implicit value
 * when the rule has no explicit `->` expression. Returns `"ambiguous"`
 * when 2+ parts carry a variable, or `undefined` when none do.
 */
export function findSingleValueBearingPart(
    parts: GrammarPart[],
): { variable: string } | "ambiguous" | undefined {
    let found: string | undefined;
    for (const p of parts) {
        const name = p.variable;
        if (name === undefined) continue;
        if (found !== undefined) return "ambiguous";
        found = name;
    }
    return found !== undefined ? { variable: found } : undefined;
}

/**
 * Result of `deriveImplicitValue`: either a concrete forwarding value
 * (the rule's own `->` expression, or a single variable-bearing part's
 * value), `"ambiguous"` (2+ parts carry a variable - callers decide
 * whether that's an error), or `undefined` (no part carries a variable,
 * or the rule has no parts at all).
 */
export type ImplicitValueResult =
    | { kind: "value"; value: CompiledValueNode }
    | { kind: "ambiguous" }
    | { kind: "none" };

/**
 * Compute the value expression a rule would implicitly produce if it
 * has no explicit `->` expression (via `findSingleValueBearingPart`).
 */
export function deriveImplicitValue(rule: GrammarRule): ImplicitValueResult {
    if (rule.value !== undefined) {
        return { kind: "value", value: rule.value };
    }
    if (rule.parts.length === 0) {
        return { kind: "none" };
    }
    const result = findSingleValueBearingPart(rule.parts);
    if (result === "ambiguous") {
        return { kind: "ambiguous" };
    }
    if (result === undefined) {
        return { kind: "none" };
    }
    return {
        kind: "value",
        value: { type: "variable", name: result.variable },
    };
}
