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
 * A part that solely carries a rule's implicit value: the variable name
 * it binds, and the `GrammarPart` itself (so callers that need more than
 * the name - e.g. its type - don't have to re-scan `parts`).
 */
export type ValueBearingPart = { variable: string; part: GrammarPart };

/**
 * Find the single part (if any) that carries a variable across a rule's
 * parts, so its value can stand in for the whole rule's implicit value
 * when the rule has no explicit `->` expression. Returns `"ambiguous"`
 * when 2+ parts carry a variable, or `undefined` when none do.
 */
export function findSingleValueBearingPart(
    parts: GrammarPart[],
): ValueBearingPart | "ambiguous" | undefined {
    let found: ValueBearingPart | undefined;
    for (const p of parts) {
        const name = p.variable;
        if (name === undefined) continue;
        if (found !== undefined) return "ambiguous";
        found = { variable: name, part: p };
    }
    return found;
}

/**
 * Derive a rule's effective value expression: its explicit `->` value
 * when present, otherwise the implicit value from a single
 * variable-bearing part (via `findSingleValueBearingPart`). Throws if a
 * value is required and missing/ambiguous. Not every rule needs a value -
 * only when `requireValue` is set (top-level action rules, or nested
 * rules captured by a parent variable) do ambiguous/missing values
 * throw; otherwise both resolve to `undefined`. `describeRule` is only
 * invoked when an error is thrown.
 */
export function deriveEffectiveValue(
    rule: GrammarRule,
    describeRule?: () => string,
    requireValue = false,
): CompiledValueNode | undefined {
    if (rule.value !== undefined) {
        return rule.value;
    }
    const result = findSingleValueBearingPart(rule.parts);
    if (result !== undefined && result !== "ambiguous") {
        return { type: "variable", name: result.variable };
    }
    if (!requireValue) {
        return undefined;
    }
    const termsDescription =
        rule.parts.length === 1
            ? "has 1 term"
            : `has ${rule.parts.length} terms`;
    const description = describeRule?.() ?? "";
    if (result === "ambiguous") {
        throw new Error(
            `${description} ${termsDescription} but no value expression, ` +
                `and more than one part carries a variable - the implicit value is ambiguous. ` +
                `Rules must have an explicit value expression (using ->) unless exactly one part carries a variable.`,
        );
    }
    throw new Error(
        `${description} ${termsDescription} but no value expression, and no part carries a variable. ` +
            `Rules must have an explicit value expression (using ->) unless exactly one part carries a variable.`,
    );
}
