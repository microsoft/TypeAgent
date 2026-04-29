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
 * Build an interner that dedups by key identity into a flat pool,
 * returning each key's pool index.  Indices are handed out from a
 * monotonic counter and registered in `map` before `build` runs, so
 * recursive calls from inside `build` resolve to the slot we just
 * reserved (preventing infinite recursion on self-referential keys).
 */
function makeInterner<K, V>(
    pool: V[],
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
            // The pool slot is filled in after `build` returns;
            // recursive consumers only read `map`, never `pool`.
            map.set(key, index);
            pool[index] = build(key);
        }
        return index;
    };
}

export function grammarToJson(grammar: Grammar): GrammarJson {
    // Flat pool of unique `GrammarRuleJson`s, indexed by
    // `GrammarRule` object identity.  A rule referenced from N
    // alternations (typical with multi-key dispatch, where one rule
    // lands in several buckets) serializes once.
    const rulePool: GrammarRuleJson[] = [];
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
    const arrayPool: GrammarRulesJson[] = [];
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
    const dispatches: DispatchJson[] = [];
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
    indexFor(grammar.alternatives);
    const out: GrammarJson = { rules: rulePool, ruleArrays: arrayPool };
    if (grammar.dispatch !== undefined) {
        out.dispatch = dispatchIndexFor(grammar.dispatch);
    }
    if (dispatches.length > 0) {
        out.dispatches = dispatches;
    }
    return out;
}
