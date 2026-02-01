// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarRule,
    GrammarPart,
    StringPart,
    VarStringPart,
    VarNumberPart,
    RulesPart,
} from "./grammarTypes.js";
import { NFA, NFABuilder } from "./nfa.js";

/**
 * Compile a Grammar to an NFA
 *
 * This compiler converts token-based grammar rules into an NFA that can be:
 * 1. Interpreted directly for matching (debugging)
 * 2. Converted to a DFA for faster matching
 * 3. Combined with other NFAs for incremental grammar extension
 */

/**
 * Compile a grammar to an NFA
 * @param grammar The grammar to compile
 * @param name Optional name for debugging
 * @returns An NFA representing the grammar
 */
export function compileGrammarToNFA(grammar: Grammar, name?: string): NFA {
    const builder = new NFABuilder();

    // Create start state
    const startState = builder.createState(false);

    // Create an accepting state that all rules will lead to
    const acceptState = builder.createState(true);

    // Compile each rule as an alternative path from start to accept
    for (let ruleIndex = 0; ruleIndex < grammar.rules.length; ruleIndex++) {
        const rule = grammar.rules[ruleIndex];

        // VALIDATION: Multi-term rules MUST have value expressions
        // Single-term rules can omit value expressions (they inherit from the term)
        if (rule.parts.length > 1 && !rule.value) {
            throw new Error(
                `Grammar rule at index ${ruleIndex} has ${rule.parts.length} terms but no value expression. ` +
                    `Multi-term rules must have an explicit value expression (using ->).`,
            );
        }

        const ruleEntry = builder.createState(false);

        // Mark the rule entry state with the rule index
        builder.getState(ruleEntry).ruleIndex = ruleIndex;

        // Store the action value for this rule in the NFA actionValues array
        // This is used for priority tracking and debugging
        builder.setActionValue(ruleIndex, rule.value);

        // If the rule has an explicit value expression, also set it on the state
        // This allows the value to be propagated through epsilon transitions
        if (rule.value) {
            builder.getState(ruleEntry).actionValue = rule.value;
        }

        builder.addEpsilonTransition(startState, ruleEntry);

        const ruleEnd = compileRuleFromState(
            builder,
            grammar,
            rule,
            ruleEntry,
            acceptState,
            grammar.checkedVariables,
        );

        // If rule didn't connect to accept state, add epsilon transition
        if (ruleEnd !== acceptState) {
            builder.addEpsilonTransition(ruleEnd, acceptState);
        }
    }

    return builder.build(startState, name);
}

/**
 * Compile a single grammar rule starting from a specific state
 * @returns The final state of this rule
 */
function compileRuleFromState(
    builder: NFABuilder,
    grammar: Grammar,
    rule: GrammarRule,
    startState: number,
    finalState: number,
    checkedVariables?: Set<string>,
): number {
    let currentState = startState;

    // Process each part of the rule sequentially
    for (let i = 0; i < rule.parts.length; i++) {
        const part = rule.parts[i];
        const isLast = i === rule.parts.length - 1;
        const nextState = isLast ? finalState : builder.createState(false);

        currentState = compilePart(
            builder,
            grammar,
            part,
            currentState,
            nextState,
            checkedVariables,
        );
    }

    return currentState;
}

/**
 * Compile a single grammar part
 * @returns The state after this part
 */
function compilePart(
    builder: NFABuilder,
    grammar: Grammar,
    part: GrammarPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
): number {
    switch (part.type) {
        case "string":
            return compileStringPart(builder, part, fromState, toState);

        case "wildcard":
            return compileWildcardPart(
                builder,
                part,
                fromState,
                toState,
                checkedVariables,
            );

        case "number":
            return compileNumberPart(builder, part, fromState, toState);

        case "rules":
            return compileRulesPart(
                builder,
                grammar,
                part,
                fromState,
                toState,
                checkedVariables,
            );

        default:
            throw new Error(`Unknown part type: ${(part as any).type}`);
    }
}

/**
 * Compile a string part (matches specific tokens)
 */
function compileStringPart(
    builder: NFABuilder,
    part: StringPart,
    fromState: number,
    toState: number,
): number {
    if (part.value.length === 0) {
        // Empty string - epsilon transition
        builder.addEpsilonTransition(fromState, toState);
        return toState;
    }

    // For single token, direct transition
    if (part.value.length === 1) {
        builder.addTokenTransition(fromState, toState, part.value);
        return toState;
    }

    // For multiple tokens, create a sequence chain
    // Each token must match in order: state1 --token1--> state2 --token2--> ... --> toState
    let currentState = fromState;
    for (let i = 0; i < part.value.length; i++) {
        const token = part.value[i];
        const isLast = i === part.value.length - 1;
        const nextState = isLast ? toState : builder.createState(false);
        builder.addTokenTransition(currentState, nextState, [token]);
        currentState = nextState;
    }
    return toState;
}

/**
 * Compile a wildcard part (matches any token, captures to variable)
 */
function compileWildcardPart(
    builder: NFABuilder,
    part: VarStringPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
): number {
    // Determine if this wildcard is checked
    // A wildcard is checked if:
    // 1. It has a non-string typeName (entity type like MusicDevice, Ordinal, etc.)
    // 2. It's in the checkedVariables set (has checked_wildcard paramSpec)
    const hasEntityType = part.typeName && part.typeName !== "string";
    const hasCheckedParamSpec = checkedVariables?.has(part.variable) ?? false;
    const isChecked = hasEntityType || hasCheckedParamSpec;

    if (part.optional) {
        // Optional: can skip via epsilon or match via wildcard
        builder.addEpsilonTransition(fromState, toState);
        builder.addWildcardTransition(
            fromState,
            toState,
            part.variable,
            part.typeName,
            isChecked,
        );
        return toState;
    }

    // Required wildcard
    builder.addWildcardTransition(
        fromState,
        toState,
        part.variable,
        part.typeName,
        isChecked,
    );
    return toState;
}

/**
 * Compile a number part (matches numeric tokens)
 */
function compileNumberPart(
    builder: NFABuilder,
    part: VarNumberPart,
    fromState: number,
    toState: number,
): number {
    // For now, treat numbers as wildcards with type constraint
    // A more sophisticated version could have a "number" transition type
    if (part.optional) {
        builder.addEpsilonTransition(fromState, toState);
        builder.addWildcardTransition(
            fromState,
            toState,
            part.variable,
            "number",
        );
        return toState;
    }

    builder.addWildcardTransition(fromState, toState, part.variable, "number");
    return toState;
}

/**
 * Compile a rules part (nested grammar rules)
 */
function compileRulesPart(
    builder: NFABuilder,
    grammar: Grammar,
    part: RulesPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
): number {
    if (part.rules.length === 0) {
        // Empty rules - epsilon transition
        builder.addEpsilonTransition(fromState, toState);
        return toState;
    }

    // Create entry and exit states for the nested rules
    const nestedEntry = builder.createState(false);
    const nestedExit = builder.createState(false);

    // Connect entry
    builder.addEpsilonTransition(fromState, nestedEntry);

    // Compile each nested rule as an alternative
    for (const rule of part.rules) {
        const ruleEntry = builder.createState(false);

        // Try to find this nested rule in the main grammar to get its rule index
        // Match based on whether the rule has an action value
        if (rule.value) {
            const ruleIndex = findRuleIndex(grammar, rule);
            if (ruleIndex !== -1) {
                builder.getState(ruleEntry).ruleIndex = ruleIndex;
            }
            // Always store the action value on the entry state for nested rules
            // This ensures we can return the correct action even if ruleIndex matching fails
            builder.getState(ruleEntry).actionValue = rule.value;
        }

        builder.addEpsilonTransition(nestedEntry, ruleEntry);
        compileRuleFromState(
            builder,
            grammar,
            rule,
            ruleEntry,
            nestedExit,
            checkedVariables,
        );
    }

    // Connect exit
    if (part.optional) {
        // Optional: can skip the entire nested section
        builder.addEpsilonTransition(fromState, toState);
    }
    builder.addEpsilonTransition(nestedExit, toState);

    return toState;
}

/**
 * Find the index of a rule in the grammar's rules array
 * Returns -1 if not found
 */
function findRuleIndex(grammar: Grammar, rule: GrammarRule): number {
    // Match based on rule value (action object)
    // This is a simple comparison - we could make it more sophisticated
    for (let i = 0; i < grammar.rules.length; i++) {
        const grammarRule = grammar.rules[i];
        if (grammarRule.value && rulesMatch(grammarRule, rule)) {
            return i;
        }
    }
    return -1;
}

/**
 * Check if two rules match (simplified comparison based on value)
 */
function rulesMatch(rule1: GrammarRule, rule2: GrammarRule): boolean {
    // For now, use a simple identity check
    // In practice, nested rules are often the same object references
    return rule1 === rule2;
}

/**
 * Compile a single grammar rule to a standalone NFA
 * Useful for incremental grammar building
 */
export function compileRuleToNFA(rule: GrammarRule, name?: string): NFA {
    const builder = new NFABuilder();
    const startState = builder.createState(false);
    const acceptState = builder.createState(true);

    // Create a minimal grammar for this single rule
    const grammar: Grammar = {
        rules: [rule],
    };

    compileRuleFromState(builder, grammar, rule, startState, acceptState);

    return builder.build(startState, name);
}
