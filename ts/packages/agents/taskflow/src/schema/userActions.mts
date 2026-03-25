// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lists all registered task flows
export type ListTaskFlows = {
    actionName: "listTaskFlows";
};

// Delete a task flow by name
export type DeleteTaskFlow = {
    actionName: "deleteTaskFlow";
    parameters: {
        name: string;
    };
};

// Execute a registered task flow by name with parameters
export type ExecuteTaskFlow = {
    actionName: "executeTaskFlow";
    parameters: {
        flowName: string;
        [key: string]: unknown;
    };
};

export type TaskFlowActions = ListTaskFlows | DeleteTaskFlow | ExecuteTaskFlow;
