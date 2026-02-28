// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { Grammar } from "./grammarTypes.js";
import { NFA } from "./nfa.js";
import { matchNFA } from "./nfaInterpreter.js";

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

/**
 * Match a request string against a grammar using NFA
 *
 * The grammar rule itself is expected to account for all tokens in the request,
 * using optional built-in categories ((<Polite>)?, (<FillerWord>)?, etc.) for
 * leading/trailing courtesy words and hesitations.
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

    const nfaResult = matchNFA(nfa, tokens);
    if (!nfaResult.matched) {
        debug(`Match result: NO MATCH`);
        return [];
    }

    debug(`Match result: MATCHED`);
    debug(`Action value: %O`, nfaResult.actionValue);

    const actionObject = nfaResult.actionValue ?? request;
    const wildcardCharCount = nfaResult.uncheckedWildcardCount;
    const entityWildcardPropertyNames: string[] = [];

    return [
        {
            match: actionObject,
            matchedValueCount:
                nfaResult.fixedStringPartCount +
                nfaResult.checkedWildcardCount +
                nfaResult.uncheckedWildcardCount,
            wildcardCharCount,
            entityWildcardPropertyNames,
        },
    ];
}
