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
$timeoutMilliseconds = 5000
if ($Port -gt 0) {
    $client = [System.Net.Sockets.TcpClient]::new()
    $remoteAddress = $null
    $tcpTestSucceeded = $false
    $errorMessage = $null
    try {
        $connectTask = $client.ConnectAsync($ComputerName, $Port)
        if ($connectTask.Wait($timeoutMilliseconds)) {
            $tcpTestSucceeded = $client.Connected
            if ($client.Client.RemoteEndPoint) {
                $remoteEndPoint = [System.Net.IPEndPoint]$client.Client.RemoteEndPoint
                $remoteAddress = $remoteEndPoint.Address.IPAddressToString
            }
        } else {
            $errorMessage = "Connection timed out after $timeoutMilliseconds ms."
        }
    } catch {
        $errorMessage = $_.Exception.GetBaseException().Message
    } finally {
        $client.Dispose()
    }
    [PSCustomObject]@{
        ComputerName = $ComputerName
        RemoteAddress = $remoteAddress
        RemotePort = $Port
        TcpTestSucceeded = $tcpTestSucceeded
        Error = $errorMessage
    }
} else {
    $ping = [System.Net.NetworkInformation.Ping]::new()
    try {
        $reply = $ping.Send($ComputerName, $timeoutMilliseconds)
        [PSCustomObject]@{
            ComputerName = $ComputerName
            RemoteAddress = if ($reply.Address) { $reply.Address.IPAddressToString } else { $null }
            PingSucceeded = $reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success
            PingReplyDetails = [PSCustomObject]@{
                RoundtripTime = $reply.RoundtripTime
            }
            Status = [string]$reply.Status
        }
    } catch {
        [PSCustomObject]@{
            ComputerName = $ComputerName
            RemoteAddress = $null
            PingSucceeded = $false
            PingReplyDetails = $null
            Status = "Error"
            Error = $_.Exception.GetBaseException().Message
        }
    } finally {
        $ping.Dispose()
    }
}`,
        allowedCmdlets: [],
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
foreach ($interface in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($InterfaceAlias -and $interface.Name -ine $InterfaceAlias) {
        continue
    }
    $properties = $interface.GetIPProperties()
    $ipv4Addresses = @()
    $ipv6Addresses = @()
    $ipv4Gateways = @()
    $ipv6Gateways = @()
    $dnsAddresses = @()
    foreach ($address in $properties.UnicastAddresses) {
        if ($address.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            $ipv4Addresses += $address.Address.IPAddressToString
        } elseif ($address.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
            $ipv6Addresses += $address.Address.IPAddressToString
        }
    }
    foreach ($gateway in $properties.GatewayAddresses) {
        if ($gateway.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            $ipv4Gateways += $gateway.Address.IPAddressToString
        } elseif ($gateway.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
            $ipv6Gateways += $gateway.Address.IPAddressToString
        }
    }
    foreach ($dnsAddress in $properties.DnsAddresses) {
        $dnsAddresses += $dnsAddress.IPAddressToString
    }
    [PSCustomObject]@{
        InterfaceAlias = $interface.Name
        InterfaceDescription = $interface.Description
        Status = [string]$interface.OperationalStatus
        IPv4Address = $ipv4Addresses -join ", "
        IPv6Address = $ipv6Addresses -join ", "
        IPv4DefaultGateway = $ipv4Gateways -join ", "
        IPv6DefaultGateway = $ipv6Gateways -join ", "
        DNSServer = $dnsAddresses -join ", "
    }
}`,
        allowedCmdlets: [],
        networkAccess: false,
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
