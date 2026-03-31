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

export type TaskFlowActions = ListTaskFlows | DeleteTaskFlow;
