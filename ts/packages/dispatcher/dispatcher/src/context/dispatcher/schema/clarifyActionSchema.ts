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

// The user request is for an action, but some of the parameter is not specified or cannot be infer from the context.
// Ask the user for clarification for the missing parameter of an known action. Don't clarify unknown action.
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

// The user request is for an action but parameters are referring to unresolved pronouns, memories, or references that are not available in the request or chat history.
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
