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
    DispatchPart,
} from "./grammarTypes.js";
import { validateTailRulesParts } from "./grammarOptimizer.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:grammar:deserializer");

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
            case "dispatch": {
                const perMode: DispatchPart["perMode"] = [];
                let totalTokenKeys = 0;
                for (const m of p.perMode) {
                    const tokenMap = new Map<string, GrammarRule[]>();
                    for (const [token, idx] of m.tokenMap) {
                        let rules = indexToRules.get(idx);
                        if (rules === undefined) {
                            rules = [];
                            indexToRules.set(idx, rules);
                            for (const r of json[idx]) {
                                rules.push(grammarRuleFromJson(r, json));
                            }
                        }
                        tokenMap.set(token, rules);
                    }
                    totalTokenKeys += tokenMap.size;
                    perMode.push({ spacingMode: m.spacingMode, tokenMap });
                }
                const part: DispatchPart = {
                    type: "dispatch",
                    perMode,
                };
                if (p.name !== undefined) part.name = p.name;
                if (p.variable !== undefined) part.variable = p.variable;
                if (p.fallbackIndex !== undefined) {
                    let rules = indexToRules.get(p.fallbackIndex);
                    if (rules === undefined) {
                        rules = [];
                        indexToRules.set(p.fallbackIndex, rules);
                        for (const r of json[p.fallbackIndex]) {
                            rules.push(grammarRuleFromJson(r, json));
                        }
                    }
                    part.fallback = rules;
                }
                if (p.optional) part.optional = true;
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
                // Non-canonical shape advisories.  Both shapes are
                // semantically valid - the matcher handles them
                // correctly - but neither one is something the
                // optimizer would ever emit, so they almost certainly
                // indicate a hand-written or buggy producer:
                //
                //   - Total token-key count == 0 (every perMode
                //     entry's tokenMap is empty, or perMode itself
                //     is empty): the dispatch only ever yields
                //     fallback hits (or always fails when fallback
                //     is empty too), so it adds a peek + hash miss
                //     for no benefit over a plain `RulesPart` over
                //     `fallback`.
                //   - Total token-key count == 1 with no fallback:
                //     the dispatch always picks the same bucket,
                //     adding a peek + hash lookup for no filtering
                //     benefit over the original `RulesPart`.
                //
                // Log via `debug` so the producer can spot the issue
                // without breaking otherwise-correct grammars.
                if (totalTokenKeys === 0) {
                    debug(
                        `non-canonical DispatchPart: empty perMode (name='${p.name ?? "<unnamed>"}')`,
                    );
                } else if (
                    totalTokenKeys === 1 &&
                    (part.fallback === undefined || part.fallback.length === 0)
                ) {
                    debug(
                        `non-canonical DispatchPart: single-bucket with no fallback (name='${p.name ?? "<unnamed>"}')`,
                    );
                }
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
