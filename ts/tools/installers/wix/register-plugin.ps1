# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Registers (or unregisters) the TypeAgent plugin with GitHub Copilot CLI.

.DESCRIPTION
    Thin Windows wrapper that discovers a safe Copilot CLI path in MSI context
    and delegates all registration logic to the shared Node script:
    register-plugin.mjs.
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Uninstall,
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\msi-register-plugin.log"
)

$ErrorActionPreference = "Stop"

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-VsCodeCopilotShimPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $shimRoot = Join-Path $env:APPDATA "Code\User\globalStorage\github.copilot-chat\copilotCli"
    try {
        $resolvedPath = (Resolve-Path -Path $Path -ErrorAction SilentlyContinue).Path
        $resolvedShimRoot = (Resolve-Path -Path $shimRoot -ErrorAction SilentlyContinue).Path
        if ($resolvedPath -and $resolvedShimRoot) {
            return $resolvedPath.StartsWith($resolvedShimRoot, [System.StringComparison]::OrdinalIgnoreCase)
        }
    }
    catch {
        # If resolution fails, fall back to string test below.
    }

    return $Path -like "*$([IO.Path]::DirectorySeparatorChar)Code$([IO.Path]::DirectorySeparatorChar)User$([IO.Path]::DirectorySeparatorChar)globalStorage$([IO.Path]::DirectorySeparatorChar)github.copilot-chat$([IO.Path]::DirectorySeparatorChar)copilotCli*"
}

function Find-CopilotCli {
    $candidates = @()
    $rejectedShimPaths = @()

    try {
        # 1) Optional explicit override for deterministic installs.
        if ($env:COPILOT_CLI_PATH) {
            $candidates += $env:COPILOT_CLI_PATH
        }

        # 2) Typical npm global shims on Windows.
        $candidates += (Join-Path $env:APPDATA "npm\copilot.cmd")
        $candidates += (Join-Path $env:APPDATA "npm\copilot.ps1")

        # 2b) Winget links location (common for copilot.exe installs).
        $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft\\WinGet\\Links\\copilot.exe")

        # 3) PATH discovery, similar to install-typeagent.ps1.
        $cmd = Get-Command copilot -ErrorAction SilentlyContinue
        if ($cmd) {
            $candidates += $cmd.Source
        }

        foreach ($candidate in ($candidates | Select-Object -Unique)) {
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                continue
            }

            if (-not (Test-Path $candidate)) {
                continue
            }

            if (Test-VsCodeCopilotShimPath -Path $candidate) {
                $rejectedShimPaths += $candidate
                continue
            }

            return $candidate
        }

        # Final fallback: if command exists and is not a VS Code shim, use it by name.
        if (Test-Command -Name "copilot") {
            $pathResolved = (Get-Command copilot -ErrorAction SilentlyContinue).Source
            if (-not [string]::IsNullOrWhiteSpace($pathResolved) -and -not (Test-VsCodeCopilotShimPath -Path $pathResolved)) {
                return "copilot"
            }
        }
    } catch {
        # Fall through and report not found.
    }

    if ($rejectedShimPaths.Count -gt 0) {
        Write-Host "[TypeAgent] Rejected VS Code wrapper path(s) for MSI context: $($rejectedShimPaths -join '; ')"
    }
    return $null
}

$copilotPath = Find-CopilotCli
if (-not $copilotPath) {
    Write-Host "[TypeAgent] Registration failed. GitHub Copilot CLI not found in MSI-safe locations."
    exit 1
}

$registerScript = Join-Path $InstallDir "register-plugin.mjs"
if (-not (Test-Path $registerScript)) {
    $registerScript = Join-Path $PSScriptRoot "register-plugin.mjs"
}
if (-not (Test-Path $registerScript)) {
    Write-Host "[TypeAgent] Registration failed. Shared script not found: register-plugin.mjs"
    exit 1
}

$env:COPILOT_CLI_PATH = $copilotPath

$args = @(
    $registerScript,
    "--install-dir", $InstallDir,
    "--log-path", $LogPath
)
if ($Uninstall) {
    $args += "--uninstall"
}

& node @args
exit $LASTEXITCODE
