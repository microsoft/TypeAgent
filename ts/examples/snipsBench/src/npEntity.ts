// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { globalEntityRegistry } from "action-grammar";
import { isContentWord } from "./pos.js";

/**
 * Register an `NP` wildcard type on the action-grammar global registry.
 *
 * A wildcard `$(x:NP)` compiles to the same greedy self-loop as the bare
 * `$(x:wildcard)` (consume 1+ tokens), but every looped token is validated by
 * this entity. Because we accept only content (open-class) tokens, the greedy
 * capture halts at the first function word — giving an *unbounded*,
 * noun-phrase-bounded slot span without any literal anchor following it.
 *
 * The interpreter also probes a capped (≤4-token) whole-span path before the
 * self-loop; `validate` must therefore accept both a single token and a
 * space-joined multi-token span. Both reduce to "every token is content".
 *
 * `convert` returns the span text unchanged so the captured slot value matches
 * what a bare wildcard would produce — the *only* difference between the two
 * arms of the experiment is where the span stops.
 */
function isNounPhrase(span: string): boolean {
    const tokens = span.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every(isContentWord);
}

/**
 * A single-token number — digits OR an English cardinal word. Unlike the
 * built-in `number` type (digits only, and it *converts*), `Num` keeps the
 * original surface text so span recovery can still locate it. SNIPS party
 * sizes and ratings are frequently word-numbers ("one", "sixteen").
 */
const NUMBER_WORDS: ReadonlySet<string> = new Set([
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
]);
const DIGITS = /^\d+$/;

function isNum(token: string): boolean {
    const t = token.toLowerCase();
    return DIGITS.test(t) || NUMBER_WORDS.has(t);
}

let registered = false;

export function registerNPEntity(): void {
    if (registered) return;
    globalEntityRegistry.registerConverter<string>("NP", {
        validate: isNounPhrase,
        convert: (span: string) => (isNounPhrase(span) ? span : undefined),
    });
    globalEntityRegistry.registerConverter<string>("Num", {
        // single-token only: reject any multi-token span the interpreter probes
        validate: (token: string) => !token.includes(" ") && isNum(token),
        convert: (token: string) => (isNum(token) ? token : undefined),
    });
    registered = true;
}
