// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lists all registered script flows
export type ListScriptFlows = {
    actionName: "listScriptFlows";
};

// Delete a script flow by name
export type DeleteScriptFlow = {
    actionName: "deleteScriptFlow";
    parameters: {
        // Name of the script flow to delete
        name: string;
    };
};

export type ScriptFlowActions = ListScriptFlows | DeleteScriptFlow;
