// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import { normalizeToken } from "./nfaMatcher.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";
import {
    Environment,
    createEnvironment,
    setSlotValue,
    evaluateExpression,
    cloneEnvironment,
    deepCloneEnvironment,
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

    // Multi-token entity matching: when an entity converter matches a span of
    // multiple tokens (e.g. "from 1-2pm" as CalendarTimeRange), the thread
    // consumes the first token normally and sets skipCount to the number of
    // remaining tokens to skip. On each subsequent token, skipCount is
    // decremented and no transitions are attempted until it reaches 0.
    skipCount?: number | undefined;
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
    debugNFA(
        `Matching tokens: [${tokens.join(", ")}] against NFA: ${nfa.name || "(unnamed)"}`,
    );

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

    debugNFA(
        `Initial states after epsilon closure: ${initialStates.length} state(s)`,
    );
    let currentStates = initialStates;
    const allVisitedStates = new Set<number>([nfa.startState]);

    // Process each token
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        debugNFA(
            `Token ${tokenIndex}: "${token}", currentStates: ${currentStates.length}`,
        );
        const nextStates: NFAExecutionState[] = [];

        // Try each current state
        for (const state of currentStates) {
            // Multi-token entity skip: this thread already matched a multi-token
            // entity span and is skipping the remaining tokens in that span
            if (state.skipCount && state.skipCount > 0) {
                debugNFA(
                    `  State ${state.stateId} SKIP (${state.skipCount} remaining)`,
                );
                nextStates.push({
                    ...state,
                    tokenIndex: tokenIndex + 1,
                    skipCount: state.skipCount - 1,
                });
                continue;
            }

            const nfaState = nfa.states[state.stateId];
            if (!nfaState) continue;

            debugNFA(
                `  State ${state.stateId}, env slots: ${state.environment ? JSON.stringify(state.environment.slots) : "none"}, transitions: ${nfaState.transitions.length}`,
            );

            // Try each transition
            for (const trans of nfaState.transitions) {
                // phraseSet transitions are handled here (not in tryTransition):
                // try every phrase in the set at the current token position and
                // generate one execution thread per matching phrase.
                if (trans.type === "phraseSet") {
                    const matcher = trans.matcherName
                        ? globalPhraseSetRegistry.getMatcher(trans.matcherName)
                        : undefined;
                    if (matcher) {
                        for (const phrase of matcher.phrases) {
                            if (
                                tokenIndex + phrase.length <=
                                tokens.length
                            ) {
                                let matches = true;
                                for (let pi = 0; pi < phrase.length; pi++) {
                                    if (
                                        normalizeToken(
                                            tokens[tokenIndex + pi],
                                        ) !== phrase[pi]
                                    ) {
                                        matches = false;
                                        break;
                                    }
                                }
                                if (matches) {
                                    debugNFA(
                                        `    phraseSet(${trans.matcherName}) matched phrase "${phrase.join(" ")}" → state ${trans.to}${phrase.length > 1 ? ` (skip ${phrase.length - 1})` : ""}`,
                                    );
                                    nextStates.push({
                                        stateId: trans.to,
                                        tokenIndex: tokenIndex + 1,
                                        path: [...state.path, trans.to],
                                        fixedStringPartCount:
                                            state.fixedStringPartCount +
                                            phrase.length,
                                        checkedWildcardCount:
                                            state.checkedWildcardCount,
                                        uncheckedWildcardCount:
                                            state.uncheckedWildcardCount,
                                        ruleIndex: state.ruleIndex,
                                        actionValue: state.actionValue,
                                        environment: state.environment,
                                        slotMap: state.slotMap,
                                        skipCount:
                                            phrase.length > 1
                                                ? phrase.length - 1
                                                : undefined,
                                    });
                                    allVisitedStates.add(trans.to);
                                }
                            }
                        }
                    }
                    continue; // phraseSet handled above
                }

                const result = tryTransition(
                    nfa,
                    trans,
                    token,
                    state,
                    tokenIndex,
                    tokens,
                );
                if (result) {
                    debugNFA(
                        `    Transition ${trans.type} → state ${result.stateId} succeeded${result.skipCount ? ` (skip ${result.skipCount})` : ""}`,
                    );
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
    debugNFA(
        `After all tokens, currentStates: ${currentStates.length}, accepting states: [${nfa.acceptingStates.join(", ")}]`,
    );

    // DEBUG: Count State 1 entries in currentStates
    const state1Entries = currentStates.filter((s) => s.stateId === 1);
    debugNFA(
        `DEBUG: Found ${state1Entries.length} State 1 entries in currentStates`,
    );
    for (const s1 of state1Entries) {
        debugNFA(
            `DEBUG: State 1 entry - slots: ${JSON.stringify(s1.environment?.slots)}, hash: ${getSlotHash(s1.environment)}`,
        );
    }

    const acceptingThreads: NFAMatchResult[] = [];
    for (const state of currentStates) {
        debugNFA(
            `  Checking state ${state.stateId}, is accepting: ${nfa.acceptingStates.includes(state.stateId)}`,
        );
        if (nfa.acceptingStates.includes(state.stateId)) {
            // Evaluate the actionValue using the environment's slot values
            let evaluatedActionValue = state.actionValue;
            debugNFA(
                `  Accept state details: hasActionValue=${!!state.actionValue}, hasEnv=${!!state.environment}, hasSlotMap=${!!state.slotMap}`,
            );
            if (state.environment) {
                debugNFA(
                    `    Environment slots: ${JSON.stringify(state.environment.slots)}`,
                );
            }
            if (state.slotMap) {
                debugNFA(
                    `    SlotMap (debug): ${JSON.stringify([...state.slotMap.entries()])}`,
                );
            }
            // actionValue is a compiled ValueExpression with slot indices
            // Evaluate it using the environment's slot values
            if (state.actionValue && state.environment) {
                try {
                    evaluatedActionValue = evaluateExpression(
                        state.actionValue,
                        state.environment,
                    );
                    debugNFA(
                        `  Evaluated actionValue: ${JSON.stringify(evaluatedActionValue)}`,
                    );
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
        debugNFA(
            `SUCCESS: Best match has ${sorted[0].fixedStringPartCount} fixed, ${sorted[0].checkedWildcardCount} checked, ${sorted[0].uncheckedWildcardCount} unchecked`,
        );
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
// Maximum number of extra tokens to look ahead for multi-token entity matching
const MAX_ENTITY_LOOKAHEAD = 3;

function tryTransition(
    nfa: NFA,
    trans: NFATransition,
    token: string,
    currentState: NFAExecutionState,
    tokenIndex: number,
    tokens?: string[],
): NFAExecutionState | undefined {
    switch (trans.type) {
        case "token":
            // Match specific token(s); normalize input token so that
            // case and trailing punctuation don't prevent a match
            if (trans.tokens && trans.tokens.includes(normalizeToken(token))) {
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
            let skipCount = 0;

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
                    const validator = globalEntityRegistry.getValidator(
                        trans.typeName,
                    );
                    const isBuiltInWildcardType =
                        trans.typeName === "wildcard" ||
                        trans.typeName === "string" ||
                        trans.typeName === "word";

                    if (validator) {
                        if (!validator.validate(token)) {
                            // Single-token validation failed — try multi-token
                            // lookahead for entity types (e.g. "from 1-2pm"
                            // as CalendarTimeRange)
                            if (tokens && !isBuiltInWildcardType) {
                                const multiResult = tryMultiTokenEntity(
                                    trans,
                                    tokens,
                                    tokenIndex,
                                    currentState,
                                    validator,
                                );
                                if (multiResult) {
                                    return multiResult;
                                }
                            }
                            return undefined; // Validation failed
                        }
                    } else if (!isBuiltInWildcardType) {
                        return undefined; // No validator for custom entity type
                    }
                    // Try converter if available
                    const converter = globalEntityRegistry.getConverter(
                        trans.typeName,
                    );
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
                (trans.typeName &&
                    trans.typeName !== "string" &&
                    trans.typeName !== "wildcard");

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
                skipCount,
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
 * Try to match a multi-token span against an entity type.
 * Called when single-token validation fails for a typed wildcard.
 * Tries progressively longer spans (maximal match first) by joining
 * tokens[tokenIndex..tokenIndex+len] and testing against the validator.
 *
 * Returns an NFAExecutionState with skipCount set to skip the extra tokens,
 * or undefined if no multi-token span validates.
 */
function tryMultiTokenEntity(
    trans: NFATransition,
    tokens: string[],
    tokenIndex: number,
    currentState: NFAExecutionState,
    validator: { validate(token: string): boolean },
): NFAExecutionState | undefined {
    const maxLen = Math.min(
        MAX_ENTITY_LOOKAHEAD + 1,
        tokens.length - tokenIndex,
    );

    // Try longest spans first (maximal munch)
    for (let len = maxLen; len >= 2; len--) {
        const span = tokens.slice(tokenIndex, tokenIndex + len).join(" ");
        if (!validator.validate(span)) {
            continue;
        }

        // Multi-token span validated — try converter
        let slotValue: string | number = span;
        const converter = globalEntityRegistry.getConverter(trans.typeName!);
        if (converter) {
            const converted = converter.convert(span);
            if (converted === undefined) {
                continue; // Conversion failed for this span length
            }
            slotValue = converted as string | number;
        }

        debugNFA(
            `    Multi-token entity: "${span}" (${len} tokens) matched ${trans.typeName}, skip ${len - 1}`,
        );

        // Write to slot
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

        return {
            stateId: trans.to,
            tokenIndex: tokenIndex + 1,
            path: [...currentState.path, trans.to],
            fixedStringPartCount: currentState.fixedStringPartCount,
            checkedWildcardCount: currentState.checkedWildcardCount + 1,
            uncheckedWildcardCount: currentState.uncheckedWildcardCount,
            ruleIndex: currentState.ruleIndex,
            actionValue: currentState.actionValue,
            environment: newEnvironment,
            slotMap: currentState.slotMap,
            skipCount: len - 1,
        };
    }

    return undefined;
}

/**
 * Get the depth of an environment (number of levels including the current one)
 * Used to distinguish paths with different nesting levels
 */
function getEnvironmentDepth(env: Environment | undefined): number {
    let depth = 0;
    while (env) {
        depth++;
        env = env.parent;
    }
    return depth;
}

/**
 * Generate a simple hash of the environment's slot values
 * This is used to distinguish execution threads that have the same state ID and priorities
 * but different slot values (i.e., different matching results)
 */
function getSlotHash(
    env: Environment | undefined,
    debug: boolean = false,
): string {
    if (!env || env.slots.length === 0) {
        return "empty";
    }

    // Create a simple hash from slot values
    // For performance, we only look at the first slot (which typically contains the result)
    // and create a hash based on its type and basic content
    const slot = env.slots[0];
    if (slot === undefined) {
        return "undef";
    }
    if (slot === null) {
        return "null";
    }
    if (typeof slot === "string") {
        // Use first 20 chars + length for string hash
        return `s:${slot.length}:${slot.substring(0, 20)}`;
    }
    if (typeof slot === "number") {
        return `n:${slot}`;
    }
    if (typeof slot === "object") {
        // For objects, use a simple structural hash
        // Check for action objects specifically
        if ("actionName" in slot) {
            const action = slot as { actionName: string; parameters?: object };
            const params = action.parameters;
            const paramKeys = params ? Object.keys(params) : [];
            const paramCount = paramKeys.length;
            const paramKeysStr = paramKeys.sort().join(",");

            if (debug) {
                debugNFA(
                    `  getSlotHash DEBUG: params=${JSON.stringify(params)}, paramKeys=[${paramKeys.join(",")}], paramCount=${paramCount}`,
                );
            }

            return `a:${action.actionName}:${paramCount}:${paramKeysStr}`;
        }
        // For other objects, use key count
        return `o:${Object.keys(slot).length}`;
    }
    return "other";
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
    // Track visited states by (stateId, fixedCount, checkedCount, uncheckedCount, envDepth) tuple
    // to allow multiple threads at the same NFA state with different priority counts or env depths
    const visited = new Set<string>();
    const queue = [...states];

    while (queue.length > 0) {
        const state = queue.shift()!;

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

        // Create unique key for this execution thread AFTER environment is determined
        // Include environment depth so paths with different nesting levels don't collide
        // Also include a hash of the first slot value to distinguish threads with different results
        const envDepth = getEnvironmentDepth(currentEnvironment);

        // DEBUG: Log before hash computation for State 1
        if (state.stateId === 1) {
            const slot0 = currentEnvironment?.slots?.[0];
            debugNFA(
                `DEBUG STATE 1 BEFORE HASH: slots[0]=${JSON.stringify(slot0)}, slot0 type=${typeof slot0}`,
            );
            // Check all levels of the environment
            let env = currentEnvironment;
            let level = 0;
            while (env) {
                debugNFA(
                    `  Level ${level}: slots=${JSON.stringify(env.slots)}, hash=${getSlotHash({ ...env, parent: undefined })}`,
                );
                env = env.parent;
                level++;
            }
        }

        const slotHash = getSlotHash(currentEnvironment, state.stateId === 1);
        const skipPart = state.skipCount ? `-skip${state.skipCount}` : "";
        const key = `${state.stateId}-${state.fixedStringPartCount}-${state.checkedWildcardCount}-${state.uncheckedWildcardCount}-${envDepth}-${slotHash}${skipPart}`;

        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

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
        // IMPORTANT: Deep clone the environment to prevent later mutations
        // from affecting this state's data
        const frozenEnvironment = currentEnvironment
            ? deepCloneEnvironment(currentEnvironment)
            : undefined;
        const updatedState: NFAExecutionState = {
            ...state,
            ruleIndex: currentRuleIndex,
            actionValue: currentActionValue,
            environment: frozenEnvironment,
            slotMap: currentSlotMap,
        };

        // DEBUG: Track State 1 additions
        if (state.stateId === 1) {
            const existingState1Count = result.filter(
                (s) => s.stateId === 1,
            ).length;
            // Check if currentEnvironment slots differ from frozenEnvironment
            const currentSlot0 = currentEnvironment?.slots?.[0];
            const frozenSlot0 = frozenEnvironment?.slots?.[0];
            debugNFA(
                `DEBUG STATE 1 ADDING: key=${key}, existing State 1 count=${existingState1Count}`,
            );
            debugNFA(
                `  currentEnvironment.slots[0] = ${JSON.stringify(currentSlot0)}`,
            );
            debugNFA(
                `  frozenEnvironment.slots[0] = ${JSON.stringify(frozenSlot0)}`,
            );
            if (
                currentSlot0 &&
                typeof currentSlot0 === "object" &&
                "parameters" in currentSlot0
            ) {
                debugNFA(
                    `  currentSlot0.parameters = ${JSON.stringify(currentSlot0.parameters)}`,
                );
            }
        }

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
                        // IMPORTANT: Clone the parent environment before writing to avoid
                        // mutation affecting other execution paths that share the same parent
                        // DEEP CLONE: Also clone the parent's parent chain to prevent shared mutations
                        const clonedParent = deepCloneEnvironment(
                            currentEnvironment.parent,
                        );
                        // Write to the cloned parent's slot
                        setSlotValue(
                            clonedParent,
                            currentEnvironment.parentSlotIndex,
                            evaluatedValue,
                        );
                        debugNFA(
                            `  WriteToParent: evaluated -> ${JSON.stringify(evaluatedValue)?.substring(0, 50)}, wrote to slot ${currentEnvironment.parentSlotIndex}`,
                        );
                        // Pop back to the cloned parent environment
                        newEnvironment = clonedParent;
                    } catch (e) {
                        debugNFA(`  WriteToParent failed: ${e}`);
                        // On error, still pop to parent (unmodified)
                        newEnvironment = currentEnvironment.parent;
                    }
                    // Restore slotMap from parent environment if available
                    if (newEnvironment?.slotMap) {
                        newSlotMap = newEnvironment.slotMap;
                    }
                    // Restore actionValue from parent environment if available
                    if (newEnvironment?.actionValue !== undefined) {
                        newActionValue = newEnvironment.actionValue;
                    }
                } else if (
                    trans.popEnvironment &&
                    currentEnvironment &&
                    currentEnvironment.parent
                ) {
                    // Pop environment without writing - used when exiting nested rules
                    // that don't capture to parent (e.g., (<Item>)?)
                    debugNFA(
                        `  PopEnvironment: popping from depth ${getEnvironmentDepth(currentEnvironment)} to ${getEnvironmentDepth(currentEnvironment.parent)}`,
                    );
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
 * 2. More verified parts (fixed strings + checked/entity wildcards combined)
 *    Entity-validated matches (e.g. CalendarTimeRange) are as trustworthy
 *    as fixed string matches — both confirm the token's role.
 * 3. Fewer unchecked wildcards > more unchecked wildcards
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

        // Rule 2: Prefer more verified parts (fixed + checked combined)
        const aVerified = a.fixedStringPartCount + a.checkedWildcardCount;
        const bVerified = b.fixedStringPartCount + b.checkedWildcardCount;
        if (aVerified !== bVerified) {
            return bVerified - aVerified;
        }

        // Rule 3: Prefer fewer unchecked wildcards
        return a.uncheckedWildcardCount - b.uncheckedWildcardCount;
    });
}
