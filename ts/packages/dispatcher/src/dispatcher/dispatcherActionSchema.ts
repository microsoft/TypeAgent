// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherActions = ClarifyRequestAction | UnknownAction;

// The request has ambiguities, including multiple possible actions, multiple interpretations, unresolved references, missing parameters, etc.
export interface ClarifyRequestAction {
    actionName: "clarifyRequest";
    parameters: {
        // user request that needs to be clarification
        request: string;

        // Possible action name that can be matched to the request.
        possibleActionName: string[];
        ambiguity: string[]; // multiple possible actions, multiple interpretations, unresolved pronoun or references, missing parameters, non-typical parameters, etc.
        clarifyingQuestion: string;
    };
}

// the user request isn't any of the action available
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // user request that couldn't be matched to any action
        request: string;
    };
}
