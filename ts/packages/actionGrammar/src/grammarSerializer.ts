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
