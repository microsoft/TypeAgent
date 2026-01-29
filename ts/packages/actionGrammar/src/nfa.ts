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
 */
export type NFATransitionType = "token" | "epsilon" | "wildcard";

/**
 * A transition from one state to another
 */
export interface NFATransition {
    type: NFATransitionType;

    // For token transitions: the token to match (can have multiple alternatives)
    tokens?: string[] | undefined;

    // For wildcard transitions: metadata about the variable
    variable?: string | undefined;
    typeName?: string | undefined;
    checked?: boolean | undefined; // true if wildcard has validation (entity type or checked_wildcard paramSpec)

    // Target state
    to: number;
}

/**
 * An NFA state with outgoing transitions
 */
export interface NFAState {
    id: number;
    transitions: NFATransition[];

    // If true, this is an accepting/final state
    accepting: boolean;

    // Optional: capture variable value when reaching this state
    capture?:
        | {
              variable: string;
              typeName?: string | undefined;
          }
        | undefined;
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
}

/**
 * Builder helper for constructing NFAs
 */
export class NFABuilder {
    private states: NFAState[] = [];
    private nextStateId = 0;

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
    ): void {
        const state = this.states[from];
        if (!state) {
            throw new Error(`State ${from} does not exist`);
        }
        state.transitions.push({
            type,
            to,
            tokens,
            variable,
            typeName,
            checked,
        });
    }

    addTokenTransition(from: number, to: number, tokens: string[]): void {
        this.addTransition(from, to, "token", tokens);
    }

    addEpsilonTransition(from: number, to: number): void {
        this.addTransition(from, to, "epsilon");
    }

    addWildcardTransition(
        from: number,
        to: number,
        variable: string,
        typeName?: string,
        checked?: boolean,
    ): void {
        this.addTransition(
            from,
            to,
            "wildcard",
            undefined,
            variable,
            typeName,
            checked,
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
        };
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
