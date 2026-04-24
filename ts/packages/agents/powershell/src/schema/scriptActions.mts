// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lists all registered PowerShell flows
export type ListPowerShellFlows = {
    actionName: "listPowerShellFlows";
};

// Delete a PowerShell flow by name
export type DeletePowerShellFlow = {
    actionName: "deletePowerShellFlow";
    parameters: {
        // Name of the PowerShell flow to delete
        name: string;
    };
};

// Execute a registered PowerShell flow by name with parameters
export type ExecutePowerShellFlow = {
    actionName: "executePowerShellFlow";
    parameters: {
        // Name of the PowerShell flow to execute (use listPowerShellFlows to see available flows)
        flowName: string;
        // Captured arguments from the user's request (e.g. a path or filter)
        flowArgs?: string;
        // JSON string of named parameters e.g. '{"Directory":"C:\\Users","Pattern":"*.txt"}'
        flowParametersJson?: string;
    };
};

// Create a new PowerShell flow with grammar rules for future reuse
export type CreatePowerShellFlow = {
    actionName: "createPowerShellFlow";
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

// Edit an existing PowerShell flow's script body (preserves grammar patterns and parameters)
export type EditPowerShellFlow = {
    actionName: "editPowerShellFlow";
    parameters: {
        // Name of the PowerShell flow to edit
        flowName: string;
        // New PowerShell script body (should include param() block matching existing parameters)
        script: string;
        // Updated list of PowerShell cmdlets the script uses
        allowedCmdlets: string[];
    };
};

// Import an existing PowerShell script file as a new PowerShell flow
export type ImportPowerShellFlow = {
    actionName: "importPowerShellFlow";
    parameters: {
        // Absolute or relative path to the .ps1 file to import
        filePath: string;
        // Optional: override the generated action name
        actionName?: string;
    };
};

export type PowerShellActions =
    | ListPowerShellFlows
    | DeletePowerShellFlow
    | ExecutePowerShellFlow
    | CreatePowerShellFlow
    | EditPowerShellFlow
    | ImportPowerShellFlow;
