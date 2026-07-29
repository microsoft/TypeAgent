// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ClarifyRequestAction =
    | ClarifyMultiplePossibleActionName
    | ClarifyMissingParameter
    | ClarifyUnresolvedReference
    | ClarifyMultipleAgentMatches;

// Ask the user for clarification for ambiguous request that have multiple possible known action as interpretation.
// Don't clarify "unknown" action.
export interface ClarifyMultiplePossibleActionName {
    actionName: "clarifyMultiplePossibleActionName";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        // Known actionNames to be clarify.  Don't clarify "unknown" action.
        possibleActionNames: string[];
        clarifyingQuestion: string;
    };
}

// The user request is for a known action, but a required parameter is missing
// entirely: the user gave no value for it, and no pronoun, reference, or memory
// points at one. Ask the user to supply the missing parameter. Don't clarify
// "unknown" action. If the value IS referred to but can't be resolved (e.g.
// "the one we talked about", "it", "that file", "the one from before"), use
// ClarifyUnresolvedReference instead.
export interface ClarifyMissingParameter {
    actionName: "clarifyMissingParameter";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        // A known actionName to be clarify.  Don't clarify "unknown" action.
        actionName: string;
        parameterName: string;
        clarifyingQuestion: string;
    };
}

// The user request is for a known action and does not refer to the parameter's
// value directly, but rather through a pronoun, reference, or memory that can't be resolved
// directly from the request or chat history (e.g. "from the movie we talked about
// yesterday", "print that file", "it"). Ask the user what the reference points to.
export interface ClarifyUnresolvedReference {
    actionName: "clarifyUnresolvedReference";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        actionName: string;
        parameterName: string;
        reference: string; // words of the unresolved pronoun, reference, or memory
        clarifyingQuestion: string;
    };
}

// The user request was matched by more than one agent's schema/grammar simultaneously
// (a cross-agent action collision). List the candidate (schemaName, actionName) pairs
// so the user can disambiguate. This differs from ClarifyMultiplePossibleActionName,
// which only lists action names within a single schema.
export interface ClarifyMultipleAgentMatches {
    actionName: "clarifyMultipleAgentMatches";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        candidates: AgentMatchCandidate[];
        clarifyingQuestion: string;
    };
}

export interface AgentMatchCandidate {
    schemaName: string;
    actionName: string;
    score?: number;
}
