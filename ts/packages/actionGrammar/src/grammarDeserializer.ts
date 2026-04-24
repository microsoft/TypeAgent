// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarJson,
    GrammarPart,
    GrammarPartJson,
    GrammarRule,
    GrammarRuleJson,
    PhraseSetPart,
    RulesPart,
} from "./grammarTypes.js";

export function grammarFromJson(json: GrammarJson): Grammar {
    const start = json[0];
    const indexToRules: Map<number, GrammarRule[]> = new Map();
    function grammarRuleFromJson(r: GrammarRuleJson, json: GrammarJson) {
        return {
            parts: r.parts.map((p) => grammarPartFromJson(p, json)),
            value: r.value,
            spacingMode: r.spacingMode,
        };
    }
    function grammarPartFromJson(
        p: GrammarPartJson,
        json: GrammarJson,
    ): GrammarPart {
        switch (p.type) {
            case "string":
            case "wildcard":
            case "number":
                return p;
            case "rules": {
                let rules = indexToRules.get(p.index);
                if (rules === undefined) {
                    rules = [];
                    indexToRules.set(p.index, rules);
                    for (const r of json[p.index]) {
                        rules.push(grammarRuleFromJson(r, json));
                    }
                }
                const part: RulesPart = {
                    type: "rules",
                    name: p.name,
                    rules,
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                return part;
            }
            case "phraseSet": {
                const part: PhraseSetPart = {
                    type: "phraseSet",
                    matcherName: p.matcherName,
                };
                if (p.variable !== undefined) part.variable = p.variable;
                return part;
            }
        }
    }

    return {
        rules: start.map((r) => grammarRuleFromJson(r, json)),
    };
}
