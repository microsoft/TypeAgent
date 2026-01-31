// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DFA } from "./dfa.js";

/**
 * Result of matching tokens against a DFA
 */
export interface DFAMatchResult {
    /** Whether the input was accepted */
    matched: boolean;

    /** Variable captures from the match */
    captures: Map<string, string | number>;

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
}

/**
 * Match tokens against a DFA
 *
 * @param dfa The DFA to match against
 * @param tokens Array of tokens to match
 * @param debug Whether to track visited states for debugging
 * @returns Match result with captures and priority
 */
export function matchDFA(
    dfa: DFA,
    tokens: string[],
    debug: boolean = false,
): DFAMatchResult {
    let currentStateId = dfa.startState;
    const visitedStates: number[] = debug ? [currentStateId] : [];

    // Track captures per context to avoid conflicts between rules with same variable names
    // Map from contextIndex -> (varName -> value)
    const capturesByContext = new Map<number, Map<string, string | number>>();

    // Process each token
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const currentState = dfa.states[currentStateId];

        if (!currentState) {
            // Invalid state
            const result: DFAMatchResult = {
                matched: false,
                captures: new Map(),
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

        for (const trans of currentState.transitions) {
            if (trans.token === token) {
                nextStateId = trans.to;
                break;
            }
        }

        // If no token match, try wildcard
        if (nextStateId === undefined && currentState.wildcardTransition) {
            nextStateId = currentState.wildcardTransition.to;

            // Capture the token value for each variable, organized by context
            for (const captureInfo of currentState.wildcardTransition
                .captureInfo) {
                // Determine the captured value based on type
                let capturedValue: string | number;
                if (captureInfo.typeName === "number") {
                    const num = parseFloat(token);
                    if (!isNaN(num)) {
                        capturedValue = num;
                    } else {
                        // Token is not a valid number - store as string
                        capturedValue = token;
                    }
                } else {
                    // Store as string (entity validation would happen elsewhere)
                    capturedValue = token;
                }

                // Store in all contexts that use this variable
                for (const contextIndex of captureInfo.contextIndices) {
                    if (!capturesByContext.has(contextIndex)) {
                        capturesByContext.set(contextIndex, new Map());
                    }
                    capturesByContext
                        .get(contextIndex)!
                        .set(captureInfo.variable, capturedValue);
                }
            }
        }

        // If still no match, fail
        if (nextStateId === undefined) {
            const result: DFAMatchResult = {
                matched: false,
                captures: new Map(),
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
            captures: new Map(),
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

    // Get captures from the best matching context
    const bestContextIndex = finalState.bestPriority.contextIndex;
    const captures = capturesByContext.get(bestContextIndex) || new Map();
    const bestContext = finalState.contexts[bestContextIndex];

    const result: DFAMatchResult = {
        matched: true,
        captures,
        fixedStringPartCount: finalState.bestPriority.fixedStringPartCount,
        checkedWildcardCount: finalState.bestPriority.checkedWildcardCount,
        uncheckedWildcardCount: finalState.bestPriority.uncheckedWildcardCount,
        tokensConsumed: tokens.length,
    };

    // Include rule index if available
    if (bestContext?.ruleIndex !== undefined) {
        result.ruleIndex = bestContext.ruleIndex;
    }

    if (debug) {
        result.visitedStates = visitedStates;
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
