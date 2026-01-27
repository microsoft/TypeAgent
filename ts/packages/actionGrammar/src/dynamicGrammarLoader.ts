// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar, GrammarPart } from "./grammarTypes.js";
import { loadGrammarRules } from "./grammarLoader.js";
import { mergeGrammarRules } from "./grammarMerger.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { NFA } from "./nfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";

/**
 * Dynamic Grammar Loader
 *
 * Loads grammar rules dynamically at runtime and merges them into
 * an existing grammar. Validates that all referenced entities are resolved.
 */

/**
 * Result of loading a dynamic grammar
 */
export interface DynamicLoadResult {
    success: boolean;
    grammar?: Grammar;
    nfa?: NFA;
    errors: string[];
    unresolvedSymbols?: string[];
}

/**
 * Dynamic grammar loader for runtime rule addition
 */
export class DynamicGrammarLoader {
    /**
     * Load grammar rules from .agr format text and merge into existing grammar
     *
     * @param agrText Grammar rules in .agr format (e.g., from grammarGenerator)
     * @param existingGrammar The existing grammar to extend
     * @param nfaName Optional name for the compiled NFA
     * @returns Load result with merged grammar and updated NFA
     */
    loadAndMerge(
        agrText: string,
        existingGrammar: Grammar,
        nfaName?: string,
    ): DynamicLoadResult {
        const errors: string[] = [];

        // Step 1: Parse the grammar rules
        const newGrammar = loadGrammarRules("<dynamic>", agrText, errors);

        if (!newGrammar) {
            return {
                success: false,
                errors: [`Failed to parse grammar: ${errors.join(", ")}`],
            };
        }

        // Step 2: Validate entity references
        const unresolvedEntities = this.validateEntityReferences(newGrammar);
        if (unresolvedEntities.length > 0) {
            return {
                success: false,
                errors: [
                    "Grammar references unresolved entities. These entities must be registered before the grammar can be loaded.",
                ],
                unresolvedSymbols: unresolvedEntities,
            };
        }

        // Step 3: Merge into existing grammar
        const mergedGrammar = mergeGrammarRules(
            existingGrammar,
            newGrammar.rules,
        );

        // Merge entity declarations
        if (newGrammar.entities) {
            const existingEntities = new Set(existingGrammar.entities || []);
            for (const entity of newGrammar.entities) {
                existingEntities.add(entity);
            }
            mergedGrammar.entities = Array.from(existingEntities);
        }

        // Step 4: Compile to NFA
        let nfa: NFA;
        try {
            nfa = compileGrammarToNFA(
                mergedGrammar,
                nfaName ?? "dynamic-merged",
            );
        } catch (error) {
            return {
                success: false,
                errors: [
                    `Failed to compile merged grammar to NFA: ${error instanceof Error ? error.message : String(error)}`,
                ],
            };
        }

        return {
            success: true,
            grammar: mergedGrammar,
            nfa,
            errors: [],
        };
    }

    /**
     * Load grammar rules without merging (for initial load)
     *
     * @param agrText Grammar rules in .agr format
     * @param nfaName Optional name for the compiled NFA
     * @returns Load result with grammar and NFA
     */
    load(agrText: string, nfaName?: string): DynamicLoadResult {
        const errors: string[] = [];

        // Step 1: Parse the grammar rules
        const grammar = loadGrammarRules("<dynamic>", agrText, errors);

        if (!grammar) {
            return {
                success: false,
                errors: [`Failed to parse grammar: ${errors.join(", ")}`],
            };
        }

        // Step 2: Validate entity references
        const unresolvedEntities = this.validateEntityReferences(grammar);
        if (unresolvedEntities.length > 0) {
            return {
                success: false,
                errors: [
                    "Grammar references unresolved entities. These entities must be registered before the grammar can be loaded.",
                ],
                unresolvedSymbols: unresolvedEntities,
            };
        }

        // Step 3: Compile to NFA
        let nfa: NFA;
        try {
            nfa = compileGrammarToNFA(grammar, nfaName ?? "dynamic");
        } catch (error) {
            return {
                success: false,
                errors: [
                    `Failed to compile grammar to NFA: ${error instanceof Error ? error.message : String(error)}`,
                ],
            };
        }

        return {
            success: true,
            grammar,
            nfa,
            errors: [],
        };
    }

    /**
     * Validate that all entity references in the grammar are resolved
     *
     * Checks both:
     * 1. Declared entities (from "entity" declarations)
     * 2. Wildcard type names in grammar rules
     *
     * Ensures they're either:
     * - Built-in types (string, number)
     * - Registered in the entity registry
     *
     * @param grammar Grammar to validate
     * @returns List of unresolved entity names (empty if all resolved)
     */
    private validateEntityReferences(grammar: Grammar): string[] {
        const unresolved = new Set<string>();
        const builtInTypes = new Set(["string", "number"]);

        // Check declared entities
        if (grammar.entities) {
            for (const entity of grammar.entities) {
                if (!globalEntityRegistry.hasEntity(entity)) {
                    unresolved.add(entity);
                }
            }
        }

        // Check wildcard types in rules
        for (const rule of grammar.rules) {
            this.checkPartsForEntities(rule.parts, unresolved, builtInTypes);
        }

        return Array.from(unresolved);
    }

    private checkPartsForEntities(
        parts: GrammarPart[],
        unresolved: Set<string>,
        builtInTypes: Set<string>,
    ): void {
        for (const part of parts) {
            if (part.type === "wildcard" && part.typeName) {
                // Check if type is resolved
                if (
                    !builtInTypes.has(part.typeName) &&
                    !globalEntityRegistry.hasEntity(part.typeName)
                ) {
                    unresolved.add(part.typeName);
                }
            } else if (part.type === "rules") {
                // Recursively check nested rules
                for (const nestedRule of part.rules) {
                    this.checkPartsForEntities(
                        nestedRule.parts,
                        unresolved,
                        builtInTypes,
                    );
                }
            }
        }
    }
}

/**
 * In-memory grammar cache for dynamic updates
 *
 * Maintains both the grammar and its compiled NFA for efficient matching.
 */
export class DynamicGrammarCache {
    private grammar: Grammar;
    private nfa: NFA;
    private loader = new DynamicGrammarLoader();

    constructor(initialGrammar: Grammar, initialNFA: NFA) {
        this.grammar = initialGrammar;
        this.nfa = initialNFA;
    }

    /**
     * Add new grammar rules dynamically
     *
     * @param agrText Grammar rules in .agr format
     * @returns Result of the operation
     */
    addRules(agrText: string): DynamicLoadResult {
        const result = this.loader.loadAndMerge(agrText, this.grammar, "cache");

        if (result.success && result.grammar && result.nfa) {
            this.grammar = result.grammar;
            this.nfa = result.nfa;
        }

        return result;
    }

    /**
     * Get the current grammar
     */
    getGrammar(): Grammar {
        return this.grammar;
    }

    /**
     * Get the current NFA
     */
    getNFA(): NFA {
        return this.nfa;
    }

    /**
     * Get statistics about the current grammar
     */
    getStats() {
        return {
            ruleCount: this.grammar.rules.length,
            stateCount: this.nfa.states.length,
            transitionCount: this.nfa.states.reduce(
                (sum, s) => sum + s.transitions.length,
                0,
            ),
        };
    }
}
