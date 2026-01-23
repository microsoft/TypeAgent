// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar, GrammarRule } from "./grammarTypes.js";

/**
 * Grammar Merger
 *
 * Merges newly generated grammar rules into existing grammars.
 * Handles combining rules with the same left-hand side (action name).
 */

/**
 * Merge new rules into an existing grammar
 *
 * Rules are simply added to the existing grammar as alternatives.
 * The grammar becomes a union of all rules.
 *
 * @param existingGrammar The existing grammar to extend
 * @param newRules Rules to merge in
 * @param moduleName Optional module name for the merged grammar
 * @returns A new Grammar containing both existing and new rules
 */
export function mergeGrammarRules(
    existingGrammar: Grammar,
    newRules: GrammarRule[],
    moduleName?: string,
): Grammar {
    // Simple merge - just concatenate the rules
    // All rules become alternatives at the top level
    return {
        rules: [...existingGrammar.rules, ...newRules],
        moduleName: moduleName ?? existingGrammar.moduleName,
    };
}

/**
 * Create a new grammar from rules
 *
 * @param rules Grammar rules
 * @param moduleName Optional module name
 * @returns A new Grammar
 */
export function createGrammar(
    rules: GrammarRule[],
    moduleName?: string,
): Grammar {
    return {
        rules,
        moduleName,
    };
}

/**
 * Merge multiple grammars into one
 *
 * All rules from all grammars become alternatives in the merged grammar.
 *
 * @param grammars Grammars to merge
 * @param moduleName Optional module name for the merged grammar
 * @returns A new Grammar containing all rules
 */
export function mergeGrammars(
    grammars: Grammar[],
    moduleName?: string,
): Grammar {
    const allRules: GrammarRule[] = [];

    for (const grammar of grammars) {
        allRules.push(...grammar.rules);
    }

    return {
        rules: allRules,
        moduleName,
    };
}

/**
 * Get statistics about a grammar
 */
export interface GrammarStats {
    ruleCount: number;
    totalParts: number;
    wildcardCount: number;
    optionalPartCount: number;
}

export function getGrammarStats(grammar: Grammar): GrammarStats {
    let totalParts = 0;
    let wildcardCount = 0;
    let optionalPartCount = 0;

    for (const rule of grammar.rules) {
        totalParts += rule.parts.length;

        for (const part of rule.parts) {
            if (part.optional) {
                optionalPartCount++;
            }
            if (part.type === "wildcard" || part.type === "number") {
                wildcardCount++;
            }
        }
    }

    return {
        ruleCount: grammar.rules.length,
        totalParts,
        wildcardCount,
        optionalPartCount,
    };
}
