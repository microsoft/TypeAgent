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
    DispatchPartJson,
} from "./grammarTypes.js";

export function grammarToJson(grammar: Grammar): GrammarJson {
    const json: GrammarRulesJson[] = [];
    const rulesToIndex: Map<GrammarRule[], number> = new Map();
    let nextIndex = 1;

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
                let index = rulesToIndex.get(p.rules);
                if (index === undefined) {
                    index = nextIndex++;
                    rulesToIndex.set(p.rules, index);
                    json[index] = p.rules.map(grammarRuleToJson);
                }

                const part: RulePartJson = {
                    name: p.name,
                    type: "rules",
                    index,
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
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
            case "dispatch": {
                const perMode: DispatchPartJson["perMode"] = [];
                for (const m of p.perMode) {
                    const tokenMap: Array<[string, number]> = [];
                    for (const [token, suffixRules] of m.tokenMap) {
                        let index = rulesToIndex.get(suffixRules);
                        if (index === undefined) {
                            index = nextIndex++;
                            rulesToIndex.set(suffixRules, index);
                            json[index] = suffixRules.map(grammarRuleToJson);
                        }
                        tokenMap.push([token, index]);
                    }
                    const entry: DispatchPartJson["perMode"][number] = {
                        tokenMap,
                    };
                    if (m.spacingMode !== undefined) {
                        entry.spacingMode = m.spacingMode;
                    }
                    perMode.push(entry);
                }
                const part: DispatchPartJson = {
                    type: "dispatch",
                    perMode,
                };
                if (p.name !== undefined) part.name = p.name;
                if (p.variable !== undefined) part.variable = p.variable;
                if (p.fallback !== undefined && p.fallback.length > 0) {
                    let index = rulesToIndex.get(p.fallback);
                    if (index === undefined) {
                        index = nextIndex++;
                        rulesToIndex.set(p.fallback, index);
                        json[index] = p.fallback.map(grammarRuleToJson);
                    }
                    part.fallbackIndex = index;
                }
                if (p.optional) part.optional = true;
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
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

    rulesToIndex.set(grammar.rules, 0);
    json[0] = grammar.rules.map(grammarRuleToJson);
    return json;
}
