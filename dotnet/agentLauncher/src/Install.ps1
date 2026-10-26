# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Install the development AgentLauncher MSIX for the current user.
.DESCRIPTION
    Enroll the public signing certificate separately after verifying its identity.
    Obtain ExpectedSignerThumbprint independently of the downloaded package.
    This script never elevates or changes certificate stores.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Fa-f0-9]{40}$')]
    [string]$ExpectedSignerThumbprint,
    [string]$PackagePath = (Join-Path $PSScriptRoot "bin\x64\Debug\net8.0-windows10.0.26100.0\AppPackages\AgentLauncher_1.0.0.0_x64_Debug_Test\AgentLauncher_1.0.0.0_x64_Debug.msix")
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-AgentLauncher {
    if (Test-IsAdministrator) {
        throw "Run this per-user installer from a non-elevated PowerShell session."
    }

    $package = Get-Item -LiteralPath $PackagePath -Force
    if ($package.PSIsContainer -or $package.Extension -ne ".msix") {
        throw "Expected an MSIX package: $PackagePath"
    }
    $item = $package
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Package paths must not contain reparse points."
        }
        $item = if ($item -is [IO.FileInfo]) { $item.Directory } else { $item.Parent }
    }

    $stream = [IO.File]::Open($package.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $signature = Get-AuthenticodeSignature -LiteralPath $package.FullName
        if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Thumbprint -ne $ExpectedSignerThumbprint) {
            throw "The MSIX signature is not trusted or does not match the independently approved signer. Establish public certificate trust separately before installation."
        }

        Add-Type -AssemblyName System.IO.Compression
        $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read, $true)
        try {
            $manifestEntry = $archive.GetEntry("AppxManifest.xml")
            if ($null -eq $manifestEntry) { throw "MSIX is missing AppxManifest.xml." }
            $reader = New-Object IO.StreamReader($manifestEntry.Open())
            try {
                $manifest = New-Object System.Xml.XmlDocument
                $manifest.XmlResolver = $null
                $manifest.LoadXml($reader.ReadToEnd())
            } finally {
                $reader.Dispose()
            }
            if ($manifest.Package.Identity.Name -ne "TypeAgent.AgentLauncher" -or
                $manifest.Package.Identity.Publisher -ne $signature.SignerCertificate.Subject) {
                throw "Unexpected AgentLauncher package identity or publisher."
            }
        } finally {
            $archive.Dispose()
        }

        # Add-AppxPackage updates an existing package without uninstalling it first.
        Add-AppxPackage -Path $package.FullName -ErrorAction Stop
        $installed = Get-AppxPackage -Name "TypeAgent.AgentLauncher" -ErrorAction Stop
        if (-not $installed) { throw "AgentLauncher was not found after installation." }
        Write-Host "Installed TypeAgent.AgentLauncher $($installed.Version) for the current user."
    } finally {
        $stream.Dispose()
    }
}

try {
    Install-AgentLauncher
} catch {
    Write-Error "AgentLauncher installation failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
