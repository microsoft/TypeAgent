// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
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
                // at `p.rules` (the full alternation, or - in a
                // dispatched part - the fallback subset; may be
                // empty, which still gets a unique slot via
                // identity-sharing).
                const part: RulePartJson = {
                    name: p.name,
                    type: "rules",
                    index: indexFor(p.alternatives),
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
                if (p.dispatch !== undefined) {
                    const dispatchJson: NonNullable<RulePartJson["dispatch"]> =
                        [];
                    for (const m of p.dispatch) {
                        const tokenMap: Array<[string, number]> = [];
                        for (const [token, suffixRules] of m.tokenMap) {
                            tokenMap.push([token, indexFor(suffixRules)]);
                        }
                        const entry: NonNullable<
                            RulePartJson["dispatch"]
                        >[number] = { tokenMap };
                        if (m.spacingMode !== undefined) {
                            entry.spacingMode = m.spacingMode;
                        }
                        dispatchJson.push(entry);
                    }
                    part.dispatch = dispatchJson;
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
    if (grammar.dispatch === undefined) {
        return { rules: json };
    }
    const dispatchJson: NonNullable<GrammarJson["dispatch"]> = [];
    for (const m of grammar.dispatch) {
        const tokenMap: Array<[string, number]> = [];
        for (const [token, suffixRules] of m.tokenMap) {
            tokenMap.push([token, indexFor(suffixRules)]);
        }
        const entry: NonNullable<GrammarJson["dispatch"]>[number] = {
            tokenMap,
        };
        if (m.spacingMode !== undefined) {
            entry.spacingMode = m.spacingMode;
        }
        dispatchJson.push(entry);
    }
    return { rules: json, dispatch: dispatchJson };
}
