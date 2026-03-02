// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared token-splitting utilities for NFA and DFA matchers.
 *
 * Used for two-pass matching with spacing=optional/auto grammars:
 *   Pass 1 — original whitespace-tokenised input
 *   Pass 2 — tokens pre-split on registered split candidates
 *             (e.g. "Swift's" → ["Swift", "'s"] for possessive rules,
 *              "黃色汽車" → ["黃色", "汽車"] for CJK compounds)
 */

/**
 * Split a single token at every occurrence of any candidate substring.
 *
 * Candidates are tried at each position longest-first (caller is responsible
 * for passing them sorted longest-first).  The greedy scan never back-tracks;
 * unmatched characters are collected into a residual segment and emitted when
 * the next match (or end-of-token) is reached.
 *
 * Examples:
 *   "Swift's"  + ["'s"] → ["Swift", "'s"]
 *   "黃色汽車" + ["黃色","汽車"] → ["黃色", "汽車"]
 *   "don't"    + ["'t"] → ["don", "'t"]
 *   "play"     + ["'s"] → ["play"]  (no change — returned as single element)
 */
export function splitToken(token: string, candidates: string[]): string[] {
    const result: string[] = [];
    let pos = 0;
    let segStart = 0;
    while (pos < token.length) {
        let matched = false;
        for (const candidate of candidates) {
            if (
                pos + candidate.length <= token.length &&
                token.startsWith(candidate, pos)
            ) {
                if (pos > segStart) result.push(token.slice(segStart, pos));
                result.push(candidate);
                pos += candidate.length;
                segStart = pos;
                matched = true;
                break;
            }
        }
        if (!matched) pos++;
    }
    if (segStart < token.length) result.push(token.slice(segStart));
    return result;
}

/**
 * Apply split candidates to every token in the array.
 * Returns a new (longer) array when at least one token was split, or null
 * when nothing changed (avoids an extra matcher run when there is nothing to do).
 */
export function applySplitToTokens(
    tokens: string[],
    candidates: string[],
): string[] | null {
    if (candidates.length === 0) return null;
    let anyChange = false;
    const result: string[] = [];
    for (const token of tokens) {
        const parts = splitToken(token, candidates);
        result.push(...parts);
        if (parts.length > 1) anyChange = true;
    }
    return anyChange ? result : null;
}
