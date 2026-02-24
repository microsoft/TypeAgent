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
} from "./grammarTypes.js";

export function grammarToJson(grammar: Grammar): GrammarJson {
    const json: GrammarRulesJson[] = [];
    const rulesToIndex: Map<GrammarRule[], number> = new Map();
    let nextIndex = 1;

    function grammarPartToJson(p: GrammarPart): GrammarPartJson {
        switch (p.type) {
            case "string":
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

                const part: import("./grammarTypes.js").RulePartJson = {
                    name: p.name,
                    type: "rules",
                    index,
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                return part;
            }
            case "phraseSet":
                return { type: "phraseSet", matcherName: p.matcherName };
        }
    }

    function grammarRuleToJson(r: GrammarRule): GrammarRuleJson {
        return {
            parts: r.parts.map(grammarPartToJson),
            value: r.value,
        };
    }

    rulesToIndex.set(grammar.rules, 0);
    json[0] = grammar.rules.map(grammarRuleToJson);
    return json;
}
