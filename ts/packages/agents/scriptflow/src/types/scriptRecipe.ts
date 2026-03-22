// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ScriptRecipe {
    version: 1;
    actionName: string;
    description: string;
    displayName: string;
    parameters: ScriptParameter[];
    script: {
        language: "powershell";
        body: string;
        expectedOutputFormat: "text" | "json" | "objects" | "table";
    };
    grammarPatterns: GrammarPattern[];
    sandbox: SandboxPolicy;
    source?: {
        type: "reasoning" | "manual";
        requestId?: string;
        timestamp: string;
        originalRequest?: string;
    };
}

export interface ScriptParameter {
    name: string;
    type: "string" | "number" | "boolean" | "path";
    required: boolean;
    description: string;
    default?: unknown;
    validation?: {
        pattern?: string;
        allowedValues?: string[];
        pathMustExist?: boolean;
    };
}

export interface GrammarPattern {
    pattern: string;
    isAlias: boolean;
    examples: string[];
}

export interface SandboxPolicy {
    allowedCmdlets: string[];
    allowedPaths: string[];
    allowedModules: string[];
    maxExecutionTime: number;
    networkAccess: boolean;
}

export type ScriptCategory =
    | "file-operations"
    | "content-search"
    | "process-management"
    | "system-info"
    | "network"
    | "text-processing"
    | "other";

export const SAFE_CMDLET_SETS: Record<ScriptCategory, string[]> = {
    "file-operations": [
        "Get-ChildItem",
        "Get-Item",
        "Test-Path",
        "Resolve-Path",
        "Copy-Item",
        "Move-Item",
        "New-Item",
        "Remove-Item",
        "Get-Content",
        "Set-Content",
        "Add-Content",
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "ForEach-Object",
        "Format-Table",
        "Format-List",
        "Out-String",
        "Measure-Object",
        "Group-Object",
    ],
    "content-search": [
        "Get-ChildItem",
        "Get-Content",
        "Select-String",
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "ForEach-Object",
        "Format-Table",
        "Out-String",
        "Measure-Object",
    ],
    "process-management": [
        "Get-Process",
        "Stop-Process",
        "Start-Process",
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "Format-Table",
        "Format-List",
        "Out-String",
    ],
    "system-info": [
        "Get-ComputerInfo",
        "Get-Service",
        "Get-WmiObject",
        "Get-ItemProperty",
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "Format-Table",
        "Format-List",
        "Out-String",
    ],
    network: [
        "Test-NetConnection",
        "Resolve-DnsName",
        "Invoke-WebRequest",
        "Invoke-RestMethod",
        "Select-Object",
        "Where-Object",
        "ConvertFrom-Json",
        "ConvertTo-Json",
        "Format-Table",
        "Out-String",
    ],
    "text-processing": [
        "Get-Content",
        "Set-Content",
        "Select-String",
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "ForEach-Object",
        "ConvertFrom-Csv",
        "ConvertTo-Csv",
        "ConvertFrom-Json",
        "ConvertTo-Json",
        "Format-Table",
        "Out-String",
        "Measure-Object",
    ],
    other: [
        "Select-Object",
        "Sort-Object",
        "Where-Object",
        "ForEach-Object",
        "Format-Table",
        "Out-String",
    ],
};

export const BLOCKED_CMDLETS = [
    "Invoke-Expression",
    "New-Object",
    "Add-Type",
    "Start-Process",
    "Set-ExecutionPolicy",
    "Register-ScheduledTask",
    "Register-ObjectEvent",
    "Register-EngineEvent",
    "Register-WmiEvent",
    "Unregister-ScheduledTask",
    "Unregister-Event",
    "Enable-PSRemoting",
    "Enter-PSSession",
    "New-PSSession",
];
