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

export function grammarToJson(grammar: Grammar): GrammarJson {
    const json: GrammarRulesJson[] = [];
    const rulesToIndex: Map<GrammarRule[], number> = new Map();
    let nextIndex = 1;

    function indexFor(rules: GrammarRule[]): number {
        let index = rulesToIndex.get(rules);
        if (index === undefined) {
            index = nextIndex++;
            rulesToIndex.set(rules, index);
            json[index] = rules.map(grammarRuleToJson);
        }
        return index;
    }

    // Shared dispatch pool.  Two `RulesPart`s carrying the same
    // `DispatchModeBucket[]` identity (compiler named-rule sharing
    // round-tripped through the optimizer's per-input memo) point
    // at a single serialized entry, and the deserializer can
    // restore that in-memory identity sharing.
    const dispatches: DispatchJson[] = [];
    const dispatchToIndex: Map<DispatchModeBucket[], number> = new Map();
    function dispatchIndexFor(d: DispatchModeBucket[]): number {
        let index = dispatchToIndex.get(d);
        if (index === undefined) {
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
            index = dispatches.length;
            dispatches.push(entries);
            dispatchToIndex.set(d, index);
        }
        return index;
    }

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

    rulesToIndex.set(grammar.alternatives, 0);
    json[0] = grammar.alternatives.map(grammarRuleToJson);
    const out: GrammarJson = { rules: json };
    if (grammar.dispatch !== undefined) {
        out.dispatch = dispatchIndexFor(grammar.dispatch);
    }
    if (dispatches.length > 0) {
        out.dispatches = dispatches;
    }
    return out;
}
