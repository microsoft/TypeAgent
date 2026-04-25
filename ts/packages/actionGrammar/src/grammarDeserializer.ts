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
import { validateTailRulesParts } from "./grammarOptimizer.js";

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
                if (p.tailCall) part.tailCall = true;
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

/**
 * Deserialize a `GrammarJson` and validate the structural contract on
 * any tail `RulesPart` it carries.  Untrusted JSON inputs (cached
 * grammars, hand-crafted test fixtures) should prefer this entry
 * point so contract violations surface as a clear `Error` at load
 * time rather than as confusing match failures or NFA-compile
 * crashes downstream.
 *
 * Validation is a single recursive walk; cost is dominated by tree
 * size, not the presence of tail parts.
 */
export function grammarFromJsonValidated(json: GrammarJson): Grammar {
    const grammar = grammarFromJson(json);
    validateTailRulesParts(grammar.rules);
    return grammar;
}
