// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellProcessesActions } from "./processesActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const definitions = {
    listProcesses: {
        script: `param([string]$Name, [int]$TopN)
$items = if ($Name) { Get-Process -Name $Name } else { Get-Process }
if ($TopN -gt 0) { $items | Select-Object -First $TopN } else { $items }`,
        allowedCmdlets: ["Get-Process", "Select-Object"],
    },
    processMemory: {
        script: `param([int]$TopN, [string]$Name)
if ($TopN -le 0) { $TopN = 10 }
$items = if ($Name) { Get-Process -Name $Name } else { Get-Process }
$items | Sort-Object WorkingSet64 -Descending | Select-Object -First $TopN Name, Id, WorkingSet64`,
        allowedCmdlets: ["Get-Process", "Sort-Object", "Select-Object"],
    },
    processCpu: {
        script: `param([int]$TopN, [string]$Name)
if ($TopN -le 0) { $TopN = 10 }
$items = if ($Name) { Get-Process -Name $Name } else { Get-Process }
$items | Sort-Object CPU -Descending | Select-Object -First $TopN Name, Id, CPU`,
        allowedCmdlets: ["Get-Process", "Sort-Object", "Select-Object"],
    },
    stopProcess: {
        script: `param([string]$Name, [int]$Id)
if ($Id -gt 0) { Stop-Process -Id $Id } else { Stop-Process -Name $Name }`,
        allowedCmdlets: ["Stop-Process"],
        confirmation: "Stop the requested process?",
    },
    startProcess: {
        script: `param([string]$Path, [string]$Arguments)
if ($Arguments) { Start-Process -FilePath $Path -ArgumentList $Arguments } else { Start-Process -FilePath $Path }`,
        allowedCmdlets: ["Start-Process"],
        allowedPaths: ["$env:USERPROFILE", "$PWD", "$env:TEMP"],
        confirmation: "Start the requested process?",
    },
    waitProcess: {
        script: `param([string]$Name, [int]$Id)
if ($Id -gt 0) { Wait-Process -Id $Id } else { Wait-Process -Name $Name }`,
        allowedCmdlets: ["Wait-Process"],
    },
} satisfies NamespaceActionDefinitions<PowerShellProcessesActions>;

export const processesActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellProcessesActions>(
        "powershell.powershell-processes",
        definitions,
    );
