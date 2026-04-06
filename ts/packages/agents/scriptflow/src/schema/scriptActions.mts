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

// Execute a registered script flow by name with parameters
export type ExecuteScriptFlow = {
    actionName: "executeScriptFlow";
    parameters: {
        // Name of the script flow to execute (use listScriptFlows to see available flows)
        flowName: string;
        // Captured arguments from the user's request (e.g. a path or filter)
        flowArgs?: string;
        // JSON string of named parameters e.g. '{"Directory":"C:\\Users","Pattern":"*.txt"}'
        flowParametersJson?: string;
    };
};

// Create a new script flow with grammar rules for future reuse
export type CreateScriptFlow = {
    actionName: "createScriptFlow";
    parameters: {
        // camelCase identifier for the new flow
        actionName: string;
        // What this script does
        description: string;
        // Human-readable name
        displayName: string;
        // PowerShell script body (should include param() block)
        script: string;
        // Script parameters
        scriptParameters: {
            name: string;
            type: "string" | "number" | "boolean" | "path";
            required: boolean;
            description: string;
            default?: string;
        }[];
        // Grammar patterns for matching
        grammarPatterns: {
            pattern: string;
            isAlias: boolean;
        }[];
        // PowerShell cmdlets the script uses
        allowedCmdlets: string[];
    };
};

// Edit an existing script flow's script body (preserves grammar patterns and parameters)
export type EditScriptFlow = {
    actionName: "editScriptFlow";
    parameters: {
        // Name of the script flow to edit
        flowName: string;
        // New PowerShell script body (should include param() block matching existing parameters)
        script: string;
        // Updated list of PowerShell cmdlets the script uses
        allowedCmdlets: string[];
    };
};

// Import an existing PowerShell script file as a new script flow
export type ImportScriptFlow = {
    actionName: "importScriptFlow";
    parameters: {
        // Absolute or relative path to the .ps1 file to import
        filePath: string;
        // Optional: override the generated action name
        actionName?: string;
    };
};

export type ScriptFlowActions =
    | ListScriptFlows
    | DeleteScriptFlow
    | ExecuteScriptFlow
    | CreateScriptFlow
    | EditScriptFlow
    | ImportScriptFlow;
