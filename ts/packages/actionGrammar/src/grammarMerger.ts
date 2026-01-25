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
 * @returns A new Grammar containing both existing and new rules
 */
export function mergeGrammarRules(
    existingGrammar: Grammar,
    newRules: GrammarRule[],
): Grammar {
    // Simple merge - just concatenate the rules
    // All rules become alternatives at the top level
    const result: Grammar = {
        rules: [...existingGrammar.rules, ...newRules],
    };

    // Preserve entities from existing grammar
    if (existingGrammar.entities) {
        result.entities = [...existingGrammar.entities];
    }

    return result;
}

/**
 * Create a new grammar from rules
 *
 * @param rules Grammar rules
 * @param entities Optional entity declarations
 * @returns A new Grammar
 */
export function createGrammar(
    rules: GrammarRule[],
    entities?: string[],
): Grammar {
    const grammar: Grammar = { rules };
    if (entities && entities.length > 0) {
        grammar.entities = entities;
    }
    return grammar;
}

/**
 * Merge multiple grammars into one
 *
 * All rules from all grammars become alternatives in the merged grammar.
 * Entities from all grammars are combined.
 *
 * @param grammars Grammars to merge
 * @returns A new Grammar containing all rules
 */
export function mergeGrammars(grammars: Grammar[]): Grammar {
    const allRules: GrammarRule[] = [];
    const allEntities = new Set<string>();

    for (const grammar of grammars) {
        allRules.push(...grammar.rules);
        if (grammar.entities) {
            for (const entity of grammar.entities) {
                allEntities.add(entity);
            }
        }
    }

    const result: Grammar = {
        rules: allRules,
    };

    if (allEntities.size > 0) {
        result.entities = Array.from(allEntities);
    }

    return result;
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
