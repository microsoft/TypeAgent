# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Registers (or unregisters) the TypeAgent plugin with GitHub Copilot CLI.

.DESCRIPTION
    Thin Windows wrapper that refreshes the stale MSI environment and delegates
    Copilot CLI discovery and registration to the shared Node script.
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Uninstall,
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\msi-register-plugin.log"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "resolve-node.ps1")

$registerScript = Join-Path $InstallDir "register-plugin.mjs"
if (-not (Test-Path $registerScript)) {
    $registerScript = Join-Path $PSScriptRoot "register-plugin.mjs"
}
if (-not (Test-Path $registerScript)) {
    Write-Host "[TypeAgent] Registration failed. Shared script not found: register-plugin.mjs"
    exit 1
}

$nodeExe = Resolve-NodeExe
if (-not $nodeExe) {
    Write-Host "[TypeAgent] Registration failed. Node.js was not found (needed to run register-plugin.mjs)."
    exit 1
}

$args = @(
    $registerScript,
    "--install-dir", $InstallDir,
    "--log-path", $LogPath
)
$pathCommand = Get-Command copilot -ErrorAction SilentlyContinue
if ($pathCommand -and $pathCommand.Source) {
    $args += @("--copilot-path", $pathCommand.Source)
}
if ($Uninstall) {
    $args += "--uninstall"
}

& $nodeExe @args
exit $LASTEXITCODE
