// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// If the user requests requires multiple action or steps, use the reasoning action.
export interface ReasoningAction {
    actionName: "reasoningAction";
    parameters: {
        // The original user request
        originalRequest: string;
        // Why this request needs multi-step reasoning instead of a single known
        // action. Name the action(s) or schema that came closest and say what
        // made a direct translation insufficient. Be specific: this is used to
        // find gaps in the action schemas.
        reason?: string;
        // JSON-serialized action object — agents populate this when redirecting a
        // translated action so the reasoning loop knows what was intended.
        attemptedAction?: string;
        // JSON-serialized entities on the stack at the time of redirect.
        contextEntities?: string;
    };
}
