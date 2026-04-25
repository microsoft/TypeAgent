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

function grammarFromJsonInternal(json: GrammarJson): Grammar {
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
 * any tail `RulesPart` it carries.  Cost is dominated by tree size,
 * not the presence of tail parts, so validation is on by default for
 * every load - cached/untrusted JSON surfaces contract violations as
 * a clear `Error` at load time rather than as confusing match
 * failures or NFA-compile crashes downstream.
 *
 * Trusted producers (the in-process compiler emitting JSON it just
 * built) can opt out by passing `validate: false` to skip the walk.
 */
export function grammarFromJson(
    json: GrammarJson,
    options?: { validate?: boolean },
): Grammar {
    const grammar = grammarFromJsonInternal(json);
    if (options?.validate !== false) {
        validateTailRulesParts(grammar.rules);
    }
    return grammar;
}
