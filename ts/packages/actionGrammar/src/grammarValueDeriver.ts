// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Value-derivation logic shared by grammarOptimizer.ts and
 * nfaCompiler.ts: computing a rule's effective value expression.
 */

import type { CompiledValueNode, GrammarRule } from "./grammarTypes.js";

/**
 * A rule's explicit `->` value when present, otherwise the implicit
 * value from a single variable-bearing part across the rule's `parts`.
 * Throws if a value is required and missing/ambiguous. Not every rule
 * needs a value - only when `requireValue` is set (top-level action
 * rules, or nested rules captured by a parent variable) do
 * ambiguous/missing values throw; otherwise both resolve to
 * `undefined`. `describeRule` is only invoked when an error is thrown.
 */
export function deriveEffectiveValue(
    rule: GrammarRule,
    requireValue = false,
    describeRule?: () => string,
): CompiledValueNode | undefined {
    if (rule.value !== undefined) {
        return rule.value;
    }
    const variableParts = rule.parts.filter((p) => p.variable !== undefined);
    if (variableParts.length === 1) {
        return { type: "variable", name: variableParts[0].variable! };
    }
    if (!requireValue) {
        return undefined;
    }
    const description = describeRule?.() ?? "";
    const term = rule.parts.length === 1 ? "term" : "terms";
    const reason =
        variableParts.length > 1
            ? "more than one part carries a variable - the implicit value is ambiguous"
            : "no part carries a variable";
    throw new Error(
        `Internal error: ${description} has ${rule.parts.length} ${term} but no value expression, and ${reason}. ` +
            "Rules must have an explicit value expression (using ->) unless exactly one part carries a variable.",
    );
}
