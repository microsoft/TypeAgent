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
    for (const rule of grammar.rules) {
        const ruleEntry = builder.createState(false);
        builder.addEpsilonTransition(startState, ruleEntry);

        const ruleEnd = compileRuleFromState(builder, rule, ruleEntry, acceptState);

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
    rule: GrammarRule,
    startState: number,
    finalState: number,
): number {
    let currentState = startState;

    // Process each part of the rule sequentially
    for (let i = 0; i < rule.parts.length; i++) {
        const part = rule.parts[i];
        const isLast = i === rule.parts.length - 1;
        const nextState = isLast ? finalState : builder.createState(false);

        currentState = compilePart(builder, part, currentState, nextState);
    }

    return currentState;
}

/**
 * Compile a single grammar part
 * @returns The state after this part
 */
function compilePart(
    builder: NFABuilder,
    part: GrammarPart,
    fromState: number,
    toState: number,
): number {
    switch (part.type) {
        case "string":
            return compileStringPart(builder, part, fromState, toState);

        case "wildcard":
            return compileWildcardPart(builder, part, fromState, toState);

        case "number":
            return compileNumberPart(builder, part, fromState, toState);

        case "rules":
            return compileRulesPart(builder, part, fromState, toState);

        default:
            throw new Error(
                `Unknown part type: ${(part as any).type}`,
            );
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

    // For multiple tokens (alternatives), create epsilon branches
    for (const token of part.value) {
        builder.addTokenTransition(fromState, toState, [token]);
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
): number {
    if (part.optional) {
        // Optional: can skip via epsilon or match via wildcard
        builder.addEpsilonTransition(fromState, toState);
        builder.addWildcardTransition(
            fromState,
            toState,
            part.variable,
            part.typeName,
        );
        return toState;
    }

    // Required wildcard
    builder.addWildcardTransition(
        fromState,
        toState,
        part.variable,
        part.typeName,
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
        builder.addWildcardTransition(fromState, toState, part.variable, "number");
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
    part: RulesPart,
    fromState: number,
    toState: number,
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
        builder.addEpsilonTransition(nestedEntry, ruleEntry);
        compileRuleFromState(builder, rule, ruleEntry, nestedExit);
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
 * Compile a single grammar rule to a standalone NFA
 * Useful for incremental grammar building
 */
export function compileRuleToNFA(rule: GrammarRule, name?: string): NFA {
    const builder = new NFABuilder();
    const startState = builder.createState(false);
    const acceptState = builder.createState(true);

    compileRuleFromState(builder, rule, startState, acceptState);

    return builder.build(startState, name);
}
