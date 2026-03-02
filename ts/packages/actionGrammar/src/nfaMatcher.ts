// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { Grammar } from "./grammarTypes.js";
import { NFA } from "./nfa.js";
import { matchNFA, sortNFAMatches } from "./nfaInterpreter.js";

const debug = registerDebug("typeagent:actionGrammar:nfaMatcher");

/**
 * NFA-based Grammar Matcher
 *
 * High-level API for matching request strings against compiled grammars using NFA.
 * This module bridges the NFA interpreter with the Grammar structure to produce
 * action objects compatible with the existing grammar matching system.
 */

/**
 * Match result compatible with the old grammar matcher format
 */
export interface NFAGrammarMatchResult {
    match: unknown; // The action object with actionName and parameters
    matchedValueCount: number;
    wildcardCharCount: number;
    entityWildcardPropertyNames: string[];
}

/**
 * Strip trailing punctuation from a token (linear time)
 */
function stripTrailingPunctuation(token: string): string {
    const punctuation = "?!.,;:";
    let end = token.length;
    while (end > 0 && punctuation.includes(token[end - 1])) {
        end--;
    }
    return end === token.length ? token : token.slice(0, end);
}

/**
 * Normalize a single token for NFA matching: lowercase and strip trailing
 * punctuation.  Applied to both input tokens and grammar tokens so that both
 * sides of the comparison are on the same canonical form.
 */
export function normalizeToken(token: string): string {
    return stripTrailingPunctuation(token.toLowerCase());
}

/**
 * Tokenize a request string into an array of tokens.
 * Splits on whitespace and strips trailing punctuation, but preserves
 * original case so that wildcard captures retain the user's casing.
 * Normalization (lowercasing) for fixed-token comparisons is done
 * separately at match time via normalizeToken().
 */
export function tokenizeRequest(request: string): string[] {
    return request
        .trim()
        .split(/\s+/)
        .map(stripTrailingPunctuation)
        .filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------
// Token pre-splitting for optional/auto spacing mode
// ---------------------------------------------------------------------------

/**
 * Collect all split candidates stored on NFA rule entry states.
 * Only states from optional/auto rules carry splitCandidates (set by the
 * compiler).  Returns candidates sorted longest-first, ready for greedy scan.
 */
function collectNFASplitCandidates(nfa: NFA): string[] {
    const candidates = new Set<string>();
    for (const state of nfa.states) {
        if (state.splitCandidates) {
            for (const c of state.splitCandidates) {
                candidates.add(c);
            }
        }
    }
    return Array.from(candidates).sort((a, b) => b.length - a.length);
}

/**
 * Try to split a single whitespace-tokenized token using a list of split
 * candidates (sorted longest-first).  Uses greedy left-to-right scanning:
 * at each position, tries every candidate as a prefix; if none matches,
 * advances one character.  Unmatched characters are emitted as a residual
 * segment between matched candidates.
 *
 * Examples:
 *   "Swift's"  + ["'s"] → ["Swift", "'s"]
 *   "黃色汽車" + ["黃色","汽車"] → ["黃色", "汽車"]
 *   "don't"    + ["'t"] → ["don", "'t"]
 *   "play"     + ["'s"] → ["play"]  (no change — returned as single element)
 */
function splitToken(token: string, candidates: string[]): string[] {
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
 * when nothing changed (avoids an extra NFA run when there is nothing to do).
 */
function applySplitToTokens(
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a request string against a grammar using NFA
 *
 * Two-pass strategy for spacing modes:
 *   Pass 1 — original whitespace tokens: correct for spacing=required rules.
 *   Pass 2 — pre-split tokens (only when the NFA has optional/auto rules with
 *             split candidates): handles fused tokens like "Swift's" or "黃色汽車".
 * The higher-priority result across both passes is returned.
 *
 * @param _grammar The grammar structure (unused, kept for API compatibility)
 * @param nfa The compiled NFA
 * @param request The request string to match
 * @returns Array of grammar match results, sorted by priority
 */
export function matchGrammarWithNFA(
    _grammar: Grammar,
    nfa: NFA,
    request: string,
): NFAGrammarMatchResult[] {
    const tokens = tokenizeRequest(request);

    debug(`Tokenized: [${tokens.join(", ")}] (${tokens.length} tokens)`);

    if (tokens.length === 0) {
        return [];
    }

    // Pass 1: original token array (handles spacing=required correctly)
    const origResult = matchNFA(nfa, tokens);

    // Pass 2: pre-split fused tokens for optional/auto rules
    let bestResult = origResult;
    const splitCandidates = collectNFASplitCandidates(nfa);
    const splitTokens = applySplitToTokens(tokens, splitCandidates);
    if (splitTokens !== null) {
        debug(
            `Split tokens: [${splitTokens.join(", ")}] (${splitTokens.length} tokens)`,
        );
        const splitResult = matchNFA(nfa, splitTokens);
        if (splitResult.matched) {
            if (!origResult.matched) {
                bestResult = splitResult;
            } else {
                [bestResult] = sortNFAMatches([origResult, splitResult]);
            }
        }
    }

    if (!bestResult.matched) {
        debug(`Match result: NO MATCH`);
        return [];
    }

    debug(`Match result: MATCHED`);
    debug(`Action value: %O`, bestResult.actionValue);

    const actionObject = bestResult.actionValue ?? request;
    const wildcardCharCount = bestResult.uncheckedWildcardCount;
    const entityWildcardPropertyNames: string[] = [];

    return [
        {
            match: actionObject,
            matchedValueCount:
                bestResult.fixedStringPartCount +
                bestResult.checkedWildcardCount +
                bestResult.uncheckedWildcardCount,
            wildcardCharCount,
            entityWildcardPropertyNames,
        },
    ];
}
