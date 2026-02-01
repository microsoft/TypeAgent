// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";

/**
 * NFA Interpreter
 *
 * Interprets (runs) an NFA against a sequence of tokens.
 * Useful for debugging and testing NFAs before DFA compilation.
 */

export interface NFAMatchResult {
    matched: boolean;
    captures: Map<string, string | number>;
    // Priority counts for sorting matches
    fixedStringPartCount: number; // # of token transitions taken
    checkedWildcardCount: number; // # of wildcard transitions with type constraints
    uncheckedWildcardCount: number; // # of wildcard transitions without type constraints
    // Rule identification
    ruleIndex?: number | undefined; // Index of the matched grammar rule
    actionValue?: any | undefined; // Action value from matched rule (for nested rules)
    // Debugging info
    visitedStates?: number[] | undefined;
    tokensConsumed?: number | undefined;
}

interface NFAExecutionState {
    stateId: number;
    tokenIndex: number;
    captures: Map<string, string | number>;
    path: number[]; // For debugging
    // Priority counts for this execution path
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;
    // Rule tracking
    ruleIndex?: number | undefined; // Which grammar rule this execution thread belongs to
    actionValue?: any | undefined; // Action value from the matched rule (for nested rules)
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
    // Start with epsilon closure of start state
    const initialStates = epsilonClosure(nfa, [
        {
            stateId: nfa.startState,
            tokenIndex: 0,
            captures: new Map(),
            path: [nfa.startState],
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            ruleIndex: undefined,
            actionValue: undefined,
        },
    ]);

    let currentStates = initialStates;
    const allVisitedStates = new Set<number>([nfa.startState]);

    // Process each token
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        const nextStates: NFAExecutionState[] = [];

        // Try each current state
        for (const state of currentStates) {
            const nfaState = nfa.states[state.stateId];
            if (!nfaState) continue;

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
                    nextStates.push(result);
                    allVisitedStates.add(result.stateId);
                }
            }
        }

        if (nextStates.length === 0) {
            // No valid transitions - match failed
            return {
                matched: false,
                captures: new Map(),
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                visitedStates: debug ? Array.from(allVisitedStates) : undefined,
                tokensConsumed: tokenIndex,
            };
        }

        // Compute epsilon closure for next states
        currentStates = epsilonClosure(nfa, nextStates);

        // Track visited states
        if (debug) {
            for (const state of currentStates) {
                allVisitedStates.add(state.stateId);
            }
        }
    }

    // Collect ALL accepting threads (multiple rules may match)
    const acceptingThreads: NFAMatchResult[] = [];
    for (const state of currentStates) {
        if (nfa.acceptingStates.includes(state.stateId)) {
            acceptingThreads.push({
                matched: true,
                captures: state.captures,
                fixedStringPartCount: state.fixedStringPartCount,
                checkedWildcardCount: state.checkedWildcardCount,
                uncheckedWildcardCount: state.uncheckedWildcardCount,
                ruleIndex: state.ruleIndex,
                actionValue: state.actionValue,
                visitedStates: debug ? Array.from(allVisitedStates) : undefined,
                tokensConsumed: tokens.length,
            });
        }
    }

    // If any threads reached accepting states, return the best one by priority
    if (acceptingThreads.length > 0) {
        const sorted = sortNFAMatches(acceptingThreads);
        return sorted[0]; // Best match by priority rules
    }

    // Processed all tokens but not in accepting state
    return {
        matched: false,
        captures: new Map(),
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
                    captures: new Map(currentState.captures),
                    path: [...currentState.path, trans.to],
                    fixedStringPartCount: currentState.fixedStringPartCount + 1,
                    checkedWildcardCount: currentState.checkedWildcardCount,
                    uncheckedWildcardCount: currentState.uncheckedWildcardCount,
                    ruleIndex: currentState.ruleIndex,
                    actionValue: currentState.actionValue,
                };
            }
            return undefined;

        case "wildcard":
            // Match any token and capture it
            const newCaptures = new Map(currentState.captures);

            // Check if there's a type constraint
            if (trans.typeName) {
                // Special handling for built-in "number" type
                if (trans.typeName === "number") {
                    const num = parseFloat(token);
                    if (!isNaN(num)) {
                        if (trans.variable) {
                            newCaptures.set(trans.variable, num);
                        }
                    } else {
                        // Token is not a number
                        return undefined;
                    }
                } else {
                    // Check if entity type is registered
                    const validator = globalEntityRegistry.getValidator(
                        trans.typeName,
                    );
                    if (validator) {
                        // Use the entity's validator
                        if (!validator.validate(token)) {
                            return undefined;
                        }
                        // Try to convert if converter is available
                        const converter = globalEntityRegistry.getConverter(
                            trans.typeName,
                        );
                        if (converter && trans.variable) {
                            const converted = converter.convert(token);
                            if (converted !== undefined) {
                                newCaptures.set(
                                    trans.variable,
                                    converted as string | number,
                                );
                            } else {
                                // Conversion failed
                                return undefined;
                            }
                        } else if (trans.variable) {
                            // No converter, store as string
                            newCaptures.set(trans.variable, token);
                        }
                    } else {
                        // Unknown type - treat as string wildcard
                        if (trans.variable) {
                            newCaptures.set(trans.variable, token);
                        }
                    }
                }
            } else {
                // No type constraint - match any token
                if (trans.variable) {
                    newCaptures.set(trans.variable, token);
                }
            }

            // Determine if this is a checked or unchecked wildcard
            // A wildcard is checked if:
            // 1. The transition has checked=true (from checked_wildcard paramSpec or entity type)
            // 2. Legacy: typeName is not "string" (entity type like MusicDevice, Ordinal)
            const isChecked =
                trans.checked === true ||
                (trans.typeName && trans.typeName !== "string");

            return {
                stateId: trans.to,
                tokenIndex: tokenIndex + 1,
                captures: newCaptures,
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
            };

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

        // Capture action value from state marker if present (prefer more recent values)
        const currentActionValue =
            nfaState.actionValue !== undefined
                ? nfaState.actionValue
                : state.actionValue;

        // Update the state with current values before adding to result
        const updatedState: NFAExecutionState = {
            ...state,
            ruleIndex: currentRuleIndex,
            actionValue: currentActionValue,
        };
        result.push(updatedState);

        // Follow epsilon transitions
        for (const trans of nfaState.transitions) {
            if (trans.type === "epsilon") {
                queue.push({
                    stateId: trans.to,
                    tokenIndex: updatedState.tokenIndex,
                    captures: new Map(updatedState.captures),
                    path: [...updatedState.path, trans.to],
                    fixedStringPartCount: updatedState.fixedStringPartCount,
                    checkedWildcardCount: updatedState.checkedWildcardCount,
                    uncheckedWildcardCount: updatedState.uncheckedWildcardCount,
                    ruleIndex: currentRuleIndex,
                    actionValue: currentActionValue,
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

    if (result.captures.size > 0) {
        lines.push(`Captures:`);
        for (const [key, value] of result.captures) {
            lines.push(`  ${key} = ${JSON.stringify(value)}`);
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
