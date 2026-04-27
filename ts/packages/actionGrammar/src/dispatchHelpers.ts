// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GrammarRule, RulesPart } from "./grammarTypes.js";

/**
 * Lazy per-`RulesPart` cache of the flattened effective member list
 * for a dispatched part: `[...allBuckets.flat(), ...rules]` (where
 * `rules` is the fallback subset).  Shared by:
 *   - `validateTailRulesParts` in `grammarOptimizer.ts` (tail
 *     contract validation),
 *   - `derivePartType` / `classifyRuleValue` in
 *     `grammarValueTypeValidator.ts` (value-type derivation),
 *   - `enterDispatchPart` in `grammarMatcher.ts` (pending-wildcard
 *     fallback path - allocates the full effective list once).
 *
 * For non-dispatched parts (no `dispatch` field set) the result is
 * just `part.rules` - no cache entry is allocated.
 *
 * Keyed by `RulesPart` identity via a module-local `WeakMap` so the
 * cache is invalidated automatically when a part becomes
 * unreachable.  Lives in this neutral module so neither the matcher
 * nor the validator has to import optimizer internals.
 */
const dispatchEffectiveCache = new WeakMap<RulesPart, GrammarRule[]>();

export function getDispatchEffectiveMembers(p: RulesPart): GrammarRule[] {
    if (p.dispatch === undefined) return p.rules;
    let cached = dispatchEffectiveCache.get(p);
    if (cached !== undefined) return cached;
    const members: GrammarRule[] = [];
    for (const m of p.dispatch) {
        for (const bucket of m.tokenMap.values()) {
            for (const r of bucket) members.push(r);
        }
    }
    for (const r of p.rules) members.push(r);
    dispatchEffectiveCache.set(p, members);
    return members;
}
