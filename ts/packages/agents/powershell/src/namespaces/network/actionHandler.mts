// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellNetworkActions } from "./networkActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const definitions = {
    testConnection: {
        script: `param([string]$ComputerName, [int]$Port)
if ($Port -gt 0) {
    Test-NetConnection -ComputerName $ComputerName -Port $Port
} else {
    Test-NetConnection -ComputerName $ComputerName
}`,
        allowedCmdlets: ["Test-NetConnection"],
        networkAccess: true,
    },
    portListeners: {
        script: `param([int]$Port)
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
if ($Port -gt 0) {
    $listeners = $listeners | Where-Object { $_.LocalPort -eq $Port }
}
$listeners |
    Sort-Object LocalPort, OwningProcess |
    ForEach-Object {
        $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        [PSCustomObject]@{
            LocalAddress = $_.LocalAddress
            LocalPort = $_.LocalPort
            ProcessId = $_.OwningProcess
            ProcessName = if ($process) { $process.ProcessName } else { "(unknown)" }
        }
    }`,
        allowedCmdlets: [
            "Get-NetTCPConnection",
            "Where-Object",
            "Sort-Object",
            "ForEach-Object",
            "Get-Process",
        ],
        networkAccess: true,
    },
    networkAdapters: {
        script: `param([string]$Name)
if ($Name) {
    Get-NetAdapter -Name $Name
} else {
    Get-NetAdapter
}`,
        allowedCmdlets: ["Get-NetAdapter"],
        networkAccess: true,
    },
    ipConfig: {
        script: `param([string]$InterfaceAlias)
if ($InterfaceAlias) {
    Get-NetIPConfiguration -InterfaceAlias $InterfaceAlias
} else {
    Get-NetIPConfiguration
}`,
        allowedCmdlets: ["Get-NetIPConfiguration"],
        networkAccess: true,
    },
    dnsLookup: {
        script: `param([string]$Name, [string]$Type)
if ($Type) {
    Resolve-DnsName -Name $Name -Type $Type
} else {
    Resolve-DnsName -Name $Name
}`,
        allowedCmdlets: ["Resolve-DnsName"],
        networkAccess: true,
    },
} satisfies NamespaceActionDefinitions<PowerShellNetworkActions>;

export const networkActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellNetworkActions>(
        "powershell.powershell-network",
        definitions,
    );
