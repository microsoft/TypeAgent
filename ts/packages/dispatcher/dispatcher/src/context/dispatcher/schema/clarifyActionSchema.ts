// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ClarifyRequestAction =
    | ClarifyMultiplePossibleActionName
    | ClarifyMissingParameter
    | ClarifyUnresolvedReference;

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

// The user request is for an action, but parameters are referring to unresolved pronouns or references that is not found in the request or recent chat context.
export interface ClarifyUnresolvedReference {
    actionName: "clarifyUnresolvedReference";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        actionName: string;
        parameterName: string;
        reference: string; // words of the unresolved pronoun or reference
        clarifyingQuestion: string;
    };
}
