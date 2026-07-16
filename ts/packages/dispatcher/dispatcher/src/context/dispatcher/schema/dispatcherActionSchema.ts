// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherActions = UnknownAction;

// Use UnknownAction when all the available actions in the schema is not relevant to the user request
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // user request that couldn't be matched to any action or schema group to look up from.
        request: string;
        // Why none of the available actions fit this request. Name the
        // action(s) that came closest and say what was missing. Be specific:
        // this is used to find gaps in the action schemas.
        reason: string;
    };
}
