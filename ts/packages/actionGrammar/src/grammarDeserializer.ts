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
    PhraseSetPart,
    RulesPart,
} from "./grammarTypes.js";
import { validateTailRulesParts } from "./grammarOptimizer.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:grammar:deserializer");

/**
 * Validate the structural invariants the matcher's dispatch path
 * relies on (see `RulesPart.dispatch`):
 *   - every entry's `spacingMode` is `"required"` or `undefined`
 *     (the matcher's `peek-by-separator` doesn't agree with
 *     `"none"` / `"optional"` mode keys);
 *   - entries have distinct `spacingMode` values (the matcher
 *     stops after collecting two hits and assumes one entry per
 *     mode).
 *
 * Throws on the first violation.  `where` describes the location
 * for the error message (e.g. `"top-level"` or
 * `"RulesPart name='Foo'"`).
 */
function validateDispatchInvariants(
    dispatch: ReadonlyArray<{ spacingMode?: unknown }>,
    where: string,
): void {
    const seen = new Set<unknown>();
    for (const m of dispatch) {
        const mode = m.spacingMode;
        if (mode !== undefined && mode !== "required") {
            throw new Error(
                `Invalid dispatch ${where}: spacingMode must be 'required' or undefined (got '${String(mode)}')`,
            );
        }
        if (seen.has(mode)) {
            throw new Error(
                `Invalid dispatch ${where}: duplicate spacingMode entry ('${mode === undefined ? "auto" : String(mode)}')`,
            );
        }
        seen.add(mode);
    }
}

function grammarFromJsonInternal(json: GrammarJson): Grammar {
    const start = json.rules[0];
    const indexToRules: Map<number, GrammarRule[]> = new Map();
    // Shared sentinel returned for `RulesPart`s whose serialized
    // form omits `index` (the empty-alternatives case - typically
    // a fully-dispatched part with no fallback).  One per grammar
    // load; the matcher only iterates `alternatives`, so sharing
    // is safe.  Frozen so an accidental `push` from downstream code
    // would throw rather than silently corrupting every
    // empty-fallback `RulesPart` in the loaded grammar.
    const emptyRules: GrammarRule[] = Object.freeze(
        [] as GrammarRule[],
    ) as GrammarRule[];
    function rulesFor(idx: number): GrammarRule[] {
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
    /**
     * Decode a single dispatch entry array into in-memory
     * `DispatchModeBucket[]`, validate its invariants, and emit
     * `debug` advisories for non-canonical shapes (empty dispatch
     * or single-bucket with no fallback).  Both shapes are
     * semantically valid - the matcher handles them correctly -
     * but neither one is something the optimizer would ever emit,
     * so they almost certainly indicate a hand-written or buggy
     * producer.
     */
    function decodeDispatchEntry(
        jsonDispatch: DispatchJson,
        fallbackLength: number,
        whereTag: string,
        nameTag: string,
    ): DispatchModeBucket[] {
        validateDispatchInvariants(jsonDispatch, whereTag);
        const dispatch: DispatchModeBucket[] = [];
        let totalTokenKeys = 0;
        for (const m of jsonDispatch) {
            const tokenMap = new Map<string, GrammarRule[]>();
            for (const [token, idx] of m.tokenMap) {
                tokenMap.set(token, rulesFor(idx));
            }
            totalTokenKeys += tokenMap.size;
            dispatch.push({ spacingMode: m.spacingMode, tokenMap });
        }
        if (totalTokenKeys === 0) {
            debug(`non-canonical ${nameTag}: empty dispatch`);
        } else if (totalTokenKeys === 1 && fallbackLength === 0) {
            debug(`non-canonical ${nameTag}: single-bucket with no fallback`);
        }
        return dispatch;
    }
    /**
     * Memoize decoded dispatch tables by their `dispatches` pool
     * index so two `RulesPart`s (or the top-level + a part) that
     * pointed at the same pool entry restore to the same
     * in-memory `DispatchModeBucket[]` identity.  Mirrors the
     * `rulesFor` mechanism for shared rule arrays - preserves the
     * optimizer's per-input-identity sharing across a
     * serialize/deserialize round trip.
     */
    const indexToDispatch: Map<number, DispatchModeBucket[]> = new Map();
    function dispatchFor(
        idx: number,
        fallbackLength: number,
        whereTag: string,
        nameTag: string,
    ): DispatchModeBucket[] {
        const cached = indexToDispatch.get(idx);
        if (cached !== undefined) return cached;
        if (json.dispatches === undefined || idx >= json.dispatches.length) {
            throw new Error(
                `Invalid grammar JSON: dispatch index ${idx} out of range (${whereTag})`,
            );
        }
        const decoded = decodeDispatchEntry(
            json.dispatches[idx],
            fallbackLength,
            whereTag,
            nameTag,
        );
        indexToDispatch.set(idx, decoded);
        return decoded;
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
                // A `tailCall` part with no `index` AND no
                // `dispatch` has zero effective members - it can
                // never satisfy `validateTailRulesParts`'s
                // >= 2-member requirement, and the compiler /
                // optimizer never emit this shape.  Catch it at
                // load time rather than as a confusing match-time
                // failure on the shared `emptyRules` sentinel.
                // (A fully-dispatched tail with no fallback is
                // legitimate: the dispatch table holds the members
                // and `index` is omitted.)
                if (
                    p.tailCall &&
                    p.index === undefined &&
                    p.dispatch === undefined
                ) {
                    throw new Error(
                        `Invalid grammar JSON: tailCall RulesPart (name='${p.name ?? "<unnamed>"}') has no 'index' and no 'dispatch'`,
                    );
                }
                const rules =
                    p.index === undefined ? emptyRules : rulesFor(p.index);
                const part: RulesPart = {
                    type: "rules",
                    name: p.name,
                    alternatives: rules,
                    variable: p.variable,
                    optional: p.optional,
                };
                if (p.repeat) part.repeat = true;
                if (p.tailCall) part.tailCall = true;
                if (p.dispatch !== undefined) {
                    const tag = `dispatched RulesPart (name='${p.name ?? "<unnamed>"}')`;
                    part.dispatch = dispatchFor(
                        p.dispatch,
                        rules.length,
                        `RulesPart name='${p.name ?? "<unnamed>"}'`,
                        tag,
                    );
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
        alternatives: start.map((r) => grammarRuleFromJson(r, json)),
    };
    if (json.dispatch !== undefined) {
        grammar.dispatch = dispatchFor(
            json.dispatch,
            grammar.alternatives.length,
            "top-level",
            "top-level dispatch",
        );
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
        validateTailRulesParts(grammar.alternatives, grammar.dispatch);
    }
    return grammar;
}
