// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Structural derivation of a rule's *effective* value expression: its
 * explicit `->` expression when present, otherwise an implicit
 * forwarding value derived from the rule's parts.
 *
 * A rule with exactly one variable-bearing part implicitly forwards that
 * part's value. This is the single source of truth for that
 * derivation, kept independent of any particular compilation backend.
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
 * Result of `deriveValue`: either a concrete value (the rule's own `->`
 * expression, or a single variable-bearing part's implicitly forwarded
 * value), `"ambiguous"` (2+ parts carry a variable and there is no
 * explicit value - callers decide whether that's an error), or `"none"`
 * (no explicit value and no part carries a variable, or the rule has no
 * parts at all).
 */
export type ImplicitValueResult =
    | { kind: "value"; value: CompiledValueNode }
    | { kind: "ambiguous" }
    | { kind: "none" };

/**
 * Compute a rule's effective value expression: its explicit `->` value
 * when present, otherwise the implicit value it would produce (via
 * `findSingleValueBearingPart`).
 */
export function deriveValue(rule: GrammarRule): ImplicitValueResult {
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
