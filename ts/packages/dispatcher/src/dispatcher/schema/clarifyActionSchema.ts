// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The request has ambiguities, including multiple possible actions, multiple interpretations, unresolved references, missing parameters, etc.
export interface ClarifyRequestAction {
    actionName: "clarifyRequest";
    parameters: {
        // the current understood user request that needs to be clarified
        request: string;

        // Possible action name that can be matched to the request.
        possibleActionName: string[];
        ambiguity: string[]; // multiple possible actions, multiple interpretations, unresolved pronoun or references, missing parameters, non-typical parameters, etc.
        clarifyingQuestion: string;
    };
}
