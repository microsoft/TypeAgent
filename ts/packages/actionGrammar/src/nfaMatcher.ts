// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar } from "./grammarTypes.js";
import { NFA } from "./nfa.js";
import { matchNFA } from "./nfaInterpreter.js";
import { ValueNode } from "./grammarRuleParser.js";

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
 * Tokenize a request string into an array of tokens
 * Simple whitespace-based tokenization for NFA matching
 */
export function tokenizeRequest(request: string): string[] {
    return request
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0);
}

/**
 * Match a request string against a grammar using NFA
 *
 * @param grammar The grammar structure (for rule values)
 * @param nfa The compiled NFA
 * @param request The request string to match
 * @returns Array of grammar match results, sorted by priority
 */
export function matchGrammarWithNFA(
    grammar: Grammar,
    nfa: NFA,
    request: string,
): NFAGrammarMatchResult[] {
    // Tokenize the request
    const tokens = tokenizeRequest(request);

    if (tokens.length === 0) {
        return [];
    }

    // Match against NFA
    const nfaResult = matchNFA(nfa, tokens);

    if (!nfaResult.matched) {
        return [];
    }

    // Build the action object from the match result
    // The actionValue has been propagated through epsilon transitions during matching
    // For single-term rules without explicit values, this will be the nested term's value
    const actionValue = nfaResult.actionValue;
    let actionObject: unknown;

    if (actionValue === undefined) {
        // No action value was found during matching
        // This should only happen if the grammar has an error
        // (e.g., a multi-term rule without a value expression that wasn't caught during compilation)
        // Return the matched request text as a fallback
        actionObject = request;
    } else {
        // Build action object from the rule's value expression
        actionObject = buildValueFromNode(actionValue, nfaResult.captures);
    }

    // Calculate wildcard character count (approximate)
    const wildcardCharCount = calculateWildcardCharCount(
        nfaResult.captures,
        tokens,
    );

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

/**
 * Build a value from a ValueNode, substituting variables with captured values
 */
function buildValueFromNode(
    node: ValueNode,
    captures: Map<string, string | number>,
): unknown {
    switch (node.type) {
        case "object":
            const obj: Record<string, unknown> = {};
            for (const [key, propNode] of Object.entries(node.value)) {
                obj[key] = buildValueFromNode(propNode, captures);
            }
            return obj;

        case "array":
            return node.value.map((elem) =>
                buildValueFromNode(elem, captures),
            );

        case "variable":
            // Look up captured value
            if (node.name && captures.has(node.name)) {
                return captures.get(node.name);
            }
            // Variable not captured - return undefined or the variable name
            return undefined;

        case "literal":
            // Literal can be string, number, boolean, or null
            return node.value;

        default:
            return undefined;
    }
}

/**
 * Calculate approximate wildcard character count from captures
 */
function calculateWildcardCharCount(
    captures: Map<string, string | number>,
    tokens: string[],
): number {
    let charCount = 0;
    for (const value of captures.values()) {
        if (typeof value === "string") {
            charCount += value.length;
        } else if (typeof value === "number") {
            charCount += value.toString().length;
        }
    }
    return charCount;
}
