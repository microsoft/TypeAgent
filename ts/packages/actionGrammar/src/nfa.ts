// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * NFA (Nondeterministic Finite Automaton) Types
 *
 * This module provides a token-based NFA representation for regular grammars.
 * Tokens are the atomic units (words/symbols), not characters.
 */

/**
 * Transition types:
 * - token: Match a specific token
 * - epsilon: Free transition (no input consumed)
 * - wildcard: Match any single token (for variables)
 * - phraseSet: Match any phrase in a named phrase-set (resolved at match time)
 */
export type NFATransitionType = "token" | "epsilon" | "wildcard" | "phraseSet";

/**
 * A transition from one state to another
 */
export interface NFATransition {
    type: NFATransitionType;

    // For token transitions: the token to match (can have multiple alternatives)
    tokens?: string[] | undefined;

    // For phraseSet transitions: name of the phrase-set matcher to consult at match time
    matcherName?: string | undefined;

    // For wildcard transitions: metadata about the variable
    variable?: string | undefined;
    typeName?: string | undefined;
    checked?: boolean | undefined; // true if wildcard has validation (entity type or checked_wildcard paramSpec)

    // For checked wildcard transitions: completion metadata (set at compile time)
    // Allows completion to return property info without runtime action value evaluation
    actionName?: string | undefined; // e.g., "play"
    propertyPath?: string | undefined; // e.g., "parameters.songName"

    // Slot assignment for the new environment system
    // When set, the captured value is written to this slot index
    slotIndex?: number | undefined;
    // If true, append to existing value (for multi-word wildcards)
    appendToSlot?: boolean | undefined;

    // For epsilon transitions exiting nested rules:
    // When true, evaluate the current rule's actionValue and write to parent slot
    writeToParent?: boolean | undefined;
    // The actionValue to evaluate when writing to parent
    valueToWrite?: any | undefined;

    // For epsilon transitions exiting nested rules without parent capture:
    // When true, pop the current environment back to parent (without writing)
    // Used when exiting rules like (<Item>)? where the parent doesn't capture the result
    popEnvironment?: boolean | undefined;

    // Target state
    to: number;
}

/**
 * Priority hint for an accepting state
 * Used when multiple grammar rules share an accepting state (e.g., in DFA construction)
 * Tracks the best-case priority achievable through this state
 */
export interface AcceptStatePriorityHint {
    // Best achievable counts for any path leading to this state
    minFixedStringPartCount: number; // Highest fixed string count from any rule
    maxCheckedWildcardCount: number; // Most checked wildcards from any rule
    minUncheckedWildcardCount: number; // Fewest unchecked wildcards from any rule
}

/**
 * An NFA state with outgoing transitions
 */
export interface NFAState {
    id: number;
    transitions: NFATransition[];

    // If true, this is an accepting/final state
    accepting: boolean;

    // Optional: Priority hint for accepting states (used in DFA minimization/merging)
    // When multiple rules merge into one accepting state, this tracks the best possible priority
    priorityHint?: AcceptStatePriorityHint | undefined;

    // Optional: capture variable value when reaching this state
    capture?:
        | {
              variable: string;
              typeName?: string | undefined;
          }
        | undefined;

    // Optional: Rule index for epsilon transitions from start (which rule this path belongs to)
    // This allows tracking which grammar rule produced a match
    ruleIndex?: number | undefined;

    // Optional: Action value for this rule (used for nested rules that have their own action values)
    // This allows returning the correct action even when nested rules don't have top-level rule indices
    actionValue?: any | undefined;

    // NEW: Environment-based slot system
    // Number of slots needed for this rule's environment
    slotCount?: number | undefined;

    // Slot map for this rule (variable name -> slot index)
    // Set on rule entry states
    slotMap?: Map<string, number> | undefined;

    // For nested rule references: which slot in the parent environment to write the result to
    // Set on states that enter a nested rule
    parentSlotIndex?: number | undefined;

    // Completion metadata for nested rule entry states
    // Set when this state is the entry point of a nested rules reference that captures a property
    completionActionName?: string | undefined;
    completionPropertyPath?: string | undefined;
}

/**
 * A complete NFA
 */
export interface NFA {
    states: NFAState[];
    startState: number;
    acceptingStates: number[];

    // Metadata
    name?: string | undefined;

    // Action values for each rule - array indexed by ruleIndex
    // undefined means "return matched text" (no explicit -> value)
    actionValues: Array<any | undefined>;
}

/**
 * Builder helper for constructing NFAs
 */
export class NFABuilder {
    private states: NFAState[] = [];
    private nextStateId = 0;
    private actionValues: Array<any | undefined> = [];

    createState(accepting: boolean = false): number {
        const id = this.nextStateId++;
        this.states.push({
            id,
            transitions: [],
            accepting,
        });
        return id;
    }

    addTransition(
        from: number,
        to: number,
        type: NFATransitionType,
        tokens?: string[],
        variable?: string,
        typeName?: string,
        checked?: boolean,
        slotIndex?: number,
        appendToSlot?: boolean,
        actionName?: string,
        propertyPath?: string,
    ): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }
        const trans: NFATransition = {
            type,
            to,
            tokens,
            variable,
            typeName,
            checked,
            slotIndex,
            appendToSlot,
        };
        if (actionName) trans.actionName = actionName;
        if (propertyPath) trans.propertyPath = propertyPath;
        state.transitions.push(trans);
    }

    addTokenTransition(from: number, to: number, tokens: string[]): void {
        this.addTransition(from, to, "token", tokens);
    }

    addEpsilonTransition(from: number, to: number): void {
        this.addTransition(from, to, "epsilon");
    }

    /**
     * Add an epsilon transition that writes the current rule's result to the parent slot
     * Used when exiting a nested rule reference
     */
    addEpsilonWithWriteToParent(
        from: number,
        to: number,
        valueToWrite: any,
    ): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }
        state.transitions.push({
            type: "epsilon",
            to,
            writeToParent: true,
            valueToWrite,
        });
    }

    /**
     * Add an epsilon transition that pops the current environment to parent
     * Used when exiting a nested rule that doesn't capture to parent (e.g., (<Item>)?)
     */
    addEpsilonWithPopEnvironment(from: number, to: number): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }
        state.transitions.push({
            type: "epsilon",
            to,
            popEnvironment: true,
        });
    }

    addPhraseSetTransition(
        from: number,
        to: number,
        matcherName: string,
    ): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }
        state.transitions.push({ type: "phraseSet", matcherName, to });
    }

    addWildcardTransition(
        from: number,
        to: number,
        variable: string,
        typeName?: string,
        checked?: boolean,
        slotIndex?: number,
        appendToSlot?: boolean,
        actionName?: string,
        propertyPath?: string,
    ): void {
        this.addTransition(
            from,
            to,
            "wildcard",
            undefined,
            variable,
            typeName,
            checked,
            slotIndex,
            appendToSlot,
            actionName,
            propertyPath,
        );
    }

    build(startState: number, name?: string): NFA {
        const acceptingStates = this.states
            .filter((s) => s.accepting)
            .map((s) => s.id);

        return {
            states: this.states,
            startState,
            acceptingStates,
            name,
            actionValues: this.actionValues,
        };
    }

    /**
     * Set the action value for a rule at the given index
     * undefined means "return matched text"
     */
    setActionValue(ruleIndex: number, actionValue: any | undefined): void {
        this.actionValues[ruleIndex] = actionValue;
    }

    getStateCount(): number {
        return this.states.length;
    }

    getState(id: number): NFAState {
        const state = this.states[id];
        if (!state) {
            throw new Error(`State ${id} does not exist`);
        }
        return state;
    }

    /**
     * Set slot information on a state (for rule entry states)
     */
    setStateSlotInfo(
        stateId: number,
        slotCount: number,
        slotMap: Map<string, number>,
    ): void {
        const state = this.getState(stateId);
        state.slotCount = slotCount;
        state.slotMap = slotMap;
    }

    /**
     * Set parent slot index on a state (for nested rule entry)
     */
    setStateParentSlotIndex(stateId: number, parentSlotIndex: number): void {
        const state = this.getState(stateId);
        state.parentSlotIndex = parentSlotIndex;
    }
}

/**
 * Combine two NFAs with epsilon transitions
 * Useful for building composite grammars
 */
export function combineNFAs(
    nfa1: NFA,
    nfa2: NFA,
    operation: "sequence" | "choice",
): NFA {
    const builder = new NFABuilder();

    // Copy states from nfa1
    const offset1 = 0;
    for (const state of nfa1.states) {
        const newId = builder.createState(state.accepting);
        for (const trans of state.transitions) {
            builder.addTransition(
                newId,
                trans.to + offset1,
                trans.type,
                trans.tokens,
                trans.variable,
                trans.typeName,
            );
        }
    }

    // Copy states from nfa2
    const offset2 = nfa1.states.length;
    for (const state of nfa2.states) {
        const newId = builder.createState(state.accepting);
        for (const trans of state.transitions) {
            builder.addTransition(
                newId,
                trans.to + offset2,
                trans.type,
                trans.tokens,
                trans.variable,
                trans.typeName,
            );
        }
    }

    if (operation === "sequence") {
        // Connect nfa1 accepting states to nfa2 start with epsilon
        for (const acc of nfa1.acceptingStates) {
            builder.addEpsilonTransition(
                acc + offset1,
                nfa2.startState + offset2,
            );
            // Remove accepting from intermediate states
            builder.getState(acc + offset1).accepting = false;
        }
        return builder.build(nfa1.startState + offset1);
    } else {
        // choice: create new start state with epsilon to both starts
        const newStart = builder.createState(false);
        builder.addEpsilonTransition(newStart, nfa1.startState + offset1);
        builder.addEpsilonTransition(newStart, nfa2.startState + offset2);
        return builder.build(newStart);
    }
}
