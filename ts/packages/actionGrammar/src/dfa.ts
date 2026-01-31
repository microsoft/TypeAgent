// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DFA (Deterministic Finite Automaton) types for grammar matching
 *
 * The DFA is compiled from an NFA using subset construction while preserving:
 * 1. Priority information for rule ranking
 * 2. Variable bindings for captures
 * 3. Completion support for prefix matching
 *
 * Each DFA state represents a set of NFA configurations (NFA states + execution context).
 * Transitions are deterministic, but we track multiple execution contexts within each state
 * to maintain variable bindings and priorities from all possible NFA paths.
 */

/**
 * An execution context tracks the NFA state set and runtime information
 * for a particular execution path through the grammar
 */
export interface DFAExecutionContext {
    /** Set of NFA state IDs represented by this context */
    nfaStateIds: Set<number>;

    /** Variable captures accumulated on this path */
    captures: Map<string, { variable: string; typeName?: string }>;

    /** Priority counts for ranking this path */
    priority: {
        fixedStringPartCount: number;
        checkedWildcardCount: number;
        uncheckedWildcardCount: number;
    };

    /** Rule index this context represents (from the original Grammar.rules array) */
    ruleIndex?: number | undefined;
}

/**
 * A DFA transition maps input tokens to destination states
 */
export interface DFATransition {
    /** Specific token that triggers this transition */
    token: string;

    /** Destination DFA state ID */
    to: number;
}

/**
 * Wildcard transition that matches any token not matched by specific transitions
 */
export interface DFAWildcardTransition {
    /** Destination DFA state ID */
    to: number;

    /** Variables that could be captured by this wildcard, with their contexts */
    captureInfo: Array<{
        variable: string;
        typeName?: string;
        checked: boolean;
        /** Which execution contexts this capture applies to */
        contextIndices: number[];
    }>;
}

/**
 * A DFA state represents a deterministic state with multiple execution contexts
 */
export interface DFAState {
    /** Unique state ID */
    id: number;

    /** Execution contexts at this state (from different NFA paths) */
    contexts: DFAExecutionContext[];

    /** Deterministic token transitions */
    transitions: DFATransition[];

    /** Wildcard transition (catch-all for unmatched tokens) */
    wildcardTransition?: DFAWildcardTransition;

    /** Whether this state accepts input */
    accepting: boolean;

    /**
     * If accepting, the best priority among all contexts
     * (computed from the highest-priority NFA accept state in any context)
     */
    bestPriority?: {
        fixedStringPartCount: number;
        checkedWildcardCount: number;
        uncheckedWildcardCount: number;
        /** Index of the context with this priority */
        contextIndex: number;
    };
}

/**
 * A complete DFA for grammar matching
 */
export interface DFA {
    /** DFA name for debugging */
    name?: string;

    /** All states in the DFA */
    states: DFAState[];

    /** Start state ID */
    startState: number;

    /** IDs of accepting states */
    acceptingStates: number[];

    /** Reference to the original NFA (for fallback and debugging) */
    sourceNFA?: any; // TODO: import NFA type without circular dependency
}

/**
 * Builder for constructing DFAs
 */
export class DFABuilder {
    private states: DFAState[] = [];
    private stateMap = new Map<string, number>(); // key -> state ID for deduplication

    /**
     * Create a new DFA state with the given execution contexts
     * @param contexts Execution contexts for this state
     * @returns The state ID
     */
    createState(contexts: DFAExecutionContext[]): number {
        // Create a deterministic key for this state based on NFA state sets
        const key = this.computeStateKey(contexts);

        // Check if we've seen this state before
        const existingId = this.stateMap.get(key);
        if (existingId !== undefined) {
            return existingId;
        }

        // Create new state
        const id = this.states.length;
        const state: DFAState = {
            id,
            contexts,
            transitions: [],
            accepting: false,
        };

        this.states.push(state);
        this.stateMap.set(key, id);

        return id;
    }

    /**
     * Compute a deterministic key for a state based on its NFA state sets and rule indices
     */
    private computeStateKey(contexts: DFAExecutionContext[]): string {
        // Sort contexts by their NFA state sets and rule indices for deterministic key
        // Include rule index in key to avoid merging contexts from different rules
        const sortedContexts = contexts
            .map((ctx) => {
                const nfaStates = Array.from(ctx.nfaStateIds).sort().join(",");
                const ruleIndex =
                    ctx.ruleIndex !== undefined ? ctx.ruleIndex : "none";
                return `${nfaStates}|rule:${ruleIndex}`;
            })
            .sort()
            .join(";");

        return sortedContexts;
    }

    /**
     * Add a token transition from one state to another
     */
    addTransition(from: number, token: string, to: number): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }

        state.transitions.push({ token, to });
    }

    /**
     * Add a wildcard transition from one state to another
     */
    addWildcardTransition(
        from: number,
        to: number,
        captureInfo: DFAWildcardTransition["captureInfo"],
    ): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }

        state.wildcardTransition = { to, captureInfo };
    }

    /**
     * Mark a state as accepting and compute its best priority
     */
    markAccepting(stateId: number, nfaAcceptingStates: Set<number>): void {
        const state = this.states[stateId];
        if (!state) {
            throw new Error(`State ${stateId} does not exist`);
        }

        state.accepting = true;

        // Find the best priority among all contexts that contain an NFA accepting state
        let bestPriority: DFAState["bestPriority"];

        for (let i = 0; i < state.contexts.length; i++) {
            const ctx = state.contexts[i];

            // Check if this context contains any NFA accepting states
            const hasAcceptingState = Array.from(ctx.nfaStateIds).some((id) =>
                nfaAcceptingStates.has(id),
            );

            if (hasAcceptingState) {
                if (
                    !bestPriority ||
                    this.comparePriorities(ctx.priority, bestPriority) < 0
                ) {
                    bestPriority = { ...ctx.priority, contextIndex: i };
                }
            }
        }

        if (bestPriority !== undefined) {
            state.bestPriority = bestPriority;
        }
    }

    /**
     * Compare two priorities (returns negative if a is better, positive if b is better)
     */
    private comparePriorities(
        a: {
            fixedStringPartCount: number;
            checkedWildcardCount: number;
            uncheckedWildcardCount: number;
        },
        b: {
            fixedStringPartCount: number;
            checkedWildcardCount: number;
            uncheckedWildcardCount: number;
        },
    ): number {
        // Rule 1: Prefer no unchecked wildcards
        if (a.uncheckedWildcardCount === 0 && b.uncheckedWildcardCount !== 0) {
            return -1;
        }
        if (a.uncheckedWildcardCount !== 0 && b.uncheckedWildcardCount === 0) {
            return 1;
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
    }

    /**
     * Build the final DFA
     */
    build(
        startState: number,
        acceptingStates: Set<number>,
        name?: string,
    ): DFA {
        const dfa: DFA = {
            states: this.states,
            startState,
            acceptingStates: Array.from(acceptingStates),
        };
        if (name !== undefined) {
            dfa.name = name;
        }
        return dfa;
    }

    /**
     * Get a state by ID
     */
    getState(id: number): DFAState | undefined {
        return this.states[id];
    }
}
