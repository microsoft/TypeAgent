// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Ask the user for clarification for the request that has ambiguities such as missing parameters, multiple possible actions, multiple interpretations, unresolved references, etc.
// The translation must be based only on the user request and may consider available information in chat history.
// Do not make assumptions and generate parameters that are not in the user request or chat history.
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
