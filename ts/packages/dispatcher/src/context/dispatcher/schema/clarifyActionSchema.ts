// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ClarifyRequestAction =
    | ClarifyMultiplePossibleActionName
    | ClarifyMissingParameter
    | ClarifyUnresolvedReference;
// Ask the user for clarification for ambiguous request that have multiple possible action as interpretation
export interface ClarifyMultiplePossibleActionName {
    actionName: "clarifyMultiplePossibleActionName";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        possibleActionNames: string[];
        clarifyingQuestion: string;
    };
}

// Ask the user for clarification for request is missing parameter in the action
export interface ClarifyMissingParameter {
    actionName: "clarifyMissingParameter";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;
        actionName: string;
        parameterName: string;
        clarifyingQuestion: string;
    };
}

// Ask the user for clarification for the request that parameters are referring to unresolved pronouns or references.
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
