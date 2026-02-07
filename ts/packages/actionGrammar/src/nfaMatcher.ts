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
 * Tokenize a request string into an array of tokens
 * Simple whitespace-based tokenization for NFA matching
 * Strips trailing punctuation from tokens for better matching
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
    // Tokenize the request
    const tokens = tokenizeRequest(request);

    debug(`Tokenized: [${tokens.join(", ")}] (${tokens.length} tokens)`);

    if (tokens.length === 0) {
        return [];
    }

    // Match against NFA
    const nfaResult = matchNFA(nfa, tokens);

    debug(`Match result: ${nfaResult.matched ? "MATCHED" : "NO MATCH"}`);
    if (nfaResult.matched) {
        debug(`Action value: %O`, nfaResult.actionValue);
    }

    if (!nfaResult.matched) {
        return [];
    }

    // The action object is already evaluated in the NFA interpreter using the slot-based
    // environment system. nfaResult.actionValue contains the final computed action object.
    const actionObject = nfaResult.actionValue ?? request;

    // Wildcard character count is approximated from unchecked wildcard count
    // (each unchecked wildcard captures some characters)
    const wildcardCharCount = nfaResult.uncheckedWildcardCount;

    // Determine entity wildcard property names
    const entityWildcardPropertyNames: string[] = [];
    // TODO: Implement entity wildcard detection if needed

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
