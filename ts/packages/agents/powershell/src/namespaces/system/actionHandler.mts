// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellSystemActions } from "./systemActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const definitions = {
    systemInfo: {
        script: `Get-CimInstance Win32_OperatingSystem
Get-CimInstance Win32_ComputerSystem`,
        allowedCmdlets: ["Get-CimInstance"],
    },
    diskUsage: {
        script: `param([string]$DriveLetter)
$drives = Get-PSDrive -PSProvider FileSystem
if ($DriveLetter) { $drives | Where-Object { $_.Name -eq $DriveLetter } } else { $drives }`,
        allowedCmdlets: ["Get-PSDrive", "Where-Object"],
    },
    hotFixes: {
        script: "Get-HotFix",
        allowedCmdlets: ["Get-HotFix"],
    },
    uptime: {
        script: `(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime`,
        allowedCmdlets: ["Get-Date", "Get-CimInstance"],
    },
    envVars: {
        script: `param([string]$Name)
if ($Name) { Get-Item -LiteralPath "Env:$Name" } else { Get-ChildItem Env: }`,
        allowedCmdlets: ["Get-Item", "Get-ChildItem"],
    },
} satisfies NamespaceActionDefinitions<PowerShellSystemActions>;

export const systemActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellSystemActions>(
        "powershell.powershell-system",
        definitions,
    );
