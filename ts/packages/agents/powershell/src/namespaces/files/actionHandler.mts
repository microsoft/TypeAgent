// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellFilesActions } from "./filesActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const allowedPaths = ["$env:USERPROFILE", "$PWD", "$env:TEMP"] as const;

const definitions = {
    listFiles: {
        script: `param([string]$Path, [string]$Filter, [bool]$Recurse)
if (-not $Path) { $Path = "." }
if ($Filter) {
    Get-ChildItem -Path $Path -Filter $Filter -Recurse:$Recurse
} else {
    Get-ChildItem -Path $Path -Recurse:$Recurse
}`,
        allowedCmdlets: ["Get-ChildItem"],
        allowedPaths,
        parameterRoles: { path: "path" },
    },
    readFile: {
        script: `param([string]$Path, [int]$Tail, [int]$Head)
if ($Tail -gt 0) {
    Get-Content -LiteralPath $Path -Tail $Tail
} elseif ($Head -gt 0) {
    Get-Content -LiteralPath $Path -TotalCount $Head
} else {
    Get-Content -LiteralPath $Path
}`,
        allowedCmdlets: ["Get-Content"],
        allowedPaths,
        parameterRoles: { path: "path" },
    },
    writeFile: {
        script: `param([string]$Path, [string]$Content, [bool]$Append)
if ($Append) {
    Add-Content -LiteralPath $Path -Value $Content
} else {
    Set-Content -LiteralPath $Path -Value $Content
}`,
        allowedCmdlets: ["Add-Content", "Set-Content"],
        allowedPaths,
        parameterRoles: { path: "path" },
        confirmation: "Write content to the requested file?",
    },
    copyFile: {
        script: `param([string]$Source, [string]$Destination, [bool]$Recurse)
Copy-Item -LiteralPath $Source -Destination $Destination -Recurse:$Recurse`,
        allowedCmdlets: ["Copy-Item"],
        allowedPaths,
        parameterRoles: { source: "path", destination: "path" },
        confirmation: "Copy the requested file or directory?",
    },
    moveFile: {
        script: `param([string]$Source, [string]$Destination)
Move-Item -LiteralPath $Source -Destination $Destination`,
        allowedCmdlets: ["Move-Item"],
        allowedPaths,
        parameterRoles: { source: "path", destination: "path" },
        confirmation: "Move or rename the requested file or directory?",
    },
    deleteFile: {
        script: `param([string]$Path, [bool]$Recurse)
Remove-Item -LiteralPath $Path -Recurse:$Recurse`,
        allowedCmdlets: ["Remove-Item"],
        allowedPaths,
        parameterRoles: { path: "path" },
        confirmation: "Delete the requested file or directory?",
    },
    testPath: {
        script: `param([string]$Path)
Test-Path -LiteralPath $Path`,
        allowedCmdlets: ["Test-Path"],
        allowedPaths,
        parameterRoles: { path: "path" },
    },
    findText: {
        script: `param([string]$Pattern, [string]$Path, [string]$Include)
if (-not $Path) { $Path = "." }
if ($Include) {
    Get-ChildItem -Path $Path -Filter $Include -File -Recurse | Select-String -Pattern $Pattern
} else {
    Get-ChildItem -Path $Path -File -Recurse | Select-String -Pattern $Pattern
}`,
        allowedCmdlets: ["Get-ChildItem", "Select-String"],
        allowedPaths,
        parameterRoles: { path: "path" },
    },
    newItem: {
        script: `param([string]$Path, [string]$ItemType)
$type = if ($ItemType -eq "directory") { "Directory" } else { "File" }
New-Item -Path $Path -ItemType $type`,
        allowedCmdlets: ["New-Item"],
        allowedPaths,
        parameterRoles: { path: "path" },
        confirmation: "Create the requested file or directory?",
    },
} satisfies NamespaceActionDefinitions<PowerShellFilesActions>;

export const filesActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellFilesActions>(
        "powershell.powershell-files",
        definitions,
    );
