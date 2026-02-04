// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DFA, DFASlotOperation, DFATransition } from "./dfa.js";

/**
 * Environment for slot-based variable storage
 * Matches the NFA interpreter's environment structure
 */
interface DFAEnvironment {
    slots: (string | number | undefined)[];
    parent?: DFAEnvironment | undefined;
    parentSlotIndex?: number | undefined;
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
            return {
                actionName: valueExpr.actionName,
                parameters: params,
            };
        }
    }

    // Primitive value - return as-is
    return valueExpr;
}

/**
 * Apply slot operations to the environment stack
 * Returns the updated current environment
 */
function applySlotOps(
    ops: DFASlotOperation[] | undefined,
    envStack: DFAEnvironment[],
    consumedValue?: string | number,
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
                    envStack.pop();
                }
                break;
            }
        }
    }
}

/**
 * Match tokens against a DFA
 *
 * @param dfa The DFA to match against
 * @param tokens Array of tokens to match
 * @param debug Whether to track visited states for debugging
 * @returns Match result with actionValue and priority
 */
export function matchDFA(
    dfa: DFA,
    tokens: string[],
    debug: boolean = false,
): DFAMatchResult {
    let currentStateId = dfa.startState;
    const visitedStates: number[] = debug ? [currentStateId] : [];

    // Initialize environment stack
    // Start with a root environment - the actual slot count will be set by pushEnv operations
    const envStack: DFAEnvironment[] = [createEnvironment(32)]; // Start with reasonable default

    // Process each token
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const currentState = dfa.states[currentStateId];

        if (!currentState) {
            // Invalid state
            const result: DFAMatchResult = {
                matched: false,
                fixedStringPartCount: 0,
                checkedWildcardCount: 0,
                uncheckedWildcardCount: 0,
                tokensConsumed: i,
            };
            if (debug) {
                result.visitedStates = visitedStates;
            }
            return result;
        }

        // Try to find a matching token transition
        let nextStateId: number | undefined;
        let matchedTransition: DFATransition | undefined;

        for (const trans of currentState.transitions) {
            if (trans.token === token) {
                nextStateId = trans.to;
                matchedTransition = trans;
                break;
            }
        }

        // If token matched, apply slot operations
        if (matchedTransition) {
            // Apply preOps before consuming token
            applySlotOps(matchedTransition.preOps, envStack);
            // Apply postOps after consuming token
            applySlotOps(matchedTransition.postOps, envStack);
        }

        // If no token match, try wildcard
        if (nextStateId === undefined && currentState.wildcardTransition) {
            const wildcard = currentState.wildcardTransition;
            nextStateId = wildcard.to;

            // Determine the captured value based on type
            let capturedValue: string | number = token;
            if (wildcard.consumeOp) {
                // Check captureInfo for type information
                const captureInfo = wildcard.captureInfo[0];
                if (captureInfo?.typeName === "number") {
                    const num = parseFloat(token);
                    if (!isNaN(num)) {
                        capturedValue = num;
                    }
                }
            }

            // Apply preOps before consuming
            applySlotOps(wildcard.preOps, envStack);

            // Apply consumeOp (write to slot)
            if (wildcard.consumeOp) {
                applySlotOps([wildcard.consumeOp], envStack, capturedValue);
            }

            // Apply postOps after consuming
            applySlotOps(wildcard.postOps, envStack);
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
            if (debug) {
                result.visitedStates = visitedStates;
            }
            return result;
        }

        currentStateId = nextStateId;
        if (debug) {
            visitedStates.push(currentStateId);
        }
    }

    // Check if we're in an accepting state
    const finalState = dfa.states[currentStateId];
    if (!finalState || !finalState.accepting || !finalState.bestPriority) {
        const result: DFAMatchResult = {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            tokensConsumed: tokens.length,
        };
        if (debug) {
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

    const bestContext =
        finalState.contexts[finalState.bestPriority.contextIndex];

    const result: DFAMatchResult = {
        matched: true,
        actionValue,
        fixedStringPartCount: finalState.bestPriority.fixedStringPartCount,
        checkedWildcardCount: finalState.bestPriority.checkedWildcardCount,
        uncheckedWildcardCount: finalState.bestPriority.uncheckedWildcardCount,
        tokensConsumed: tokens.length,
    };

    // Include rule index if available
    if (bestContext?.ruleIndex !== undefined) {
        result.ruleIndex = bestContext.ruleIndex;
    }

    // Include debug info
    if (debug) {
        result.visitedStates = visitedStates;
        if (finalState.debugSlotMap) {
            result.debugSlotMap = finalState.debugSlotMap;
        }
        if (currentEnv) {
            result.debugSlots = [...currentEnv.slots];
        }
    }

    return result;
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
 * Completion result for prefix matching
 */
export interface DFACompletionResult {
    /** Completions grouped by rule/action */
    groups: DFACompletionGroup[];

    /** Whether the prefix itself is a valid complete match */
    prefixMatches: boolean;

    /** Legacy: All completions (not grouped) - for backward compatibility */
    completions?: string[];
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
    for (const token of tokens) {
        const currentState = dfa.states[currentStateId];
        if (!currentState) {
            return { groups: [], prefixMatches: false, completions: [] };
        }

        // Find matching transition
        let nextStateId: number | undefined;

        for (const trans of currentState.transitions) {
            if (trans.token === token) {
                nextStateId = trans.to;
                break;
            }
        }

        // Try wildcard if no token match
        if (nextStateId === undefined && currentState.wildcardTransition) {
            nextStateId = currentState.wildcardTransition.to;
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

    // Also collect all completions for legacy compatibility
    const allCompletions = new Set<string>();
    for (const token of allTokens) {
        allCompletions.add(token);
    }
    for (const displayStr of wildcardDisplayStrings) {
        allCompletions.add(displayStr);
    }

    return {
        groups,
        prefixMatches: currentState.accepting,
        completions: Array.from(allCompletions),
    };
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
    }

    return lines.join("\n");
}
