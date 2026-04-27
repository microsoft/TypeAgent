// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatchPart, GrammarRule } from "./grammarTypes.js";

/**
 * Lazy per-`DispatchPart` cache of the flattened effective member
 * list (`[...allBuckets.flat(), ...fallback]`).  Shared by:
 *   - `validateTailRulesParts` in `grammarOptimizer.ts` (tail
 *     contract validation),
 *   - `derivePartType` / `classifyRuleValue` in
 *     `grammarValueTypeValidator.ts` (value-type derivation),
 *   - `enterDispatchPart` in `grammarMatcher.ts` (pending-wildcard
 *     fallback path - allocates the full effective list once).
 *
 * Keyed by `DispatchPart` identity via a module-local `WeakMap` so
 * the cache is invalidated automatically when a part becomes
 * unreachable.  Lives in this neutral module so neither the
 * matcher nor the validator has to import optimizer internals.
 */
const dispatchEffectiveCache = new WeakMap<DispatchPart, GrammarRule[]>();

export function getDispatchEffectiveMembers(p: DispatchPart): GrammarRule[] {
    let cached = dispatchEffectiveCache.get(p);
    if (cached !== undefined) return cached;
    const members: GrammarRule[] = [];
    for (const m of p.perMode) {
        for (const bucket of m.tokenMap.values()) {
            for (const r of bucket) members.push(r);
        }
    }
    if (p.fallback !== undefined) {
        for (const m of p.fallback) members.push(m);
    }
    dispatchEffectiveCache.set(p, members);
    return members;
}
