// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// If the user requests requires multiple action or steps, use the reasoning action.
export interface ReasoningAction {
    actionName: "reasoningAction";
    parameters: {
        // The original user request
        originalRequest: string;
    };
}
