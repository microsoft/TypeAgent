// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DFA,
    DFASlotOperation,
    DFATransition,
    type MatchAST,
    type MatchNode,
    type WildcardMatchNode,
} from "./dfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";
import { normalizeToken } from "./nfaMatcher.js";
import { applySplitToTokens } from "./tokenSplit.js";
import { matchNFA } from "./nfaInterpreter.js";
import type { NFAMatchResult } from "./nfaInterpreter.js";
import type { Grammar, CompiledValueNode } from "./grammarTypes.js";

// ─── DFA First-Token Index ──────────────────────────────────────────────────
// O(1) pre-filter: reject tokens whose first word can't start any DFA path.
// Built lazily from the DFA start state and cached per DFA object.

interface DFAFirstTokenIndex {
    readonly validFirstTokens: ReadonlySet<string>;
    readonly hasWildcardStart: boolean;
}

const dfaIndexCache = new WeakMap<DFA, DFAFirstTokenIndex>();

function getDFAIndex(dfa: DFA): DFAFirstTokenIndex {
    let idx = dfaIndexCache.get(dfa);
    if (!idx) {
        const startState = dfa.states[dfa.startState];
        const validFirstTokens = new Set<string>();
        if (startState) {
            for (const t of startState.transitions) {
                validFirstTokens.add(t.token);
            }
        }
        const hasWildcardStart =
            !!startState?.wildcardTransition ||
            !!startState?.phraseSetTransitions?.length;
        idx = { validFirstTokens, hasWildcardStart };
        dfaIndexCache.set(dfa, idx);
    }
    return idx;
}

function dfaFirstTokenRejects(dfa: DFA, tokens: string[]): boolean {
    if (tokens.length === 0) return false;
    const idx = getDFAIndex(dfa);
    if (idx.hasWildcardStart) return false;
    const firstToken = normalizeToken(tokens[0]);
    return !idx.validFirstTokens.has(firstToken);
}

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
                    !!(
                        capTypeName &&
                        capTypeName !== "string" &&
                        capTypeName !== "wildcard"
                    );
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
    if (finalState.ruleIndex !== undefined) {
        result.ruleIndex = finalState.ruleIndex;
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
    // O(1) first-token pre-filter
    if (dfaFirstTokenRejects(dfa, tokens)) {
        return {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            tokensConsumed: 0,
        };
    }

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
    const activeRules = new Set<number>(currentState.activeRuleIndices ?? []);

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

// ────────────────────────────────────────────────────────────────────────────
// AST-based DFA matching
//
// The DFA acts as a pure recognizer producing a MatchAST. Value computation
// is deferred to a bottom-up walk of the AST using the grammar's name-based
// CompiledValueNode expressions.
//
// Matching strategy: MINIMAL MUNCH with priorities
//   1. Try exact token transition (literal match)
//   2. Try longest prefix match (flex-space: grammar token is a prefix of input token)
//   3. Try phraseSet transitions (multi-token)
//   4. Wildcard fallback (consume 1 token)
//
// When a literal matches at a state that also has a wildcard, a decision point
// is recorded. If the match later fails validation, we backtrack to the decision
// point and let the wildcard absorb the literal instead.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a wildcardCaptureInfo object, conditionally including typeName.
 */
function buildCaptureInfo(capture: {
    variable: string;
    typeName?: string;
    checked: boolean;
}): { variable: string; typeName?: string; checked: boolean } {
    const info: { variable: string; typeName?: string; checked: boolean } = {
        variable: capture.variable,
        checked: capture.checked,
    };
    if (capture.typeName !== undefined) {
        info.typeName = capture.typeName;
    }
    return info;
}

/**
 * A snapshot of matcher state saved at a decision point for backtracking.
 *
 * Created when we choose a literal transition at a state that also has a
 * wildcard transition. If we later hit a dead end or validation fails,
 * we restore to this point and take the wildcard path instead.
 */
interface DecisionPoint {
    /** DFA state ID where the decision was made */
    stateId: number;
    /** Token index at the decision point */
    tokenIndex: number;
    /** Length of parts[] to restore to */
    partsLength: number;
    /** The wildcard target state to take on backtrack */
    wildcardTargetStateId: number;
    /** The active wildcard node being built (if any) before this decision */
    activeWildcard: WildcardMatchNode | undefined;
    /** Priority counters at the decision point */
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;
    /** Capture info from the wildcard transition */
    wildcardCaptureInfo: {
        variable: string;
        typeName?: string;
        checked: boolean;
    };
}

/**
 * Result of AST-based DFA matching
 */
export interface DFAASTMatchResult {
    /** Whether the input was accepted */
    matched: boolean;
    /** The parse tree (if matched) */
    ast?: MatchAST;
    /** Priority counts for ranking */
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;
    /** Number of tokens consumed */
    tokensConsumed: number;
    /** Rule index from Grammar.rules[] */
    ruleIndex?: number;
}

/**
 * Match tokens against a DFA, producing a MatchAST.
 *
 * Uses minimal munch: wildcards consume as few tokens as possible.
 * Literals are preferred over wildcards. When a literal is chosen at a state
 * that also has a wildcard, a decision point is recorded for backtracking.
 *
 * @param dfa The DFA to match against
 * @param tokens Array of tokens to match
 * @returns Match result with optional AST
 */

/**
 * Determine at match time whether a wildcard node is truly "checked"
 * (has a registered entity validator that accepts the captured text).
 * Mirrors the slot-based matcher logic: "wildcard" and "string" types are
 * always unchecked; other types are checked only if a validator confirms.
 */
function isRuntimeChecked(w: WildcardMatchNode): boolean {
    const typeName = w.typeName;
    if (!typeName || typeName === "string" || typeName === "wildcard")
        return false;
    const tokenStr = w.tokens.join(" ");
    if (typeName === "number") {
        return !isNaN(parseFloat(tokenStr));
    }
    const validator = globalEntityRegistry.getValidator(typeName);
    return validator ? validator.validate(tokenStr) : false;
}

export function matchDFAToAST(dfa: DFA, tokens: string[]): DFAASTMatchResult {
    const NO_MATCH: DFAASTMatchResult = {
        matched: false,
        fixedStringPartCount: 0,
        checkedWildcardCount: 0,
        uncheckedWildcardCount: 0,
        tokensConsumed: tokens.length,
    };

    if (tokens.length === 0) {
        const startState = dfa.states[dfa.startState];
        if (startState?.accepting) {
            const emptyResult: DFAASTMatchResult = {
                matched: true,
                ast: {
                    ruleIndex: startState.ruleIndex ?? 0,
                    parts: [],
                },
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                tokensConsumed: 0,
            };
            if (startState.ruleIndex !== undefined) {
                emptyResult.ruleIndex = startState.ruleIndex;
            }
            return emptyResult;
        }
        return NO_MATCH;
    }

    let currentStateId = dfa.startState;
    const parts: MatchNode[] = [];
    const decisionPoints: DecisionPoint[] = [];

    // The currently active wildcard node being built (for multi-token wildcards via minimal munch)
    let activeWildcard: WildcardMatchNode | undefined;

    // Priority counters
    let fixedStringPartCount = 0;
    let checkedWildcardCount = 0;
    let uncheckedWildcardCount = 0;

    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        const normalizedToken = normalizeToken(token);
        const currentState = dfa.states[currentStateId];

        if (!currentState) {
            // Dead state — try backtracking
            const restored = backtrack(decisionPoints, parts, tokens);
            if (restored) {
                currentStateId = restored.stateId;
                i = restored.tokenIndex;
                activeWildcard = restored.activeWildcard;
                fixedStringPartCount = restored.fixedStringPartCount;
                checkedWildcardCount = restored.checkedWildcardCount;
                uncheckedWildcardCount = restored.uncheckedWildcardCount;
                continue;
            }
            return NO_MATCH;
        }

        // Try specific token transition (literal match — highest priority)
        let nextStateId: number | undefined;
        let consumed = false;

        for (const trans of currentState.transitions) {
            if (trans.token === normalizedToken) {
                // Before taking the literal, record a decision point if wildcard also available
                if (currentState.wildcardTransition) {
                    const wt = currentState.wildcardTransition;
                    // Find the best capture info for the wildcard
                    const bestCapture = wt.captureInfo[0];
                    if (bestCapture) {
                        decisionPoints.push({
                            stateId: currentStateId,
                            tokenIndex: i,
                            partsLength: parts.length,
                            wildcardTargetStateId: wt.to,
                            activeWildcard: activeWildcard
                                ? {
                                      ...activeWildcard,
                                      tokens: [...activeWildcard.tokens],
                                  }
                                : undefined,
                            fixedStringPartCount,
                            checkedWildcardCount,
                            uncheckedWildcardCount,
                            wildcardCaptureInfo: buildCaptureInfo(bestCapture),
                        });
                    }
                }

                // Finalize any active wildcard before consuming a literal
                if (activeWildcard) {
                    parts.push(activeWildcard);
                    activeWildcard = undefined;
                }

                parts.push({ kind: "token", token: normalizedToken });
                nextStateId = trans.to;
                fixedStringPartCount++;
                consumed = true;
                break;
            }
        }

        // Try prefix match (flex-space): grammar token is a strict prefix of input token
        if (!consumed) {
            for (const trans of currentState.transitions) {
                if (
                    normalizedToken.length > trans.token.length &&
                    normalizedToken.startsWith(trans.token)
                ) {
                    // Record decision point if wildcard also available
                    if (currentState.wildcardTransition) {
                        const wt = currentState.wildcardTransition;
                        const bestCapture = wt.captureInfo[0];
                        if (bestCapture) {
                            decisionPoints.push({
                                stateId: currentStateId,
                                tokenIndex: i,
                                partsLength: parts.length,
                                wildcardTargetStateId: wt.to,
                                activeWildcard: activeWildcard
                                    ? {
                                          ...activeWildcard,
                                          tokens: [...activeWildcard.tokens],
                                      }
                                    : undefined,
                                fixedStringPartCount,
                                checkedWildcardCount,
                                uncheckedWildcardCount,
                                wildcardCaptureInfo:
                                    buildCaptureInfo(bestCapture),
                            });
                        }
                    }

                    // Finalize any active wildcard
                    if (activeWildcard) {
                        parts.push(activeWildcard);
                        activeWildcard = undefined;
                    }

                    // Consume the prefix as a literal
                    parts.push({ kind: "token", token: trans.token });
                    fixedStringPartCount++;

                    // Push the remainder back: replace current token with remainder
                    // We do this by mutating tokens in-place (safe since we own the array)
                    const remainder = normalizedToken.slice(trans.token.length);
                    tokens = [
                        ...tokens.slice(0, i + 1),
                        remainder,
                        ...tokens.slice(i + 1),
                    ];
                    // Don't increment i — the remainder token will be processed next iteration

                    nextStateId = trans.to;
                    consumed = true;
                    break;
                }
            }
        }

        // Try phraseSet transitions (multi-token)
        if (!consumed && currentState.phraseSetTransitions) {
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
                        // Finalize any active wildcard
                        if (activeWildcard) {
                            parts.push(activeWildcard);
                            activeWildcard = undefined;
                        }

                        parts.push({
                            kind: "phraseSet",
                            matcherName: pst.matcherName,
                            tokens: tokens.slice(i, i + phrase.length),
                        });
                        nextStateId = pst.to;
                        fixedStringPartCount += phrase.length;
                        i += phrase.length - 1; // -1 because the main loop increments
                        consumed = true;
                        break;
                    }
                }
                if (consumed) break;
            }
        }

        // Wildcard fallback (minimal munch — consume 1 token)
        if (!consumed && currentState.wildcardTransition) {
            const wt = currentState.wildcardTransition;
            const bestCapture = wt.captureInfo[0];

            if (activeWildcard) {
                // Continue building the same wildcard (multi-token via backtracking)
                activeWildcard.tokens.push(token);
            } else {
                // Start a new wildcard node
                activeWildcard = {
                    kind: "wildcard",
                    variable: bestCapture?.variable ?? "",
                    checked: bestCapture?.checked ?? false,
                    tokens: [token],
                };
                if (bestCapture?.typeName) {
                    activeWildcard.typeName = bestCapture.typeName;
                }
            }

            nextStateId = wt.to;
            // Priority counting is deferred to finalization (after validation)
            consumed = true;
        }

        if (!consumed) {
            // No transition available — try backtracking
            const restored = backtrack(decisionPoints, parts, tokens);
            if (restored) {
                currentStateId = restored.stateId;
                i = restored.tokenIndex;
                activeWildcard = restored.activeWildcard;
                fixedStringPartCount = restored.fixedStringPartCount;
                checkedWildcardCount = restored.checkedWildcardCount;
                uncheckedWildcardCount = restored.uncheckedWildcardCount;
                continue;
            }
            return NO_MATCH;
        }

        currentStateId = nextStateId!;
        i++;
    }

    // Finalize any trailing wildcard
    if (activeWildcard) {
        parts.push(activeWildcard);
        activeWildcard = undefined;
    }

    // Check for accepting state
    const finalState = dfa.states[currentStateId];
    if (!finalState?.accepting) {
        // Try backtracking
        const restored = backtrack(decisionPoints, parts, tokens);
        if (restored) {
            // Re-run from restored point (recursive approach via loop)
            // We need to restart the main loop from the restored state
            // Since we're at the end, do a fresh attempt with the restored state
            return matchDFAToASTFrom(
                dfa,
                tokens,
                restored.stateId,
                restored.tokenIndex,
                parts.slice(0, restored.partsLength),
                restored.activeWildcard,
                decisionPoints,
                restored.fixedStringPartCount,
                restored.checkedWildcardCount,
                restored.uncheckedWildcardCount,
            );
        }
        return NO_MATCH;
    }

    // Count wildcard priorities from the AST parts (per-token, runtime-checked)
    for (const part of parts) {
        if (part.kind === "wildcard") {
            const runtimeChecked = isRuntimeChecked(part);
            (part as WildcardMatchNode).checked = runtimeChecked;
            if (runtimeChecked) {
                checkedWildcardCount += part.tokens.length;
            } else {
                uncheckedWildcardCount += part.tokens.length;
            }
        }
    }

    const matchResult: DFAASTMatchResult = {
        matched: true,
        ast: {
            ruleIndex: finalState.ruleIndex ?? 0,
            parts,
        },
        fixedStringPartCount,
        checkedWildcardCount,
        uncheckedWildcardCount,
        tokensConsumed: tokens.length,
    };
    if (finalState.ruleIndex !== undefined) {
        matchResult.ruleIndex = finalState.ruleIndex;
    }
    return matchResult;
}

/**
 * Continue matching from a restored backtrack point.
 * This is the continuation of matchDFAToAST after a backtrack.
 */
function matchDFAToASTFrom(
    dfa: DFA,
    tokens: string[],
    startStateId: number,
    startTokenIndex: number,
    initialParts: MatchNode[],
    initialActiveWildcard: WildcardMatchNode | undefined,
    decisionPoints: DecisionPoint[],
    fixedStringPartCount: number,
    checkedWildcardCount: number,
    uncheckedWildcardCount: number,
): DFAASTMatchResult {
    const NO_MATCH: DFAASTMatchResult = {
        matched: false,
        fixedStringPartCount: 0,
        checkedWildcardCount: 0,
        uncheckedWildcardCount: 0,
        tokensConsumed: tokens.length,
    };

    let currentStateId = startStateId;
    const parts = initialParts;
    let activeWildcard = initialActiveWildcard;
    let i = startTokenIndex;

    while (i < tokens.length) {
        const token = tokens[i];
        const normalizedToken = normalizeToken(token);
        const currentState = dfa.states[currentStateId];

        if (!currentState) {
            const restored = backtrack(decisionPoints, parts, tokens);
            if (restored) {
                currentStateId = restored.stateId;
                i = restored.tokenIndex;
                activeWildcard = restored.activeWildcard;
                fixedStringPartCount = restored.fixedStringPartCount;
                checkedWildcardCount = restored.checkedWildcardCount;
                uncheckedWildcardCount = restored.uncheckedWildcardCount;
                continue;
            }
            return NO_MATCH;
        }

        let nextStateId: number | undefined;
        let consumed = false;

        // Literal match
        for (const trans of currentState.transitions) {
            if (trans.token === normalizedToken) {
                if (currentState.wildcardTransition) {
                    const wt = currentState.wildcardTransition;
                    const bestCapture = wt.captureInfo[0];
                    if (bestCapture) {
                        decisionPoints.push({
                            stateId: currentStateId,
                            tokenIndex: i,
                            partsLength: parts.length,
                            wildcardTargetStateId: wt.to,
                            activeWildcard: activeWildcard
                                ? {
                                      ...activeWildcard,
                                      tokens: [...activeWildcard.tokens],
                                  }
                                : undefined,
                            fixedStringPartCount,
                            checkedWildcardCount,
                            uncheckedWildcardCount,
                            wildcardCaptureInfo: buildCaptureInfo(bestCapture),
                        });
                    }
                }

                if (activeWildcard) {
                    parts.push(activeWildcard);
                    activeWildcard = undefined;
                }

                parts.push({ kind: "token", token: normalizedToken });
                nextStateId = trans.to;
                fixedStringPartCount++;
                consumed = true;
                break;
            }
        }

        // Prefix match (flex-space)
        if (!consumed) {
            for (const trans of currentState.transitions) {
                if (
                    normalizedToken.length > trans.token.length &&
                    normalizedToken.startsWith(trans.token)
                ) {
                    if (currentState.wildcardTransition) {
                        const wt = currentState.wildcardTransition;
                        const bestCapture = wt.captureInfo[0];
                        if (bestCapture) {
                            decisionPoints.push({
                                stateId: currentStateId,
                                tokenIndex: i,
                                partsLength: parts.length,
                                wildcardTargetStateId: wt.to,
                                activeWildcard: activeWildcard
                                    ? {
                                          ...activeWildcard,
                                          tokens: [...activeWildcard.tokens],
                                      }
                                    : undefined,
                                fixedStringPartCount,
                                checkedWildcardCount,
                                uncheckedWildcardCount,
                                wildcardCaptureInfo:
                                    buildCaptureInfo(bestCapture),
                            });
                        }
                    }

                    if (activeWildcard) {
                        parts.push(activeWildcard);
                        activeWildcard = undefined;
                    }

                    parts.push({ kind: "token", token: trans.token });
                    fixedStringPartCount++;

                    const remainder = normalizedToken.slice(trans.token.length);
                    tokens = [
                        ...tokens.slice(0, i + 1),
                        remainder,
                        ...tokens.slice(i + 1),
                    ];

                    nextStateId = trans.to;
                    consumed = true;
                    break;
                }
            }
        }

        // PhraseSet
        if (!consumed && currentState.phraseSetTransitions) {
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
                        if (activeWildcard) {
                            parts.push(activeWildcard);
                            activeWildcard = undefined;
                        }
                        parts.push({
                            kind: "phraseSet",
                            matcherName: pst.matcherName,
                            tokens: tokens.slice(i, i + phrase.length),
                        });
                        nextStateId = pst.to;
                        fixedStringPartCount += phrase.length;
                        i += phrase.length - 1;
                        consumed = true;
                        break;
                    }
                }
                if (consumed) break;
            }
        }

        // Wildcard fallback
        if (!consumed && currentState.wildcardTransition) {
            const wt = currentState.wildcardTransition;
            const bestCapture = wt.captureInfo[0];

            if (activeWildcard) {
                activeWildcard.tokens.push(token);
            } else {
                activeWildcard = {
                    kind: "wildcard",
                    variable: bestCapture?.variable ?? "",
                    checked: bestCapture?.checked ?? false,
                    tokens: [token],
                };
                if (bestCapture?.typeName) {
                    activeWildcard.typeName = bestCapture.typeName;
                }
            }

            nextStateId = wt.to;
            consumed = true;
        }

        if (!consumed) {
            const restored = backtrack(decisionPoints, parts, tokens);
            if (restored) {
                currentStateId = restored.stateId;
                i = restored.tokenIndex;
                activeWildcard = restored.activeWildcard;
                fixedStringPartCount = restored.fixedStringPartCount;
                checkedWildcardCount = restored.checkedWildcardCount;
                uncheckedWildcardCount = restored.uncheckedWildcardCount;
                continue;
            }
            return NO_MATCH;
        }

        currentStateId = nextStateId!;
        i++;
    }

    if (activeWildcard) {
        parts.push(activeWildcard);
    }

    const finalState = dfa.states[currentStateId];
    if (!finalState?.accepting) {
        const restored = backtrack(decisionPoints, parts, tokens);
        if (restored) {
            return matchDFAToASTFrom(
                dfa,
                tokens,
                restored.stateId,
                restored.tokenIndex,
                parts.slice(0, restored.partsLength),
                restored.activeWildcard,
                decisionPoints,
                restored.fixedStringPartCount,
                restored.checkedWildcardCount,
                restored.uncheckedWildcardCount,
            );
        }
        return NO_MATCH;
    }

    // Count wildcard priorities from AST parts (per-token, runtime-checked)
    let finalChecked = checkedWildcardCount;
    let finalUnchecked = uncheckedWildcardCount;
    for (const part of parts) {
        if (part.kind === "wildcard") {
            const runtimeChecked = isRuntimeChecked(part);
            (part as WildcardMatchNode).checked = runtimeChecked;
            if (runtimeChecked) {
                finalChecked += part.tokens.length;
            } else {
                finalUnchecked += part.tokens.length;
            }
        }
    }

    const fromResult: DFAASTMatchResult = {
        matched: true,
        ast: {
            ruleIndex: finalState.ruleIndex ?? 0,
            parts,
        },
        fixedStringPartCount,
        checkedWildcardCount: finalChecked,
        uncheckedWildcardCount: finalUnchecked,
        tokensConsumed: tokens.length,
    };
    if (finalState.ruleIndex !== undefined) {
        fromResult.ruleIndex = finalState.ruleIndex;
    }
    return fromResult;
}

/**
 * Backtrack to the most recent decision point and take the wildcard path.
 *
 * At the decision point, we had chosen a literal transition. Now we pop that
 * decision, truncate parts[] to the saved length, and set up the wildcard
 * to absorb the token at the decision point's tokenIndex.
 *
 * Returns the restored state, or undefined if no decision points remain.
 */
function backtrack(
    decisionPoints: DecisionPoint[],
    parts: MatchNode[],
    tokens: string[],
):
    | {
          stateId: number;
          tokenIndex: number;
          partsLength: number;
          activeWildcard: WildcardMatchNode | undefined;
          fixedStringPartCount: number;
          checkedWildcardCount: number;
          uncheckedWildcardCount: number;
      }
    | undefined {
    if (decisionPoints.length === 0) return undefined;

    const dp = decisionPoints.pop()!;

    // Truncate parts to the saved length
    parts.length = dp.partsLength;

    // Restore the active wildcard state from the decision point
    let activeWildcard = dp.activeWildcard;

    // Now take the wildcard path: absorb the token at dp.tokenIndex
    const token = tokens[dp.tokenIndex];
    if (activeWildcard) {
        // Continue the existing wildcard with this token
        activeWildcard.tokens.push(token);
    } else {
        // Start a new wildcard
        activeWildcard = {
            kind: "wildcard",
            variable: dp.wildcardCaptureInfo.variable,
            checked: dp.wildcardCaptureInfo.checked,
            tokens: [token],
        };
        if (dp.wildcardCaptureInfo.typeName) {
            activeWildcard.typeName = dp.wildcardCaptureInfo.typeName;
        }
    }

    return {
        stateId: dp.wildcardTargetStateId,
        tokenIndex: dp.tokenIndex + 1,
        partsLength: dp.partsLength,
        activeWildcard,
        fixedStringPartCount: dp.fixedStringPartCount,
        checkedWildcardCount: dp.checkedWildcardCount,
        uncheckedWildcardCount: dp.uncheckedWildcardCount,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// AST evaluation — bottom-up value computation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a MatchAST to produce the action value.
 *
 * Uses the grammar's CompiledValueNode expressions (name-based variable references)
 * to compute the final action object from the structural parse tree.
 *
 * @param ast The parse tree from matchDFAToAST
 * @param grammar The grammar (for rule definitions and value expressions)
 * @returns The computed action value, or undefined if no value expression
 */
export function evaluateMatchAST(ast: MatchAST, grammar: Grammar): any {
    const rule = grammar.alternatives[ast.ruleIndex];
    if (!rule) return undefined;

    // Find the value expression — it may be nested in RulesPart structures.
    // The DFA AST matcher inlines alternatives (producing token/wildcard nodes
    // directly), so <Start> = <play> | <stop> won't have a top-level value;
    // we need to search nested RulesPart alternatives for the matching one.
    const valueNode = findValueExpression(rule, ast.parts);
    if (!valueNode) return undefined;

    // Build name→value bindings from AST parts
    const bindings = buildBindings(ast.parts, grammar);

    // Evaluate the value expression with the bindings
    return evaluateValueNode(valueNode, bindings);
}

/**
 * Build name→value bindings from AST parts.
 * Wildcards produce string/number/entity values, ruleRefs recurse.
 */
function buildBindings(parts: MatchNode[], grammar: Grammar): Map<string, any> {
    const bindings = new Map<string, any>();

    for (const part of parts) {
        switch (part.kind) {
            case "wildcard": {
                const rawValue = part.tokens.join(" ");
                // Apply entity conversion for checked wildcards
                if (
                    part.checked &&
                    part.typeName &&
                    part.typeName !== "string" &&
                    part.typeName !== "wildcard"
                ) {
                    if (part.typeName === "number") {
                        const num = parseFloat(rawValue);
                        if (!isNaN(num)) {
                            bindings.set(part.variable, num);
                            break;
                        }
                    } else {
                        const converter = globalEntityRegistry.getConverter(
                            part.typeName,
                        );
                        if (converter) {
                            const converted = converter.convert(rawValue);
                            if (converted !== undefined) {
                                bindings.set(part.variable, converted);
                                break;
                            }
                        }
                    }
                }
                bindings.set(part.variable, rawValue);
                break;
            }
            case "ruleRef":
                // Recursively evaluate the sub-match
                bindings.set(
                    part.variable,
                    evaluateMatchAST(part.match, grammar),
                );
                break;
            // Token and phraseSet nodes don't contribute to value bindings
        }
    }

    return bindings;
}

/**
 * Find the CompiledValueNode expression for a match, searching through nested
 * RulesPart structures if needed.
 *
 * The DFA AST matcher inlines alternatives: when a grammar has
 * <Start> = <play> | <stop>, the AST parts contain the inlined tokens/
 * wildcards directly (not ruleRef nodes). The value expression lives on
 * the nested alternative rule inside the RulesPart, not on the top-level
 * wrapper rule. This function searches through nested rules to find the
 * matching alternative by structural comparison.
 */
function findValueExpression(
    rule: import("./grammarTypes.js").GrammarRule,
    astParts: MatchNode[],
): CompiledValueNode | undefined {
    // Direct value on the rule — use it
    if (rule.value) return rule.value;

    // Search through RulesPart structures for nested rules with values
    for (const part of rule.parts) {
        if (part.type === "rules") {
            // Try structural matching against nested rule alternatives
            for (const nestedRule of part.alternatives) {
                if (
                    nestedRule.value &&
                    matchesRuleStructure(nestedRule, astParts)
                ) {
                    return nestedRule.value;
                }
                // Recurse into nested rules that are themselves wrappers
                const nested = findValueExpression(nestedRule, astParts);
                if (nested) return nested;
            }
        }
    }

    return undefined;
}

/**
 * Check whether a grammar rule's parts structurally match the AST parts.
 * Used to identify which nested alternative was matched.
 */
function matchesRuleStructure(
    rule: import("./grammarTypes.js").GrammarRule,
    astParts: MatchNode[],
): boolean {
    let astIdx = 0;
    for (const part of rule.parts) {
        if (astIdx >= astParts.length) {
            // Grammar has more parts than AST — check if remaining parts are optional
            return false;
        }
        switch (part.type) {
            case "string": {
                // String part contains one or more literal tokens
                for (const word of part.value) {
                    if (astIdx >= astParts.length) return false;
                    const astPart = astParts[astIdx];
                    if (astPart.kind !== "token") return false;
                    if (normalizeToken(astPart.token) !== normalizeToken(word))
                        return false;
                    astIdx++;
                }
                break;
            }
            case "wildcard":
            case "number": {
                const astPart = astParts[astIdx];
                if (astPart.kind !== "wildcard") return false;
                // Variable name must match
                if (part.variable && astPart.variable !== part.variable)
                    return false;
                // Wildcard may consume multiple tokens — skip past it
                astIdx++;
                break;
            }
            case "rules": {
                // Nested rules — try to match recursively
                // For now, skip past any non-token parts in the AST
                // This handles cases where nested rules inline their
                // content.  When the part has a `dispatch` index,
                // bucket members live in `dispatch[*].tokenMap`
                // (filter-only - they keep their leading token);
                // `part.rules` is then the fallback subset.  We try
                // bucket members first, then fallback, mirroring
                // the matcher's hits-then-fallback ordering.
                let matched = false;
                if (part.dispatch !== undefined) {
                    outer: for (const m of part.dispatch) {
                        for (const suffixRules of m.tokenMap.values()) {
                            for (const suffix of suffixRules) {
                                if (
                                    matchesRuleStructure(
                                        suffix,
                                        astParts.slice(astIdx),
                                    )
                                ) {
                                    matched = true;
                                    break outer;
                                }
                            }
                        }
                    }
                }
                if (!matched) {
                    for (const nestedRule of part.alternatives) {
                        if (
                            matchesRuleStructure(
                                nestedRule,
                                astParts.slice(astIdx),
                            )
                        ) {
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) return false;
                // Consume remaining AST parts (nested rule matched to end)
                astIdx = astParts.length;
                break;
            }
            case "phraseSet": {
                const astPart = astParts[astIdx];
                if (astPart.kind !== "phraseSet") return false;
                astIdx++;
                break;
            }
        }
    }
    // All grammar parts consumed — AST may have trailing wildcard tokens
    return true;
}

/**
 * Evaluate a grammar CompiledValueNode using name-based bindings.
 */
function evaluateValueNode(
    node: CompiledValueNode,
    bindings: Map<string, any>,
): any {
    switch (node.type) {
        case "literal":
            return node.value;

        case "variable":
            return bindings.get(node.name);

        case "object": {
            const result: Record<string, any> = {};
            for (const elem of node.value) {
                if (elem.type === "property") {
                    if (elem.value === null) {
                        // null means "use the variable with the same name as the key"
                        result[elem.key] = bindings.get(elem.key);
                    } else {
                        result[elem.key] = evaluateValueNode(
                            elem.value,
                            bindings,
                        );
                    }
                }
                // Spread elements are not evaluated in the DFA path.
                // The current NFA and DFA matchers do not support value
                // expressions; spread requires runtime evaluation of the
                // argument, which is only implemented in the NFA
                // interpreter (grammarMatcher.ts).
            }
            return result;
        }

        case "array":
            return node.value.map((v) => evaluateValueNode(v, bindings));
    }
}

/**
 * Match DFA to AST with two-pass split-candidate strategy.
 * Pass 1 — original tokens.
 * Pass 2 — pre-split tokens using dfa.splitCandidates.
 * Returns the higher-priority result.
 */
export function matchDFAToASTWithSplitting(
    dfa: DFA,
    tokens: string[],
): DFAASTMatchResult {
    // O(1) first-token pre-filter
    if (dfaFirstTokenRejects(dfa, tokens)) {
        return {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            tokensConsumed: tokens.length,
        };
    }

    const origResult = matchDFAToAST(dfa, tokens);

    if (!dfa.splitCandidates?.length) return origResult;

    const splitTokens = applySplitToTokens(tokens, dfa.splitCandidates);
    if (!splitTokens) return origResult;

    const splitResult = matchDFAToAST(dfa, splitTokens);
    if (!splitResult.matched) return origResult;
    if (!origResult.matched) return splitResult;

    // Compare priorities: prefer the higher-priority match
    const cmp = compareASTPriority(origResult, splitResult);
    return cmp <= 0 ? origResult : splitResult;
}

/**
 * Compare two AST match results using the same 3-rule priority as sortNFAMatches.
 */
function compareASTPriority(
    a: DFAASTMatchResult,
    b: DFAASTMatchResult,
): number {
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
            `    State ${state.id}${accepting}${priority} (rules: ${(state.activeRuleIndices ?? []).join(",") || "none"}):`,
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
