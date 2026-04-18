// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// If the user requests requires multiple action or steps, use the reasoning action.
export interface ReasoningAction {
    actionName: "reasoningAction";
    parameters: {
        // The original user request
        originalRequest: string;
        // JSON-serialized action object — agents populate this when redirecting a
        // translated action so the reasoning loop knows what was intended.
        attemptedAction?: string;
        // JSON-serialized entities on the stack at the time of redirect.
        contextEntities?: string;
    };
}
