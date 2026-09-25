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

# Reset on every attempt, including Repair, so a previous success cannot hide
# an interrupted or failed registration. Deferred actions cannot set UI properties.
$statusPath = "$LogPath.status"
$exitCode = 1
try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
    Set-Content -LiteralPath $statusPath -Value "incomplete" -Encoding ASCII
    . (Join-Path $PSScriptRoot "resolve-node.ps1")

    $registerScript = Join-Path $InstallDir "register-plugin.mjs"
    if (-not (Test-Path $registerScript)) {
        $registerScript = Join-Path $PSScriptRoot "register-plugin.mjs"
    }
    if (-not (Test-Path $registerScript)) {
        throw "Shared script not found: register-plugin.mjs"
    }

    $nodeExe = Resolve-NodeExe
    if (-not $nodeExe) {
        throw "Node.js was not found (needed to run register-plugin.mjs)."
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
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0 -and -not $Uninstall) {
        Set-Content -LiteralPath $statusPath -Value "complete" -Encoding ASCII
    }
} catch {
    $exitCode = 1
    $message = "[TypeAgent] Registration failed: $($_.Exception.Message)"
    Write-Host $message
    Add-Content -LiteralPath $LogPath -Value $message
}

if ($exitCode -ne 0 -and -not $Uninstall) {
    $message = "[TypeAgent] Copilot plugin setup is incomplete. Reopen the TypeAgent MSI and choose Repair to retry. Log: $LogPath"
    Write-Host $message
    Add-Content -LiteralPath $LogPath -Value $message
}
exit $exitCode
