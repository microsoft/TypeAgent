// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import {
    Environment,
    createEnvironment,
    setSlotValue,
    evaluateExpression,
    cloneEnvironment,
} from "./environment.js";
import registerDebug from "debug";

const debugNFA = registerDebug("typeagent:nfa:match");

/**
 * NFA Interpreter
 *
 * Interprets (runs) an NFA against a sequence of tokens.
 * Useful for debugging and testing NFAs before DFA compilation.
 */

export interface NFAMatchResult {
    matched: boolean;
    // Priority counts for sorting matches
    fixedStringPartCount: number; // # of token transitions taken
    checkedWildcardCount: number; // # of wildcard transitions with type constraints
    uncheckedWildcardCount: number; // # of wildcard transitions without type constraints
    // Rule identification
    ruleIndex?: number | undefined; // Index of the matched grammar rule
    actionValue?: any | undefined; // Evaluated action value from matched rule
    // Debugging info
    visitedStates?: number[] | undefined;
    tokensConsumed?: number | undefined;
    // Debug: slot map for variable name -> slot index (for debugging only)
    debugSlotMap?: Map<string, number> | undefined;
}

interface NFAExecutionState {
    stateId: number;
    tokenIndex: number;
    path: number[]; // For debugging
    // Priority counts for this execution path
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;
    // Rule tracking
    ruleIndex?: number | undefined; // Which grammar rule this execution thread belongs to
    actionValue?: any | undefined; // Compiled action value expression (evaluated at accept)

    // Environment-based slot system (variables compile to slot indices)
    // Current environment for this execution thread
    environment?: Environment | undefined;
    // Slot map for debugging (variable name -> slot index, not used at runtime)
    slotMap?: Map<string, number> | undefined;
}

/**
 * Run an NFA against a sequence of tokens
 * Uses epsilon-closure and parallel state tracking
 *
 * When multiple grammar rules match, this function:
 * 1. Follows all legal transitions in parallel (multiple execution threads)
 * 2. Collects ALL threads that reach accepting states when input is exhausted
 * 3. Sorts accepting threads by priority (fixed strings > checked wildcards > unchecked)
 * 4. Returns the highest-priority match
 *
 * Note: For future DFA construction where accepting states may be merged,
 * use NFAState.priorityHint to track the best achievable priority for merged states.
 */
export function matchNFA(
    nfa: NFA,
    tokens: string[],
    debug: boolean = false,
): NFAMatchResult {
    debugNFA(`Matching tokens: [${tokens.join(", ")}] against NFA: ${nfa.name || "(unnamed)"}`);

    // Start with epsilon closure of start state
    const initialStates = epsilonClosure(nfa, [
        {
            stateId: nfa.startState,
            tokenIndex: 0,
            path: [nfa.startState],
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            ruleIndex: undefined,
            actionValue: undefined,
        },
    ]);

    debugNFA(`Initial states after epsilon closure: ${initialStates.length} state(s)`);
    let currentStates = initialStates;
    const allVisitedStates = new Set<number>([nfa.startState]);

    // Process each token
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        debugNFA(`Token ${tokenIndex}: "${token}", currentStates: ${currentStates.length}`);
        const nextStates: NFAExecutionState[] = [];

        // Try each current state
        for (const state of currentStates) {
            const nfaState = nfa.states[state.stateId];
            if (!nfaState) continue;

            debugNFA(`  State ${state.stateId}, env slots: ${state.environment ? JSON.stringify(state.environment.slots) : "none"}, transitions: ${nfaState.transitions.length}`);

            // Try each transition
            for (const trans of nfaState.transitions) {
                const result = tryTransition(
                    nfa,
                    trans,
                    token,
                    state,
                    tokenIndex,
                );
                if (result) {
                    debugNFA(`    Transition ${trans.type} → state ${result.stateId} succeeded`);
                    nextStates.push(result);
                    allVisitedStates.add(result.stateId);
                }
            }
        }

        debugNFA(`  Next states before epsilon: ${nextStates.length}`);

        if (nextStates.length === 0) {
            // No valid transitions - match failed
            debugNFA(`FAILED: No valid transitions for token "${token}"`);
            return {
                matched: false,
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                visitedStates: debug ? Array.from(allVisitedStates) : undefined,
                tokensConsumed: tokenIndex,
            };
        }

        // Compute epsilon closure for next states
        currentStates = epsilonClosure(nfa, nextStates);
        debugNFA(`  Current states after epsilon: ${currentStates.length}`);

        // Track visited states
        if (debug) {
            for (const state of currentStates) {
                allVisitedStates.add(state.stateId);
            }
        }
    }

    // Collect ALL accepting threads (multiple rules may match)
    debugNFA(`After all tokens, currentStates: ${currentStates.length}, accepting states: [${nfa.acceptingStates.join(", ")}]`);
    const acceptingThreads: NFAMatchResult[] = [];
    for (const state of currentStates) {
        debugNFA(`  Checking state ${state.stateId}, is accepting: ${nfa.acceptingStates.includes(state.stateId)}`);
        if (nfa.acceptingStates.includes(state.stateId)) {
            // Evaluate the actionValue using the environment's slot values
            let evaluatedActionValue = state.actionValue;
            debugNFA(`  Accept state details: hasActionValue=${!!state.actionValue}, hasEnv=${!!state.environment}, hasSlotMap=${!!state.slotMap}`);
            if (state.environment) {
                debugNFA(`    Environment slots: ${JSON.stringify(state.environment.slots)}`);
            }
            if (state.slotMap) {
                debugNFA(`    SlotMap (debug): ${JSON.stringify([...state.slotMap.entries()])}`);
            }
            // actionValue is a compiled ValueExpression with slot indices
            // Evaluate it using the environment's slot values
            if (state.actionValue && state.environment) {
                try {
                    evaluatedActionValue = evaluateExpression(
                        state.actionValue,
                        state.environment,
                    );
                    debugNFA(`  Evaluated actionValue: ${JSON.stringify(evaluatedActionValue)}`);
                } catch (e) {
                    debugNFA(`  Failed to evaluate actionValue: ${e}`);
                }
            }

            acceptingThreads.push({
                matched: true,
                fixedStringPartCount: state.fixedStringPartCount,
                checkedWildcardCount: state.checkedWildcardCount,
                uncheckedWildcardCount: state.uncheckedWildcardCount,
                ruleIndex: state.ruleIndex,
                actionValue: evaluatedActionValue,
                visitedStates: debug ? Array.from(allVisitedStates) : undefined,
                tokensConsumed: tokens.length,
                debugSlotMap: debug ? state.slotMap : undefined,
            });
        }
    }

    debugNFA(`Accepting threads: ${acceptingThreads.length}`);

    // If any threads reached accepting states, return the best one by priority
    if (acceptingThreads.length > 0) {
        const sorted = sortNFAMatches(acceptingThreads);
        debugNFA(`SUCCESS: Best match has ${sorted[0].fixedStringPartCount} fixed, ${sorted[0].checkedWildcardCount} checked, ${sorted[0].uncheckedWildcardCount} unchecked`);
        return sorted[0]; // Best match by priority rules
    }

    debugNFA(`FAILED: No accepting threads`);

    // Processed all tokens but not in accepting state
    return {
        matched: false,
        fixedStringPartCount: 0,
        checkedWildcardCount: 0,
        uncheckedWildcardCount: 0,
        visitedStates: debug ? Array.from(allVisitedStates) : undefined,
        tokensConsumed: tokens.length,
    };
}

/**
 * Try a single transition
 * Returns new state if transition succeeds, undefined otherwise
 */
function tryTransition(
    nfa: NFA,
    trans: NFATransition,
    token: string,
    currentState: NFAExecutionState,
    tokenIndex: number,
): NFAExecutionState | undefined {
    switch (trans.type) {
        case "token":
            // Match specific token(s)
            if (trans.tokens && trans.tokens.includes(token)) {
                return {
                    stateId: trans.to,
                    tokenIndex: tokenIndex + 1,
                    path: [...currentState.path, trans.to],
                    fixedStringPartCount: currentState.fixedStringPartCount + 1,
                    checkedWildcardCount: currentState.checkedWildcardCount,
                    uncheckedWildcardCount: currentState.uncheckedWildcardCount,
                    ruleIndex: currentState.ruleIndex,
                    actionValue: currentState.actionValue,
                    environment: currentState.environment,
                    slotMap: currentState.slotMap,
                };
            }
            return undefined;

        case "wildcard": {
            // Match token and write to slot (variables compile to slot indices)
            let slotValue: string | number = token;

            // Check type constraints and validate/convert token
            if (trans.typeName) {
                if (trans.typeName === "number") {
                    // Built-in number type
                    const num = parseFloat(token);
                    if (isNaN(num)) {
                        return undefined; // Token is not a number
                    }
                    slotValue = num;
                } else {
                    // Entity type - check validator
                    const validator = globalEntityRegistry.getValidator(trans.typeName);
                    if (validator && !validator.validate(token)) {
                        return undefined; // Validation failed
                    }
                    // Try converter if available
                    const converter = globalEntityRegistry.getConverter(trans.typeName);
                    if (converter) {
                        const converted = converter.convert(token);
                        if (converted === undefined) {
                            return undefined; // Conversion failed
                        }
                        slotValue = converted as string | number;
                    }
                    // If no converter, slotValue remains as token string
                }
            }

            // Write to slot (the append flag handles multi-token wildcards)
            let newEnvironment = currentState.environment;
            if (trans.slotIndex !== undefined && currentState.environment) {
                newEnvironment = cloneEnvironment(currentState.environment);
                setSlotValue(
                    newEnvironment,
                    trans.slotIndex,
                    slotValue,
                    trans.appendToSlot ?? false,
                );
            }

            // Determine if this is a checked or unchecked wildcard
            const isChecked =
                trans.checked === true ||
                (trans.typeName && trans.typeName !== "string" && trans.typeName !== "wildcard");

            return {
                stateId: trans.to,
                tokenIndex: tokenIndex + 1,
                path: [...currentState.path, trans.to],
                fixedStringPartCount: currentState.fixedStringPartCount,
                checkedWildcardCount: isChecked
                    ? currentState.checkedWildcardCount + 1
                    : currentState.checkedWildcardCount,
                uncheckedWildcardCount: isChecked
                    ? currentState.uncheckedWildcardCount
                    : currentState.uncheckedWildcardCount + 1,
                ruleIndex: currentState.ruleIndex,
                actionValue: currentState.actionValue,
                environment: newEnvironment,
                slotMap: currentState.slotMap,
            };
        }

        case "epsilon":
            // Epsilon transitions are handled separately
            return undefined;

        default:
            return undefined;
    }
}

/**
 * Compute epsilon closure of a set of states
 * Returns all states reachable via epsilon transitions
 *
 * IMPORTANT: Multiple execution threads can reach the same NFA state with different
 * priority counts. We must preserve ALL threads, not deduplicate by state ID alone.
 *
 * NEW: When entering a state with slotMap (a rule entry), create a new environment
 * for that rule's variables. The environment tracks captures using slots instead of
 * the old captures map approach.
 */
function epsilonClosure(
    nfa: NFA,
    states: NFAExecutionState[],
): NFAExecutionState[] {
    const result: NFAExecutionState[] = [];
    // Track visited states by (stateId, fixedCount, checkedCount, uncheckedCount) tuple
    // to allow multiple threads at the same NFA state with different priority counts
    const visited = new Set<string>();
    const queue = [...states];

    while (queue.length > 0) {
        const state = queue.shift()!;

        // Create unique key for this execution thread
        const key = `${state.stateId}-${state.fixedStringPartCount}-${state.checkedWildcardCount}-${state.uncheckedWildcardCount}`;

        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

        const nfaState = nfa.states[state.stateId];
        if (!nfaState) continue;

        // Capture rule index from state marker if present
        const currentRuleIndex =
            nfaState.ruleIndex !== undefined
                ? nfaState.ruleIndex
                : state.ruleIndex;

        // NEW: Handle environment creation when entering a rule with slotMap
        let currentEnvironment = state.environment;
        let currentSlotMap = state.slotMap;

        if (nfaState.slotMap && nfaState.slotCount !== undefined) {
            // This is a rule entry state - create a new environment
            // The new environment has the previous one as parent (for nested rules)
            // Store slotMap and actionValue in the environment so they can be restored when popping
            currentEnvironment = createEnvironment(
                nfaState.slotCount,
                state.environment,
                nfaState.parentSlotIndex,
                nfaState.slotMap,
                nfaState.actionValue, // Store actionValue for this rule
            );
            currentSlotMap = nfaState.slotMap;
        }

        // IMPORTANT: For actionValue, we need to be careful about nested rules.
        // If the state has an actionValue AND we're creating a new environment,
        // we should use the state's actionValue (it's the outer rule's value).
        // If we're not creating a new environment, we should keep the current actionValue
        // (from the rule we're already in).
        //
        // The key insight: the actionValue should be determined by which rule's
        // environment we're in, not by the most recently visited state.
        let currentActionValue = state.actionValue;
        if (nfaState.actionValue !== undefined && nfaState.slotMap) {
            // This is a rule entry with an action value - use it
            currentActionValue = nfaState.actionValue;
        } else if (nfaState.actionValue !== undefined && !state.environment) {
            // Legacy: top-level rule entry without environment (backwards compatibility)
            currentActionValue = nfaState.actionValue;
        }
        // Otherwise keep the current actionValue (we're inside the same rule)

        // Update the state with current values before adding to result
        const updatedState: NFAExecutionState = {
            ...state,
            ruleIndex: currentRuleIndex,
            actionValue: currentActionValue,
            environment: currentEnvironment,
            slotMap: currentSlotMap,
        };
        result.push(updatedState);

        // Follow epsilon transitions
        for (const trans of nfaState.transitions) {
            if (trans.type === "epsilon") {
                // Check if this is a "write to parent" epsilon transition
                // These are used when exiting a nested rule to write the result to the parent slot
                let newEnvironment = currentEnvironment;
                let newSlotMap = currentSlotMap;
                let newActionValue = currentActionValue;

                if (
                    trans.writeToParent &&
                    trans.valueToWrite &&
                    currentEnvironment &&
                    currentEnvironment.parent &&
                    currentEnvironment.parentSlotIndex !== undefined
                ) {
                    // Evaluate the nested rule's compiled value expression
                    // trans.valueToWrite is already a compiled ValueExpression with slot indices
                    try {
                        const evaluatedValue = evaluateExpression(
                            trans.valueToWrite,
                            currentEnvironment,
                        );
                        // Write to parent's slot
                        setSlotValue(
                            currentEnvironment.parent,
                            currentEnvironment.parentSlotIndex,
                            evaluatedValue,
                        );
                        debugNFA(
                            `  WriteToParent: evaluated -> ${JSON.stringify(evaluatedValue)?.substring(0, 50)}, wrote to slot ${currentEnvironment.parentSlotIndex}`,
                        );
                    } catch (e) {
                        debugNFA(`  WriteToParent failed: ${e}`);
                    }
                    // Pop back to parent environment and restore slotMap/actionValue
                    newEnvironment = currentEnvironment.parent;
                    // Restore slotMap from parent environment if available
                    if (newEnvironment?.slotMap) {
                        newSlotMap = newEnvironment.slotMap;
                    }
                    // Restore actionValue from parent environment if available
                    if (newEnvironment?.actionValue !== undefined) {
                        newActionValue = newEnvironment.actionValue;
                    }
                }

                queue.push({
                    stateId: trans.to,
                    tokenIndex: updatedState.tokenIndex,
                    path: [...updatedState.path, trans.to],
                    fixedStringPartCount: updatedState.fixedStringPartCount,
                    checkedWildcardCount: updatedState.checkedWildcardCount,
                    uncheckedWildcardCount: updatedState.uncheckedWildcardCount,
                    ruleIndex: currentRuleIndex,
                    actionValue: newActionValue,
                    environment: newEnvironment,
                    slotMap: newSlotMap,
                });
            }
        }
    }

    return result;
}

/**
 * Pretty print NFA for debugging
 */
export function printNFA(nfa: NFA): string {
    const lines: string[] = [];

    lines.push(`NFA: ${nfa.name || "(unnamed)"}`);
    lines.push(`  Start state: ${nfa.startState}`);
    lines.push(`  Accepting states: [${nfa.acceptingStates.join(", ")}]`);
    lines.push(`  States (${nfa.states.length}):`);

    for (const state of nfa.states) {
        const accepting = state.accepting ? " [ACCEPT]" : "";
        lines.push(`    State ${state.id}${accepting}:`);

        if (state.transitions.length === 0) {
            lines.push(`      (no transitions)`);
        }

        for (const trans of state.transitions) {
            const label = formatTransition(trans);
            lines.push(`      ${label} -> ${trans.to}`);
        }
    }

    return lines.join("\n");
}

function formatTransition(trans: NFATransition): string {
    switch (trans.type) {
        case "epsilon":
            return "ε";
        case "token":
            return trans.tokens ? `[${trans.tokens.join("|")}]` : "[?]";
        case "wildcard":
            const varInfo = trans.variable
                ? `:${trans.variable}${trans.typeName ? `<${trans.typeName}>` : ""}`
                : "";
            return `*${varInfo}`;
        default:
            return "?";
    }
}

/**
 * Print match result for debugging
 */
export function printMatchResult(
    result: NFAMatchResult,
    tokens: string[],
): string {
    const lines: string[] = [];

    lines.push(`Match result: ${result.matched ? "SUCCESS" : "FAILED"}`);
    lines.push(`Tokens consumed: ${result.tokensConsumed}/${tokens.length}`);

    if (result.actionValue !== undefined) {
        lines.push(`Action value: ${JSON.stringify(result.actionValue)}`);
    }

    if (result.debugSlotMap && result.debugSlotMap.size > 0) {
        lines.push(`Slot map (debug):`);
        for (const [varName, slotIdx] of result.debugSlotMap) {
            lines.push(`  ${varName} -> slot ${slotIdx}`);
        }
    }

    if (result.visitedStates) {
        lines.push(`Visited states: [${result.visitedStates.join(", ")}]`);
    }

    return lines.join("\n");
}

/**
 * Sort NFA match results by priority
 *
 * Priority rules (highest to lowest):
 * 1. Rules without unchecked wildcards always beat rules with them
 * 2. More fixed string parts > fewer fixed string parts
 * 3. More checked wildcards > fewer checked wildcards
 * 4. Fewer unchecked wildcards > more unchecked wildcards
 */
export function sortNFAMatches<T extends NFAMatchResult>(matches: T[]): T[] {
    return matches.sort((a, b) => {
        // Rule 1: Prefer matches without unchecked wildcards
        if (a.uncheckedWildcardCount === 0) {
            if (b.uncheckedWildcardCount !== 0) {
                return -1; // a wins (no unchecked wildcards)
            }
        } else {
            if (b.uncheckedWildcardCount === 0) {
                return 1; // b wins (no unchecked wildcards)
            }
        }

        // Rule 2: Prefer more fixed string parts
        if (a.fixedStringPartCount !== b.fixedStringPartCount) {
            return b.fixedStringPartCount - a.fixedStringPartCount;
        }

        // Rule 3: Prefer more checked wildcards
        if (a.checkedWildcardCount !== b.checkedWildcardCount) {
            return b.checkedWildcardCount - a.checkedWildcardCount;
        }

        // Rule 4: Prefer fewer unchecked wildcards
        return a.uncheckedWildcardCount - b.uncheckedWildcardCount;
    });
}
