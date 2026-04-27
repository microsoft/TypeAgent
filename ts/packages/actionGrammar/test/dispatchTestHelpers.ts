// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatchPart, GrammarRule } from "../src/grammarTypes.js";

/**
 * Inspection helper: union all `perMode` tokenMaps into a single
 * `Map<string, GrammarRule[]>`.  Tokens that appear in more than
 * one per-mode bucket (rare - mixed-mode dispatch with the same
 * leading token under both spacing modes) get their rule lists
 * concatenated in `perMode` order.
 *
 * Intended for tests and other inspectors that don't care about
 * which mode a bucket comes from.  The matcher itself never calls
 * this; it walks `perMode` directly so it can pass each entry's
 * `spacingMode` to `peekNextToken`.
 *
 * Not cached - callers are inspection paths, not hot paths.
 */
export function getDispatchAllTokenMap(
    p: DispatchPart,
): Map<string, GrammarRule[]> {
    if (p.perMode.length === 1) return p.perMode[0].tokenMap;
    const merged = new Map<string, GrammarRule[]>();
    for (const m of p.perMode) {
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
 * Total static token-key count summed across every `perMode` entry's
 * `tokenMap`.  Each token key corresponds to one bucket of rules,
 * so this is also the total bucket count - but reading it as
 * "number of distinct first tokens we can dispatch on" tends to be
 * less ambiguous than "buckets" (which can be confused with the
 * `perMode` array itself).
 */
export function getDispatchTokenKeyCount(p: DispatchPart): number {
    let n = 0;
    for (const m of p.perMode) n += m.tokenMap.size;
    return n;
}
