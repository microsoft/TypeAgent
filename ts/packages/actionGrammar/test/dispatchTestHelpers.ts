// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GrammarRule, RulesPart } from "../src/grammarTypes.js";

/**
 * Type guard: a `RulesPart` that has a `dispatch` index attached.
 * Equivalent to the previous `DispatchPart` shape - lets tests keep
 * the readable `expect(isDispatched(p)).toBe(true)` form after the
 * type unification.
 */
export type DispatchedRulesPart = RulesPart & {
    dispatch: NonNullable<RulesPart["dispatch"]>;
};

export function isDispatched(p: RulesPart): p is DispatchedRulesPart {
    return p.dispatch !== undefined;
}

/**
 * Inspection helper: union all `dispatch` per-mode tokenMaps into a
 * single `Map<string, GrammarRule[]>`.  Tokens that appear in more
 * than one per-mode bucket (rare - mixed-mode dispatch with the same
 * leading token under both spacing modes) get their rule lists
 * concatenated in `dispatch` order.
 *
 * Intended for tests and other inspectors that don't care about
 * which mode a bucket comes from.  The matcher itself never calls
 * this; it walks `dispatch` directly so it can pass each entry's
 * `spacingMode` to `peekNextToken`.
 *
 * Not cached - callers are inspection paths, not hot paths.
 */
export function getDispatchAllTokenMap(
    p: DispatchedRulesPart,
): Map<string, GrammarRule[]> {
    if (p.dispatch.length === 1) return p.dispatch[0].tokenMap;
    const merged = new Map<string, GrammarRule[]>();
    for (const m of p.dispatch) {
        for (const [k, v] of m.tokenMap) {
            const existing = merged.get(k);
            if (existing !== undefined) {
                merged.set(k, existing.concat(v));
            } else {
                merged.set(k, v);
            }
        }
    }
    return merged;
}

/**
 * Total static token-key count summed across every `dispatch`
 * entry's `tokenMap`.  Each token key corresponds to one bucket of
 * rules, so this is also the total bucket count - but reading it as
 * "number of distinct first tokens we can dispatch on" tends to be
 * less ambiguous than "buckets" (which can be confused with the
 * `dispatch` array itself).
 */
export function getDispatchTokenKeyCount(p: DispatchedRulesPart): number {
    let n = 0;
    for (const m of p.dispatch) n += m.tokenMap.size;
    return n;
}
