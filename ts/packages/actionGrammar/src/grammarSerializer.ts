// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatchJson,
    DispatchModeBucket,
    Grammar,
    GrammarJson,
    GrammarPart,
    GrammarPartJson,
    GrammarRule,
    GrammarRuleJson,
    GrammarRulesJson,
    PhraseSetPartJson,
    RulePartJson,
    StringPartJson,
} from "./grammarTypes.js";

/**
 * Sentinel installed in a pool slot while `build` is running for it.
 * Any read of the slot from inside `build` (a future bug where a
 * recursive consumer reads `pool[index]` instead of just the
 * returned index) will see this sentinel and the assertion in
 * `assertPoolSlotReady` will throw a clear error rather than
 * silently corrupt the serialized output.
 */
const BUILDING: unique symbol = Symbol("interner:building");
type WithBuilding<V> = V | typeof BUILDING;

/**
 * Build an interner that dedups by key identity into a flat pool,
 * returning each key's pool index.  Indices are handed out from a
 * monotonic counter and registered in `map` before `build` runs, so
 * recursive calls from inside `build` resolve to the slot we just
 * reserved (preventing infinite recursion on self-referential keys).
 *
 * Recursive consumers see the reserved index immediately but must
 * not read the pool slot until `build` returns - the slot is
 * stamped with `BUILDING` while `build` is in progress, and any
 * accidental read can be caught via `assertPoolSlotReady`.
 */
function makeInterner<K, V>(
    pool: WithBuilding<V>[],
    map: Map<K, number>,
    build: (key: K) => V,
): (key: K) => number {
    let next = 0;
    return (key: K): number => {
        let index = map.get(key);
        if (index === undefined) {
            index = next++;
            // Register the index before invoking `build` so a
            // recursive call from inside `build` for the same key
            // (or for a key whose `build` walks back to this one)
            // hits the cached index instead of recursing forever.
            // Stamp the slot with BUILDING so any accidental read
            // of the pool entry while `build` is running is
            // detectable rather than silently observing undefined.
            map.set(key, index);
            pool[index] = BUILDING;
            pool[index] = build(key);
        }
        return index;
    };
}

/** Throws if `pool[index]` is the in-progress sentinel. */
function assertPoolSlotReady<V>(
    pool: WithBuilding<V>[],
    index: number,
    where: string,
): void {
    if (pool[index] === BUILDING) {
        throw new Error(
            `internal: pool slot ${index} read while still building (${where})`,
        );
    }
}

export function grammarToJson(grammar: Grammar): GrammarJson {
    // Flat pool of unique `GrammarRuleJson`s, indexed by
    // `GrammarRule` object identity.  A rule referenced from N
    // alternations (typical with multi-key dispatch, where one rule
    // lands in several buckets) serializes once.
    const rulePool: WithBuilding<GrammarRuleJson>[] = [];
    const ruleIndexFor = makeInterner<GrammarRule, GrammarRuleJson>(
        rulePool,
        new Map(),
        (rule) => grammarRuleToJson(rule),
    );

    // Pool of alternations (arrays of `rulePool` indices), indexed
    // by `GrammarRule[]` array identity.  Slot 0 holds the top-level
    // alternation (the first thing interned below).  Two
    // `RulesPart`s that share the same `alternatives` array (from
    // named-rule sharing or the optimizer's per-input identity memo)
    // point at one entry here.
    const arrayPool: WithBuilding<GrammarRulesJson>[] = [];
    const indexFor = makeInterner<GrammarRule[], GrammarRulesJson>(
        arrayPool,
        new Map(),
        (rules) => rules.map(ruleIndexFor),
    );

    // Shared dispatch pool.  Two `RulesPart`s carrying the same
    // `DispatchModeBucket[]` identity (compiler named-rule sharing
    // round-tripped through the optimizer's per-input memo) point
    // at a single serialized entry, and the deserializer can
    // restore that in-memory identity sharing.
    const dispatches: WithBuilding<DispatchJson>[] = [];
    const dispatchIndexFor = makeInterner<DispatchModeBucket[], DispatchJson>(
        dispatches,
        new Map(),
        (d) => {
            const entries: DispatchJson = [];
            for (const m of d) {
                const tokenMap: Array<[string, number]> = [];
                for (const [token, suffixRules] of m.tokenMap) {
                    tokenMap.push([token, indexFor(suffixRules)]);
                }
                const entry: DispatchJson[number] = { tokenMap };
                if (m.spacingMode !== undefined) {
                    entry.spacingMode = m.spacingMode;
                }
                entries.push(entry);
            }
            return entries;
        },
    );

    function grammarPartToJson(p: GrammarPart): GrammarPartJson {
        switch (p.type) {
            case "string": {
                const part: StringPartJson = {
                    type: "string",
                    value: p.value,
                };
                if (p.variable !== undefined) part.variable = p.variable;
                return part;
            }
            case "wildcard":
            case "number":
                return p;
            case "rules": {
                // For both plain and dispatched parts, `index` points
                // at `p.alternatives` (the full alternation, or - in
                // a dispatched part - the fallback subset).  When
                // the alternatives are empty (typical for a
                // fully-dispatched alternation with no fallback) we
                // omit `index` entirely - the deserializer
                // substitutes a shared empty array.  This avoids
                // both an `[]` pool slot and a per-site `index`
                // field for that case.
                const part: RulePartJson = {
                    name: p.name,
                    type: "rules",
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.alternatives.length > 0) {
                    part.index = indexFor(p.alternatives);
                }
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
                if (p.dispatch !== undefined) {
                    part.dispatch = dispatchIndexFor(p.dispatch);
                }
                return part;
            }
            case "phraseSet": {
                const part: PhraseSetPartJson = {
                    type: "phraseSet",
                    matcherName: p.matcherName,
                };
                if (p.variable !== undefined) part.variable = p.variable;
                return part;
            }
        }
    }

    function grammarRuleToJson(r: GrammarRule): GrammarRuleJson {
        return {
            parts: r.parts.map(grammarPartToJson),
            value: r.value,
            spacingMode: r.spacingMode,
        };
    }

    // Intern the top-level alternation first so it lands in slot 0
    // (the deserializer's `start = json.ruleArrays[0]` contract).
    const startIndex = indexFor(grammar.alternatives);
    if (startIndex !== 0) {
        // Defensive: would only fire if a future refactor moved
        // another `indexFor` call ahead of this one.
        throw new Error(
            `internal: top-level alternation interned at index ${startIndex}, expected 0`,
        );
    }
    // After all interning is complete every slot has been filled by
    // its `build`; assert none is still stamped with the BUILDING
    // sentinel before downcasting.  Catches the same future-bug
    // class that `assertPoolSlotReady` covers, applied as a
    // post-condition over the whole pool.
    for (let i = 0; i < rulePool.length; i++) {
        assertPoolSlotReady(rulePool, i, `rulePool[${i}]`);
    }
    for (let i = 0; i < arrayPool.length; i++) {
        assertPoolSlotReady(arrayPool, i, `arrayPool[${i}]`);
    }
    for (let i = 0; i < dispatches.length; i++) {
        assertPoolSlotReady(dispatches, i, `dispatches[${i}]`);
    }
    const out: GrammarJson = {
        rules: rulePool as GrammarRuleJson[],
        ruleArrays: arrayPool as GrammarRulesJson[],
    };
    if (grammar.dispatch !== undefined) {
        out.dispatch = dispatchIndexFor(grammar.dispatch);
    }
    if (dispatches.length > 0) {
        out.dispatches = dispatches as DispatchJson[];
    }
    return out;
}
