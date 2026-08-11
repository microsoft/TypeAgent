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
        // PowerShell modules to import for the script's cmdlets (e.g.
        // ["NetTCPIP"] for Get-NetTCPConnection). Include every module required
        // by allowedCmdlets — use the same list that made testPowerShellFlow
        // pass, or the flow will fail at invocation with "not recognized".
        allowedModules?: string[];
    };
};

// Create a reusable flow transactionally and execute the requested operation once
export type CreateAndExecutePowerShellFlow = {
    actionName: "createAndExecutePowerShellFlow";
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
        // Grammar patterns for matching future requests
        grammarPatterns: {
            pattern: string;
            isAlias: boolean;
        }[];
        // PowerShell cmdlets the script uses
        allowedCmdlets: string[];
        // PowerShell modules required by the allowed cmdlets
        allowedModules?: string[];
        // JSON string of named parameters for this one execution
        executionParametersJson?: string;
        // Whether the script needs network access
        networkAccess?: boolean;
    };
};

// Add validated phrases to an existing flow without creating a duplicate
export type AddPowerShellFlowPatterns = {
    actionName: "addPowerShellFlowPatterns";
    parameters: {
        flowName: string;
        grammarPatterns: {
            pattern: string;
            isAlias: boolean;
        }[];
    };
};

// Report the machine-readable result of PowerShell capability reasoning
export type ReportPowerShellCapabilityOutcome = {
    actionName: "reportPowerShellCapabilityOutcome";
    parameters: {
        status: "handledExisting" | "created" | "notSuitable" | "failed";
        schema?: string;
        actionName?: string;
        flowName?: string;
        reasonCode?: string;
        phase?: "classify" | "discover" | "validate" | "execute" | "persist";
        mayHaveSideEffects?: boolean;
        reason?: string;
    };
};

// Test a script without registering it
export type TestPowerShellFlow = {
    actionName: "testPowerShellFlow";
    parameters: {
        script: string;
        allowedCmdlets: string[];
        allowedModules?: string[];
        networkAccess?: boolean;
        testParameters?: string;
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
        // Updated list of PowerShell modules to import (optional; preserved if omitted)
        allowedModules?: string[];
    };
};

// Repair an existing flow and retry the requested operation once
export type RepairAndExecutePowerShellFlow = {
    actionName: "repairAndExecutePowerShellFlow";
    parameters: {
        // Existing flow to repair
        flowName: string;
        // Replacement script body
        script: string;
        // Updated cmdlet whitelist
        allowedCmdlets: string[];
        // Updated module whitelist
        allowedModules?: string[];
        // JSON string of named parameters for the retry
        executionParametersJson?: string;
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
    | TestPowerShellFlow
    | CreatePowerShellFlow
    | CreateAndExecutePowerShellFlow
    | AddPowerShellFlowPatterns
    | ReportPowerShellCapabilityOutcome
    | EditPowerShellFlow
    | RepairAndExecutePowerShellFlow
    | ImportPowerShellFlow;
