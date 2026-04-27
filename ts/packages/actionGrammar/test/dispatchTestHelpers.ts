// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
} from "../src/grammarTypes.js";
import { matchGrammar } from "../src/grammarMatcher.js";

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

/**
 * Sorted JSON list of `matchGrammar` matches for a request.  The
 * canonical comparison helper used by every dispatch spec to
 * verify that an optimized grammar produces the same matches as
 * its unoptimized baseline.
 */
export function match(grammar: Grammar, request: string): string[] {
    return matchGrammar(grammar, request)
        .map((m) => JSON.stringify(m.match))
        .sort();
}

/**
 * Find the first dispatched part anywhere in `grammar` (including
 * the top-level dispatch hoisted onto `grammar.dispatch`).  When
 * `grammar.dispatch` is set, returns a synthesized
 * `DispatchedRulesPart` view over the top-level alternation so
 * callers can use the same `getDispatchAllTokenMap` /
 * `getDispatchTokenKeyCount` inspectors uniformly.  Otherwise
 * walks every nested `RulesPart` and returns the first one whose
 * `dispatch` is set.
 */
export function findDispatchPart(
    grammar: Grammar,
): DispatchedRulesPart | undefined {
    if (grammar.dispatch !== undefined) {
        return {
            type: "rules",
            alternatives: grammar.alternatives,
            dispatch: grammar.dispatch,
        } as DispatchedRulesPart;
    }
    const seen = new WeakSet<GrammarRule[]>();
    const visit = (rs: GrammarRule[]): DispatchedRulesPart | undefined => {
        if (seen.has(rs)) return undefined;
        seen.add(rs);
        for (const r of rs) {
            for (const p of r.parts) {
                if (p.type === "rules") {
                    if (isDispatched(p)) return p;
                    const inner = visit(p.alternatives);
                    if (inner) return inner;
                }
            }
        }
        return undefined;
    };
    return visit(grammar.alternatives);
}

/**
 * Find every dispatched `RulesPart` in `grammar`, including any
 * nested inside another dispatched part's buckets or fallback.
 * Returned in pre-order.  Top-level `grammar.dispatch` (if set) is
 * the first entry, exposed via the same synthesized view as
 * `findDispatchPart`.
 */
export function findAllDispatchParts(grammar: Grammar): DispatchedRulesPart[] {
    const out: DispatchedRulesPart[] = [];
    if (grammar.dispatch !== undefined) {
        out.push({
            type: "rules",
            alternatives: grammar.alternatives,
            dispatch: grammar.dispatch,
        } as DispatchedRulesPart);
    }
    const visited = new WeakSet<GrammarRule[]>();
    const visitParts = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type !== "rules") continue;
            if (isDispatched(p)) {
                out.push(p);
                for (const m of p.dispatch) {
                    for (const bucket of m.tokenMap.values()) {
                        if (visited.has(bucket)) continue;
                        visited.add(bucket);
                        for (const r of bucket) visitParts(r.parts);
                    }
                }
            }
            if (visited.has(p.alternatives)) continue;
            visited.add(p.alternatives);
            for (const r of p.alternatives) visitParts(r.parts);
        }
    };
    for (const r of grammar.alternatives) visitParts(r.parts);
    return out;
}
