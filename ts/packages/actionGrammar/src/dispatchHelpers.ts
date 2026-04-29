// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GrammarRule, RulesPart } from "./grammarTypes.js";

/**
 * Per-`RulesPart` lazy caches shared across the dispatch fast paths.
 * One `WeakMap` keyed on the part identity holds the union of:
 *   - `effective`: the flattened effective member list
 *     (`[...allBuckets.flat(), ...rules]`) used by tail-contract
 *     validation, value-type derivation, and the matcher's
 *     pending-wildcard fallback.
 *   - `merged` / `mergedMulti`: per-(hit-bucket, fallback) and
 *     per-(bucketA, bucketB, fallback) merged effective lists used
 *     by `enterDispatchPart` to allocate each merged list once and
 *     reuse on subsequent matches.
 *
 * Keyed by `RulesPart` identity so entries are reclaimed
 * automatically when the part becomes unreachable.  Lives in this
 * neutral module so neither the matcher, the validator, nor the
 * optimizer has to import each other's internals.
 */
type DispatchPartCaches = {
    effective?: GrammarRule[];
    merged?: Map<GrammarRule[], GrammarRule[]>;
    mergedMulti?: Map<GrammarRule[], Map<GrammarRule[], GrammarRule[]>>;
};

const dispatchCaches = new WeakMap<RulesPart, DispatchPartCaches>();

function getCaches(p: RulesPart): DispatchPartCaches {
    let c = dispatchCaches.get(p);
    if (c === undefined) {
        c = {};
        dispatchCaches.set(p, c);
    }
    return c;
}

export function getDispatchEffectiveMembers(p: RulesPart): GrammarRule[] {
    if (p.dispatch === undefined) return p.alternatives;
    const c = getCaches(p);
    if (c.effective !== undefined) return c.effective;
    // Dedup by rule identity: the optimizer's multi-key dispatch
    // (`expandDispatchKeys`) places a single rule under multiple
    // `tokenMap` entries inside the same per-mode bucket so the
    // input peek can hit it from any reachable first token.  Each
    // bucket entry is a distinct array containing the rule object,
    // and the effective-members view (used for tail validation,
    // value-type derivation, and the matcher's pending-wildcard
    // fallback) must list each rule exactly once - otherwise the
    // pending-wildcard fallback path would try the same rule once
    // per bucket and emit duplicate match results.
    const seen = new Set<GrammarRule>();
    const members: GrammarRule[] = [];
    for (const m of p.dispatch) {
        for (const bucket of m.tokenMap.values()) {
            for (const r of bucket) {
                if (seen.has(r)) continue;
                seen.add(r);
                members.push(r);
            }
        }
    }
    for (const r of p.alternatives) {
        if (seen.has(r)) continue;
        seen.add(r);
        members.push(r);
    }
    c.effective = members;
    return members;
}

/**
 * Get-or-build the merged `[...bucket, ...fallback]` array for a
 * dispatched `RulesPart` whose peek hit a single bucket.  Cached
 * per-`bucket` identity so the same merged array is reused across
 * every match that hits the same bucket.  Caller must only invoke
 * when `fallback.length > 0` (otherwise just use `bucket` directly).
 */
export function getDispatchMergedSingle(
    part: RulesPart,
    bucket: GrammarRule[],
    fallback: GrammarRule[],
): GrammarRule[] {
    const c = getCaches(part);
    let m = c.merged;
    if (m === undefined) {
        m = new Map();
        c.merged = m;
    }
    let merged = m.get(bucket);
    if (merged === undefined) {
        merged = bucket.concat(fallback);
        m.set(bucket, merged);
    }
    return merged;
}

/**
 * Get-or-build the merged `[...bucketA, ...bucketB, ...fallback]`
 * array for a dispatched `RulesPart` whose peek hit two buckets
 * (mixed-mode dispatch where both `required` and `auto` peeks hit).
 * Cached per-(bucketA, bucketB) identity pair.
 */
export function getDispatchMergedMulti(
    part: RulesPart,
    bucketA: GrammarRule[],
    bucketB: GrammarRule[],
    fallback: GrammarRule[],
): GrammarRule[] {
    const c = getCaches(part);
    let outer = c.mergedMulti;
    if (outer === undefined) {
        outer = new Map();
        c.mergedMulti = outer;
    }
    let inner = outer.get(bucketA);
    if (inner === undefined) {
        inner = new Map();
        outer.set(bucketA, inner);
    }
    let merged = inner.get(bucketB);
    if (merged === undefined) {
        merged =
            fallback.length === 0
                ? bucketA.concat(bucketB)
                : bucketA.concat(bucketB, fallback);
        inner.set(bucketB, merged);
    }
    return merged;
}
