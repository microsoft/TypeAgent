// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DFA, DFASlotOperation, DFATransition } from "./dfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";
import { normalizeToken } from "./nfaMatcher.js";
import { applySplitToTokens } from "./tokenSplit.js";
import { matchNFA } from "./nfaInterpreter.js";
import type { NFAMatchResult } from "./nfaInterpreter.js";

/**
 * Environment for slot-based variable storage
 * Matches the NFA interpreter's environment structure
 */
interface DFAEnvironment {
    slots: (string | number | undefined)[];
    parent?: DFAEnvironment | undefined;
    parentSlotIndex?: number | undefined;
    /** Debug: slot map saved at pushEnv time for restoration at popEnv (debug only) */
    parentDebugSlotMap?: Map<string, number> | undefined;
}

/**
 * Result of matching tokens against a DFA
 */
export interface DFAMatchResult {
    /** Whether the input was accepted */
    matched: boolean;

    /** Evaluated action value from the matched rule */
    actionValue?: any | undefined;

    /** Priority counts for ranking */
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;

    /** Number of tokens consumed */
    tokensConsumed: number;

    /** Rule index from the original Grammar.rules array (if matched) */
    ruleIndex?: number | undefined;

    /** For debugging: states visited */
    visitedStates?: number[];

    /** For debugging: slot map at end of match (variable name -> slot index) */
    debugSlotMap?: Map<string, number> | undefined;

    /** For debugging: raw slot values at end of match */
    debugSlots?: (string | number | undefined)[] | undefined;
}

/**
 * Create a new environment with the given slot count
 */
function createEnvironment(
    slotCount: number,
    parent?: DFAEnvironment,
    parentSlotIndex?: number,
): DFAEnvironment {
    return {
        slots: new Array(slotCount).fill(undefined),
        parent,
        parentSlotIndex,
    };
}

/**
 * Set a slot value in the environment
 * If append is true and the slot already has a string value, concatenate with space
 */
function setSlotValue(
    env: DFAEnvironment,
    slotIndex: number,
    value: string | number,
    append: boolean = false,
): void {
    if (
        append &&
        typeof env.slots[slotIndex] === "string" &&
        typeof value === "string"
    ) {
        env.slots[slotIndex] = env.slots[slotIndex] + " " + value;
    } else {
        env.slots[slotIndex] = value;
    }
}

/**
 * Evaluate a compiled value expression using the environment slots
 * This mirrors the NFA interpreter's evaluateActionValue function
 */
function evaluateActionValue(env: DFAEnvironment, valueExpr: any): any {
    if (valueExpr === undefined || valueExpr === null) {
        return valueExpr;
    }

    // Handle different value expression types
    if (typeof valueExpr === "object") {
        if (valueExpr.type === "literal") {
            return valueExpr.value;
        }

        if (valueExpr.type === "variable") {
            // Look up by slot index if available, otherwise by name in slotMap
            if (valueExpr.slotIndex !== undefined) {
                let value = env.slots[valueExpr.slotIndex];
                // Convert to number if typeName indicates number type
                if (
                    valueExpr.typeName === "number" &&
                    typeof value === "string"
                ) {
                    const num = parseFloat(value);
                    if (!isNaN(num)) {
                        value = num;
                    }
                }
                return value;
            }
            // Fallback: return undefined for unresolved variables
            return undefined;
        }

        if (valueExpr.type === "object") {
            const result: Record<string, any> = {};
            // Handle both formats: environment.ts uses .properties (Map), grammar parser uses .value (object)
            if (valueExpr.properties instanceof Map) {
                for (const [key, val] of valueExpr.properties) {
                    result[key] = evaluateActionValue(env, val);
                }
            } else if (valueExpr.value) {
                for (const [key, val] of Object.entries(valueExpr.value)) {
                    result[key] = evaluateActionValue(env, val);
                }
            }
            return result;
        }

        if (valueExpr.type === "array") {
            // Handle both formats: environment.ts uses .elements, grammar parser uses .value
            const arr = valueExpr.elements || valueExpr.value;
            return (arr as any[]).map((v) => evaluateActionValue(env, v));
        }

        if (valueExpr.type === "action") {
            const params: Record<string, any> = {};
            // Handle both formats: environment.ts uses .parameters (Map), grammar parser uses .value
            if (valueExpr.parameters instanceof Map) {
                for (const [key, val] of valueExpr.parameters) {
                    params[key] = evaluateActionValue(env, val);
                }
            }
            // Only include parameters if there are any (actions like pause/resume have none)
            if (Object.keys(params).length > 0) {
                return {
                    actionName: valueExpr.actionName,
                    parameters: params,
                };
            }
            return {
                actionName: valueExpr.actionName,
            };
        }
    }

    // Primitive value - return as-is
    return valueExpr;
}

/**
 * Apply slot operations to the environment stack.
 * @param ops         Slot operations to execute
 * @param envStack    Mutable stack of environments (mutated in place)
 * @param consumedValue The token/value just consumed (for writeSlot ops)
 * @param debugSlotMapRef Mutable ref-box for the active debug slot map (for pushEnv/popEnv)
 */
function applySlotOps(
    ops: DFASlotOperation[] | undefined,
    envStack: DFAEnvironment[],
    consumedValue?: string | number,
    debugSlotMapRef?: { value: Map<string, number> | undefined },
): void {
    if (!ops || ops.length === 0) return;

    for (const op of ops) {
        const currentEnv = envStack[envStack.length - 1];
        if (!currentEnv) continue;

        switch (op.type) {
            case "pushEnv": {
                // Create new environment and push onto stack
                const newEnv = createEnvironment(
                    op.slotCount || 0,
                    currentEnv,
                    op.parentSlotIndex,
                );
                // Save parent debug slot map for restoration at popEnv
                if (debugSlotMapRef) {
                    newEnv.parentDebugSlotMap = debugSlotMapRef.value;
                }
                envStack.push(newEnv);
                break;
            }

            case "writeSlot": {
                if (op.slotIndex !== undefined && consumedValue !== undefined) {
                    setSlotValue(
                        currentEnv,
                        op.slotIndex,
                        consumedValue,
                        op.append,
                    );
                }
                break;
            }

            case "evalAndWriteToParent": {
                if (
                    currentEnv.parent &&
                    currentEnv.parentSlotIndex !== undefined
                ) {
                    const value = evaluateActionValue(currentEnv, op.valueExpr);
                    currentEnv.parent.slots[currentEnv.parentSlotIndex] = value;
                }
                break;
            }

            case "popEnv": {
                if (envStack.length > 1) {
                    const popped = envStack.pop()!;
                    // Restore parent debug slot map (debug only)
                    if (debugSlotMapRef) {
                        debugSlotMapRef.value = popped.parentDebugSlotMap;
                    }
                }
                break;
            }
        }
    }
}

/**
 * Adapt an NFAMatchResult to the DFAMatchResult interface.
 * Used when matchDFA delegates value computation to the NFA interpreter.
 */
function adaptNFAResult(
    nfaResult: NFAMatchResult,
    tokensLength: number,
): DFAMatchResult {
    if (!nfaResult.matched) {
        return {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            tokensConsumed: nfaResult.tokensConsumed ?? tokensLength,
        };
    }
    const result: DFAMatchResult = {
        matched: true,
        actionValue: nfaResult.actionValue,
        fixedStringPartCount: nfaResult.fixedStringPartCount,
        checkedWildcardCount: nfaResult.checkedWildcardCount,
        uncheckedWildcardCount: nfaResult.uncheckedWildcardCount,
        tokensConsumed: nfaResult.tokensConsumed ?? tokensLength,
    };
    if (nfaResult.ruleIndex !== undefined) {
        result.ruleIndex = nfaResult.ruleIndex;
    }
    if (nfaResult.visitedStates) {
        result.visitedStates = nfaResult.visitedStates;
    }
    if (nfaResult.debugSlotMap) {
        result.debugSlotMap = nfaResult.debugSlotMap;
    }
    return result;
}

/** Maximum number of extra tokens to try when validating a multi-token entity */
const MAX_ENTITY_LOOKAHEAD = 4;

/**
 * Try to match a checked entity wildcard spanning more than one token.
 * Returns the captured value and the total span length (>= 2), or undefined
 * if no multi-token span validates.
 */
function tryMultiTokenSpan(
    tokens: string[],
    startIndex: number,
    typeName: string,
): { value: string | object; spanLen: number } | undefined {
    const validator = globalEntityRegistry.getValidator(typeName);
    if (!validator) return undefined;

    const maxLen = Math.min(
        MAX_ENTITY_LOOKAHEAD + 1,
        tokens.length - startIndex,
    );

    // Try longest spans first (maximal munch)
    for (let len = maxLen; len >= 2; len--) {
        const span = tokens.slice(startIndex, startIndex + len).join(" ");
        if (!validator.validate(span)) continue;

        // Try to convert the span
        const converter = globalEntityRegistry.getConverter(typeName);
        if (converter) {
            const converted = converter.convert(span);
            if (converted === undefined) continue;
            return { value: converted as string | object, spanLen: len };
        }
        return { value: span, spanLen: len };
    }
    return undefined;
}

/**
 * O(tokens) DFA accept/reject decision — no value computation.
 *
 * Walks the precomputed DFA state machine:
 *   - specific token match  → follow token transition
 *   - phraseSet match       → follow phraseSet transition (multi-token with skipCount)
 *   - wildcard fallback     → follow wildcard transition for any unmatched token
 *   - no transition         → reject immediately
 *
 * Returns true only if all tokens are consumed and the final state is accepting.
 * Entity wildcard type-checking is intentionally skipped here — the DFA wildcard
 * transition is followed for any token (conservative: may produce false positives).
 * False positives mean an unnecessary NFA call; false negatives are impossible.
 */
function dfaAccepts(dfa: DFA, tokens: string[]): boolean {
    let stateId = dfa.startState;
    let i = 0;

    while (i < tokens.length) {
        const token = normalizeToken(tokens[i]);
        const state = dfa.states[stateId];
        if (!state) return false;

        // Try specific token transition
        let next: number | undefined;
        for (const t of state.transitions) {
            if (t.token === token) {
                next = t.to;
                break;
            }
        }

        // Try phraseSet transitions (proper multi-token check, no slot ops)
        let phraseSkip = 0;
        if (next === undefined && state.phraseSetTransitions) {
            for (const pst of state.phraseSetTransitions) {
                const matcher = globalPhraseSetRegistry.getMatcher(
                    pst.matcherName,
                );
                if (!matcher) continue;
                for (const phrase of matcher.phrases) {
                    if (i + phrase.length > tokens.length) continue;
                    if (
                        phrase.every(
                            (p, pi) => normalizeToken(tokens[i + pi]) === p,
                        )
                    ) {
                        next = pst.to;
                        phraseSkip = phrase.length - 1;
                        break;
                    }
                }
                if (next !== undefined) break;
            }
        }

        // Wildcard fallback (conservative: accept any token, skip entity validation)
        if (next === undefined && state.wildcardTransition) {
            next = state.wildcardTransition.to;
        }

        if (next === undefined) return false;
        stateId = next;
        i += 1 + phraseSkip;
    }

    return dfa.states[stateId]?.accepting ?? false;
}

/**
 * Match tokens against a DFA
 *
 * When the DFA carries its source NFA (dfa.sourceNFA), value computation is
 * delegated to the NFA interpreter, which correctly maintains one environment
 * per live NFA thread.  This handles multi-word wildcards (appendToSlot), Kleene
 * plus loops, entity wildcards, and any other pattern where multiple NFA paths
 * share a DFA state — all cases where the old single-envStack approach was wrong.
 *
 * The DFA pre-filters with a fast O(tokens) state-machine walk before committing
 * to NFA threading.  Non-matching inputs are rejected without spawning any NFA
 * threads — 100–460× faster than full NFA match for the rejection case.
 *
 * The DFA structure is also used for the getDFACompletions path (prefix traversal
 * and completion generation stay deterministic and fast).
 *
 * @param dfa The DFA to match against
 * @param tokens Array of tokens to match
 * @param debugMode Whether to track visited states for debugging
 * @returns Match result with actionValue and priority
 */
export function matchDFA(
    dfa: DFA,
    tokens: string[],
    debugMode: boolean = false,
): DFAMatchResult {
    if (dfa.sourceNFA) {
        // Fast pre-filter: O(tokens) DFA traversal before paying for NFA threading.
        // dfaAccepts is conservative (wildcards skip entity validation) so it never
        // produces false negatives — any input it rejects the NFA would also reject.
        if (!dfaAccepts(dfa, tokens)) {
            return {
                matched: false,
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                tokensConsumed: tokens.length,
            };
        }
        // DFA accepted — delegate to NFA for correct value computation
        const nfaResult = matchNFA(dfa.sourceNFA, tokens, debugMode);
        return adaptNFAResult(nfaResult, tokens.length);
    }

    let currentStateId = dfa.startState;
    const visitedStates: number[] = debugMode ? [currentStateId] : [];

    // Initialize environment stack
    const envStack: DFAEnvironment[] = [createEnvironment(32)];

    // Debug slot map reference — updated by pushEnv/popEnv operations
    const debugSlotMapRef: { value: Map<string, number> | undefined } = {
        value: undefined,
    };

    // Runtime priority counters (more accurate than compile-time bestPriority)
    let fixedStringPartCount = 0;
    let checkedWildcardCount = 0;
    let uncheckedWildcardCount = 0;

    // skipCount: number of tokens to skip after a multi-token entity or multi-token phrase
    let skipCount = 0;

    // Process each token
    for (let i = 0; i < tokens.length; i++) {
        // Skip tokens that were consumed as part of a multi-token span
        if (skipCount > 0) {
            skipCount--;
            continue;
        }

        const token = tokens[i];
        const currentState = dfa.states[currentStateId];

        if (!currentState) {
            const result: DFAMatchResult = {
                matched: false,
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                tokensConsumed: i,
            };
            if (debugMode) {
                result.visitedStates = visitedStates;
            }
            return result;
        }

        // Try to find a matching token transition (normalized comparison)
        let nextStateId: number | undefined;
        let matchedTransition: DFATransition | undefined;
        const normalizedToken = normalizeToken(token);

        for (const trans of currentState.transitions) {
            if (trans.token === normalizedToken) {
                nextStateId = trans.to;
                matchedTransition = trans;
                break;
            }
        }

        // If token matched, apply slot operations and update priority
        if (matchedTransition) {
            applySlotOps(
                matchedTransition.preOps,
                envStack,
                undefined,
                debugSlotMapRef,
            );
            applySlotOps(
                matchedTransition.postOps,
                envStack,
                undefined,
                debugSlotMapRef,
            );
            fixedStringPartCount++;
        }

        // If no token match, try wildcard
        if (nextStateId === undefined && currentState.wildcardTransition) {
            const wildcard = currentState.wildcardTransition;

            // Find the best-priority match among captureInfo entries.
            // Checked (entity-typed) captures take priority over unchecked ones:
            // try each checked entry in order and use the first that validates.
            let isChecked = false;
            let capturedValue: string | number | object = token;

            for (const capture of wildcard.captureInfo) {
                const capTypeName = capture.typeName;
                const entryIsChecked =
                    capture.checked === true ||
                    !!(capTypeName && capTypeName !== "string");
                if (!entryIsChecked) continue; // handle unchecked as fallback

                if (capTypeName === "number") {
                    const num = parseFloat(token);
                    if (!isNaN(num)) {
                        isChecked = true;
                        capturedValue = num;
                        break;
                    }
                } else if (capTypeName && capTypeName !== "string") {
                    const validator =
                        globalEntityRegistry.getValidator(capTypeName);
                    if (validator) {
                        if (validator.validate(token)) {
                            const converter =
                                globalEntityRegistry.getConverter(capTypeName);
                            if (converter) {
                                const converted = converter.convert(token);
                                if (converted !== undefined) {
                                    isChecked = true;
                                    capturedValue = converted as
                                        | string
                                        | number
                                        | object;
                                    break;
                                }
                            } else {
                                isChecked = true;
                                break;
                            }
                        } else {
                            // Single token didn't validate — try multi-token span
                            const multiResult = tryMultiTokenSpan(
                                tokens,
                                i,
                                capTypeName,
                            );
                            if (multiResult) {
                                isChecked = true;
                                capturedValue = multiResult.value;
                                skipCount = multiResult.spanLen - 1;
                                break;
                            }
                        }
                    }
                }
            }

            nextStateId = wildcard.to;

            // Apply preOps before consuming
            applySlotOps(wildcard.preOps, envStack, undefined, debugSlotMapRef);

            // Apply consumeOp (write to slot)
            if (wildcard.consumeOp) {
                applySlotOps(
                    [wildcard.consumeOp],
                    envStack,
                    capturedValue as string | number,
                    debugSlotMapRef,
                );
            }

            // Apply postOps after consuming
            applySlotOps(
                wildcard.postOps,
                envStack,
                undefined,
                debugSlotMapRef,
            );

            if (isChecked) {
                checkedWildcardCount++;
            } else {
                uncheckedWildcardCount++;
            }
        }

        // If no token or wildcard match, try phraseSet transitions
        if (nextStateId === undefined && currentState.phraseSetTransitions) {
            for (const pst of currentState.phraseSetTransitions) {
                const matcher = globalPhraseSetRegistry.getMatcher(
                    pst.matcherName,
                );
                if (!matcher) continue;

                for (const phrase of matcher.phrases) {
                    if (i + phrase.length > tokens.length) continue;
                    const allMatch = phrase.every(
                        (p, pi) => normalizeToken(tokens[i + pi]) === p,
                    );
                    if (allMatch) {
                        applySlotOps(
                            pst.preOps,
                            envStack,
                            undefined,
                            debugSlotMapRef,
                        );
                        applySlotOps(
                            pst.postOps,
                            envStack,
                            undefined,
                            debugSlotMapRef,
                        );
                        nextStateId = pst.to;
                        if (phrase.length > 1) {
                            skipCount = phrase.length - 1;
                        }
                        fixedStringPartCount += phrase.length;
                        break;
                    }
                }
                if (nextStateId !== undefined) break;
            }
        }

        // If still no match, fail
        if (nextStateId === undefined) {
            const result: DFAMatchResult = {
                matched: false,
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                tokensConsumed: i,
            };
            if (debugMode) {
                result.visitedStates = visitedStates;
            }
            return result;
        }

        currentStateId = nextStateId;
        if (debugMode) {
            visitedStates.push(currentStateId);
        }
    }

    // Check if we're in an accepting state
    const finalState = dfa.states[currentStateId];
    if (!finalState || !finalState.accepting) {
        const result: DFAMatchResult = {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            tokensConsumed: tokens.length,
        };
        if (debugMode) {
            result.visitedStates = visitedStates;
        }
        return result;
    }

    // Evaluate action value using the current environment
    const currentEnv = envStack[envStack.length - 1];
    let actionValue: any = undefined;

    if (finalState.actionValue !== undefined) {
        actionValue = evaluateActionValue(currentEnv, finalState.actionValue);
    }

    const bestContext = finalState.bestPriority
        ? finalState.contexts[finalState.bestPriority.contextIndex]
        : undefined;

    const result: DFAMatchResult = {
        matched: true,
        actionValue,
        // Use runtime counts (more accurate than compile-time bestPriority)
        fixedStringPartCount,
        checkedWildcardCount,
        uncheckedWildcardCount,
        tokensConsumed: tokens.length,
    };

    // Include rule index if available
    if (bestContext?.ruleIndex !== undefined) {
        result.ruleIndex = bestContext.ruleIndex;
    }

    // Include debug info
    if (debugMode) {
        result.visitedStates = visitedStates;
        const slotMap = debugSlotMapRef.value ?? finalState.debugSlotMap;
        if (slotMap) {
            result.debugSlotMap = slotMap;
        }
        if (currentEnv) {
            result.debugSlots = [...currentEnv.slots];
        }
    }

    return result;
}

/**
 * Compare two DFA match results using the same 3-rule priority as sortNFAMatches:
 * 1. Prefer no unchecked wildcards
 * 2. Prefer more fixed string parts
 * 3. Prefer more checked wildcards
 * Returns negative if a is better, positive if b is better, 0 if equal.
 */
function compareDFAMatchPriority(a: DFAMatchResult, b: DFAMatchResult): number {
    if (a.uncheckedWildcardCount === 0 && b.uncheckedWildcardCount !== 0)
        return -1;
    if (a.uncheckedWildcardCount !== 0 && b.uncheckedWildcardCount === 0)
        return 1;
    if (a.fixedStringPartCount !== b.fixedStringPartCount)
        return b.fixedStringPartCount - a.fixedStringPartCount;
    if (a.checkedWildcardCount !== b.checkedWildcardCount)
        return b.checkedWildcardCount - a.checkedWildcardCount;
    return a.uncheckedWildcardCount - b.uncheckedWildcardCount;
}

/**
 * Match tokens against a DFA, performing a two-pass split-candidate strategy
 * when the DFA has split candidates (for spacing=optional/auto grammars).
 *
 * Pass 1 — original whitespace tokens.
 * Pass 2 — pre-split tokens using dfa.splitCandidates (e.g. "Swift's" → ["Swift", "'s"]).
 * The higher-priority result is returned.
 */
export function matchDFAWithSplitting(
    dfa: DFA,
    tokens: string[],
    debugMode: boolean = false,
): DFAMatchResult {
    const origResult = matchDFA(dfa, tokens, debugMode);

    if (!dfa.splitCandidates?.length) return origResult;

    const splitTokens = applySplitToTokens(tokens, dfa.splitCandidates);
    if (!splitTokens) return origResult;

    const splitResult = matchDFA(dfa, splitTokens, debugMode);
    if (!splitResult.matched) return origResult;
    if (!origResult.matched) return splitResult;

    return compareDFAMatchPriority(origResult, splitResult) <= 0
        ? origResult
        : splitResult;
}

/**
 * Information about a wildcard parameter for completion
 */
export interface WildcardCompletionInfo {
    /** Variable name from the grammar (e.g., "trackName", "artist") */
    variable: string;

    /** Type name for entity resolution (e.g., "TrackName", "ArtistName", "MusicDevice", "string", "number") */
    typeName?: string;

    /** Whether this wildcard is checked (has validation) */
    checked: boolean;

    /** Display string (e.g., "$(trackName)", "$(artist:ArtistName)") */
    displayString: string;
}

/**
 * Completion for a specific rule/action
 */
export interface DFACompletionGroup {
    /** Rule index from Grammar.rules array */
    ruleIndex: number;

    /** Possible literal token completions for this rule */
    literalCompletions: string[];

    /** Wildcard completions with metadata for calling getActionCompletion */
    wildcardCompletions: WildcardCompletionInfo[];

    /** Legacy: All completions as strings (literals + wildcard display strings) */
    completions: string[];
}

/**
 * Property completion entry — mirrors GrammarCompletionProperty for parity with NFA
 */
export interface DFAPropertyCompletion {
    /** Action name (e.g., "play") */
    actionName: string;
    /** Property path in the action parameters (e.g., "parameters.artist") */
    propertyPath: string;
}

/**
 * Completion result for prefix matching
 */
export interface DFACompletionResult {
    /** Completions grouped by rule/action */
    groups: DFACompletionGroup[];

    /** Whether the prefix itself is a valid complete match */
    prefixMatches: boolean;

    /** Legacy: All completions (not grouped) - for backward compatibility */
    completions?: string[];

    /** Property completions from checked wildcards (parity with NFA computeNFACompletions) */
    properties?: DFAPropertyCompletion[];
}

/**
 * Get possible completions for a token prefix
 *
 * @param dfa The DFA to match against
 * @param tokens Prefix tokens already entered
 * @returns Grouped completions by rule and whether prefix is complete
 */
export function getDFACompletions(
    dfa: DFA,
    tokens: string[],
): DFACompletionResult {
    let currentStateId = dfa.startState;

    // Follow the prefix through the DFA
    let skipCount = 0;
    for (let pi = 0; pi < tokens.length; pi++) {
        if (skipCount > 0) {
            skipCount--;
            continue;
        }
        const token = tokens[pi];
        const normalizedToken = normalizeToken(token);
        const currentState = dfa.states[currentStateId];
        if (!currentState) {
            return { groups: [], prefixMatches: false, completions: [] };
        }

        // Find matching transition
        let nextStateId: number | undefined;

        for (const trans of currentState.transitions) {
            if (trans.token === normalizedToken) {
                nextStateId = trans.to;
                break;
            }
        }

        // Try wildcard if no token match
        if (nextStateId === undefined && currentState.wildcardTransition) {
            nextStateId = currentState.wildcardTransition.to;
        }

        // Try phraseSet transitions
        if (nextStateId === undefined && currentState.phraseSetTransitions) {
            for (const pst of currentState.phraseSetTransitions) {
                const matcher = globalPhraseSetRegistry.getMatcher(
                    pst.matcherName,
                );
                if (!matcher) continue;
                for (const phrase of matcher.phrases) {
                    if (pi + phrase.length > tokens.length) continue;
                    const allMatch = phrase.every(
                        (p, idx) => normalizeToken(tokens[pi + idx]) === p,
                    );
                    if (allMatch) {
                        nextStateId = pst.to;
                        if (phrase.length > 1) skipCount = phrase.length - 1;
                        break;
                    }
                }
                if (nextStateId !== undefined) break;
            }
        }

        if (nextStateId === undefined) {
            return { groups: [], prefixMatches: false, completions: [] };
        }

        currentStateId = nextStateId;
    }

    // Get completions from current state
    const currentState = dfa.states[currentStateId];
    if (!currentState) {
        return { groups: [], prefixMatches: false, completions: [] };
    }

    // Track which rules are active at this state
    const activeRules = new Set<number>();
    for (const context of currentState.contexts) {
        if (context.ruleIndex !== undefined) {
            activeRules.add(context.ruleIndex);
        }
    }

    // Collect token transitions - these apply to all active contexts
    const allTokens = new Set<string>();
    for (const trans of currentState.transitions) {
        allTokens.add(trans.token);
    }

    // Collect first token of each phrase set phrase as literal completions
    if (currentState.phraseSetTransitions) {
        for (const pst of currentState.phraseSetTransitions) {
            const matcher = globalPhraseSetRegistry.getMatcher(pst.matcherName);
            if (!matcher) continue;
            for (const phrase of matcher.phrases) {
                if (phrase.length > 0) {
                    allTokens.add(phrase[0]);
                }
            }
        }
    }

    // Collect wildcard completions with metadata
    const wildcardCompletionInfos: WildcardCompletionInfo[] = [];
    const wildcardDisplayStrings = new Set<string>();

    if (currentState.wildcardTransition) {
        // Group by unique variable name to avoid duplicates
        const seenVariables = new Set<string>();

        for (const captureInfo of currentState.wildcardTransition.captureInfo) {
            // Skip if we've already added this variable
            if (seenVariables.has(captureInfo.variable)) {
                continue;
            }
            seenVariables.add(captureInfo.variable);

            // Format display string: $(variable:type) or $(variable) for string type
            const typeDisplay =
                captureInfo.typeName && captureInfo.typeName !== "string"
                    ? `:${captureInfo.typeName}`
                    : "";
            const displayString = `$(${captureInfo.variable}${typeDisplay})`;

            const wildcardInfo: WildcardCompletionInfo = {
                variable: captureInfo.variable,
                checked: captureInfo.checked,
                displayString,
            };

            if (captureInfo.typeName !== undefined) {
                wildcardInfo.typeName = captureInfo.typeName;
            }

            wildcardCompletionInfos.push(wildcardInfo);
            wildcardDisplayStrings.add(displayString);
        }

        // If there are no specific captures, show generic wildcard
        if (currentState.wildcardTransition.captureInfo.length === 0) {
            wildcardDisplayStrings.add("*");
        }
    }

    // Build completion groups - one per active rule
    const groups: DFACompletionGroup[] = [];
    for (const ruleIndex of activeRules) {
        const allCompletionStrings = [
            ...Array.from(allTokens),
            ...Array.from(wildcardDisplayStrings),
        ];

        groups.push({
            ruleIndex,
            literalCompletions: Array.from(allTokens),
            wildcardCompletions: wildcardCompletionInfos,
            completions: allCompletionStrings,
        });
    }

    // Collect literal token completions only.
    // Wildcard display strings are NOT included here — this matches NFA completion
    // behavior where unchecked wildcards are dropped and checked wildcards appear
    // only in `properties`, never in the flat `completions` array.
    const allCompletions = new Set<string>();
    for (const token of allTokens) {
        allCompletions.add(token);
    }

    // Build property completions from checked wildcard captureInfo entries
    // (parity with NFA computeNFACompletions: checked wildcards with actionName/propertyPath)
    const properties: DFAPropertyCompletion[] = [];
    const seenPropertyKeys = new Set<string>();
    if (currentState.wildcardTransition) {
        for (const capture of currentState.wildcardTransition.captureInfo) {
            if (
                !capture.checked ||
                !capture.actionName ||
                !capture.propertyPath
            ) {
                continue;
            }
            const key = `${capture.actionName}:${capture.propertyPath}`;
            if (!seenPropertyKeys.has(key)) {
                seenPropertyKeys.add(key);
                properties.push({
                    actionName: capture.actionName,
                    propertyPath: capture.propertyPath,
                });
            }
        }
    }

    const result: DFACompletionResult = {
        groups,
        prefixMatches: currentState.accepting,
        completions: Array.from(allCompletions),
    };
    if (properties.length > 0) {
        result.properties = properties;
    }
    return result;
}

/**
 * Pretty print DFA for debugging
 */
export function printDFA(dfa: DFA): string {
    const lines: string[] = [];

    lines.push(`DFA: ${dfa.name || "(unnamed)"}`);
    lines.push(`  Start state: ${dfa.startState}`);
    lines.push(`  Accepting states: [${dfa.acceptingStates.join(", ")}]`);
    lines.push(`  States (${dfa.states.length}):`);

    for (const state of dfa.states) {
        const accepting = state.accepting ? " [ACCEPT]" : "";
        const priority = state.bestPriority
            ? ` (priority: ${state.bestPriority.fixedStringPartCount}f/${state.bestPriority.checkedWildcardCount}c/${state.bestPriority.uncheckedWildcardCount}u)`
            : "";

        lines.push(
            `    State ${state.id}${accepting}${priority} (${state.contexts.length} contexts):`,
        );

        if (state.transitions.length === 0 && !state.wildcardTransition) {
            lines.push(`      (no transitions)`);
        }

        for (const trans of state.transitions) {
            lines.push(`      [${trans.token}] -> ${trans.to}`);
        }

        if (state.wildcardTransition) {
            const captures = state.wildcardTransition.captureInfo
                .map((c) => `${c.variable}:${c.typeName || "string"}`)
                .join(", ");
            lines.push(
                `      * (${captures || "no captures"}) -> ${state.wildcardTransition.to}`,
            );
        }

        if (state.phraseSetTransitions) {
            for (const pst of state.phraseSetTransitions) {
                lines.push(`      <phraseSet:${pst.matcherName}> -> ${pst.to}`);
            }
        }
    }

    return lines.join("\n");
}
