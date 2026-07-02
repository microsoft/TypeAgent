// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    loadGrammarRulesNoThrow,
    compileGrammarToNFA,
    matchNFA,
    registerBuiltInEntities,
} from "@typeagent/action-grammar";
import { SlotSpan, spansToTags } from "./data.js";
import { Prediction } from "./score.js";
import { registerNPEntity } from "./npEntity.js";

let entitiesReady = false;
function ensureEntities(): void {
    if (entitiesReady) return;
    registerBuiltInEntities();
    registerNPEntity();
    entitiesReady = true;
}

/** A compiled, ready-to-match intent grammar. */
export interface CompiledGrammar {
    intent: string;
    nfa: ReturnType<typeof compileGrammarToNFA>;
}

export function compile(
    intent: string,
    grammarText: string,
    name: string,
): CompiledGrammar {
    ensureEntities();
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(`${name}.agr`, grammarText, errors);
    if (!grammar || errors.length > 0) {
        throw new Error(
            `grammar "${name}" failed to load:\n${errors.join("\n")}`,
        );
    }
    return { intent, nfa: compileGrammarToNFA(grammar, name) };
}

/**
 * Find the leftmost run of `needle` tokens in `tokens` whose positions are all
 * unclaimed. Returns the start index, or -1.
 */
function findContig(
    tokens: string[],
    needle: string[],
    claimed: boolean[],
): number {
    if (needle.length === 0) return -1;
    outer: for (let i = 0; i + needle.length <= tokens.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (claimed[i + j] || tokens[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

/**
 * Recover token spans for captured slot values. Each value is a contiguous run
 * of input tokens (greedy wildcard capture joins with single spaces). We assign
 * each slot its leftmost unclaimed occurrence, processing slots in sentence
 * order so adjacent slots don't fight over the same tokens.
 */
export function recoverSpans(
    tokens: string[],
    slots: { label: string; value: string }[],
): SlotSpan[] {
    const claimed = new Array(tokens.length).fill(false);
    const pending = slots
        .map((s) => ({
            label: s.label,
            needle: String(s.value).trim().split(/\s+/).filter(Boolean),
        }))
        .filter((s) => s.needle.length > 0);

    const spans: SlotSpan[] = [];
    while (pending.length > 0) {
        let bestIdx = -1;
        let bestPos = Infinity;
        for (let k = 0; k < pending.length; k++) {
            const pos = findContig(tokens, pending[k].needle, claimed);
            if (pos >= 0 && pos < bestPos) {
                bestPos = pos;
                bestIdx = k;
            }
        }
        if (bestIdx === -1) break; // remaining values not locatable
        const { label, needle } = pending.splice(bestIdx, 1)[0];
        for (let j = 0; j < needle.length; j++) claimed[bestPos + j] = true;
        spans.push({ label, start: bestPos, end: bestPos + needle.length });
    }
    return spans;
}

/** Pull {label,value} slot pairs out of an action value's `parameters`. */
function slotsFromAction(action: unknown): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    if (action && typeof action === "object" && "parameters" in action) {
        const params = (action as { parameters?: Record<string, unknown> })
            .parameters;
        if (params) {
            for (const [label, value] of Object.entries(params)) {
                if (value === undefined || value === null) continue;
                out.push({ label, value: String(value) });
            }
        }
    }
    return out;
}

export interface RunResult extends Prediction {
    matched: boolean;
    action?: unknown;
}

/**
 * Match one example against a set of candidate intent grammars. The grammar
 * whose match consumes the most tokens (best coverage, tie-broken by more
 * verified parts) wins; its action yields the predicted intent + slot spans.
 * No match → empty prediction (intent "", all-O tags).
 */
export function runExample(
    tokens: string[],
    grammars: CompiledGrammar[],
    fallbackIntent: string,
): RunResult {
    let best:
        | { g: CompiledGrammar; res: ReturnType<typeof matchNFA> }
        | undefined;
    for (const g of grammars) {
        const res = matchNFA(g.nfa, tokens);
        if (!res.matched) continue;
        if (
            !best ||
            (res.tokensConsumed ?? 0) > (best.res.tokensConsumed ?? 0) ||
            ((res.tokensConsumed ?? 0) === (best.res.tokensConsumed ?? 0) &&
                res.fixedStringPartCount > best.res.fixedStringPartCount)
        ) {
            best = { g, res };
        }
    }

    if (!best) {
        return {
            matched: false,
            intent: fallbackIntent,
            tags: tokens.map(() => "O"),
        };
    }

    const slots = slotsFromAction(best.res.actionValue);
    const spans = recoverSpans(tokens, slots);
    return {
        matched: true,
        intent: best.g.intent,
        tags: spansToTags(spans, tokens.length),
        action: best.res.actionValue,
    };
}
