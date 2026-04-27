// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatchModeBucket,
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
import registerDebug from "debug";

const debug = registerDebug("typeagent:grammar:deserializer");

function grammarFromJsonInternal(json: GrammarJson): Grammar {
    const start = json.rules[0];
    const indexToRules: Map<number, GrammarRule[]> = new Map();
    function rulesFor(idx: number, json: GrammarJson): GrammarRule[] {
        let rules = indexToRules.get(idx);
        if (rules === undefined) {
            rules = [];
            indexToRules.set(idx, rules);
            for (const r of json.rules[idx]) {
                rules.push(grammarRuleFromJson(r, json));
            }
        }
        return rules;
    }
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
                const rules = rulesFor(p.index, json);
                const part: RulesPart = {
                    type: "rules",
                    name: p.name,
                    rules,
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
                if (p.dispatch !== undefined) {
                    const dispatch: DispatchModeBucket[] = [];
                    let totalTokenKeys = 0;
                    for (const m of p.dispatch) {
                        const tokenMap = new Map<string, GrammarRule[]>();
                        for (const [token, idx] of m.tokenMap) {
                            tokenMap.set(token, rulesFor(idx, json));
                        }
                        totalTokenKeys += tokenMap.size;
                        dispatch.push({
                            spacingMode: m.spacingMode,
                            tokenMap,
                        });
                    }
                    part.dispatch = dispatch;
                    // Non-canonical shape advisories.  Both shapes
                    // are semantically valid - the matcher handles
                    // them correctly - but neither one is something
                    // the optimizer would ever emit, so they almost
                    // certainly indicate a hand-written or buggy
                    // producer:
                    //
                    //   - Total token-key count == 0 (every
                    //     dispatch entry's tokenMap is empty, or
                    //     the dispatch array itself is empty): the
                    //     dispatch only ever yields fallback hits
                    //     (or always fails when `rules` is empty
                    //     too), so it adds a peek + hash miss for
                    //     no benefit over the non-dispatched form.
                    //   - Total token-key count == 1 with no
                    //     fallback (`rules` empty): the dispatch
                    //     always picks the same bucket, adding a
                    //     peek + hash lookup for no filtering
                    //     benefit over the non-dispatched form.
                    //
                    // Log via `debug` so the producer can spot the
                    // issue without breaking otherwise-correct
                    // grammars.
                    if (totalTokenKeys === 0) {
                        debug(
                            `non-canonical dispatched RulesPart: empty dispatch (name='${p.name ?? "<unnamed>"}')`,
                        );
                    } else if (
                        totalTokenKeys === 1 &&
                        rules.length === 0
                    ) {
                        debug(
                            `non-canonical dispatched RulesPart: single-bucket with no fallback (name='${p.name ?? "<unnamed>"}')`,
                        );
                    }
                }
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

    const grammar: Grammar = {
        rules: start.map((r) => grammarRuleFromJson(r, json)),
    };
    if (json.dispatch !== undefined) {
        const dispatch: DispatchModeBucket[] = [];
        let totalTokenKeys = 0;
        for (const m of json.dispatch) {
            const tokenMap = new Map<string, GrammarRule[]>();
            for (const [token, idx] of m.tokenMap) {
                tokenMap.set(token, rulesFor(idx, json));
            }
            totalTokenKeys += tokenMap.size;
            dispatch.push({ spacingMode: m.spacingMode, tokenMap });
        }
        grammar.dispatch = dispatch;
        // Same non-canonical-shape advisories as the part-level
        // dispatched RulesPart deserializer above.
        if (totalTokenKeys === 0) {
            debug(`non-canonical top-level dispatch: empty dispatch`);
        } else if (totalTokenKeys === 1 && grammar.rules.length === 0) {
            debug(
                `non-canonical top-level dispatch: single-bucket with no fallback`,
            );
        }
    }
    return grammar;
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
        validateTailRulesParts(grammar.rules, grammar.dispatch);
    }
    return grammar;
}
