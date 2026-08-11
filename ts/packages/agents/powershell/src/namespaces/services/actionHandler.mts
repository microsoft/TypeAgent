// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellServicesActions } from "./servicesActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const definitions = {
    listServices: {
        script: `param([string]$Name, [string]$Status)
$services = if ($Name) { Get-Service -Name $Name } else { Get-Service }
if ($Status) { $services | Where-Object { $_.Status.ToString() -eq $Status } } else { $services }`,
        allowedCmdlets: ["Get-Service", "Where-Object"],
    },
    serviceStatus: {
        script: `param([string]$Name)
Get-Service -Name $Name`,
        allowedCmdlets: ["Get-Service"],
    },
    startService: {
        script: `param([string]$Name)
Start-Service -Name $Name`,
        allowedCmdlets: ["Start-Service"],
        confirmation: "Start the requested Windows service?",
    },
    stopService: {
        script: `param([string]$Name)
Stop-Service -Name $Name`,
        allowedCmdlets: ["Stop-Service"],
        confirmation: "Stop the requested Windows service?",
    },
    restartService: {
        script: `param([string]$Name)
Restart-Service -Name $Name`,
        allowedCmdlets: ["Restart-Service"],
        confirmation: "Restart the requested Windows service?",
    },
} satisfies NamespaceActionDefinitions<PowerShellServicesActions>;

export const servicesActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellServicesActions>(
        "powershell.powershell-services",
        definitions,
    );
