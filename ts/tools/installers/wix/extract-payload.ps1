# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Extracts (or on uninstall removes) the TypeAgent payload archives bundled by
  the MSI. The MSI ships agent-server and copilot-plugin as single zip files
  under <Root>\payload instead of tens of thousands of individually-tracked
  files. Harvesting node_modules as one Component per file made the Windows
  Installer "Computing space requirements" (CostFinalize) step take minutes;
  collapsing each tree into one File component makes that step trivial, and this
  script does the unpack at install time (outside the cost calculation).

.PARAMETER Root
  TYPEAGENTROOT, e.g. %LOCALAPPDATA%\TypeAgent\. Contains payload\*.zip and is
  the parent of the agent-server\ and copilot-plugin\ extraction targets.

.PARAMETER Payload
  Extract only the named payload. Omit to extract both payloads.

.PARAMETER Uninstall
  Remove the extracted directories instead of creating them.
#>
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [ValidateSet("agent-server", "copilot-plugin")][string]$Payload,
    [string]$LogPath,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$message) {
    $line = "{0} {1}" -f (Get-Date -Format "s"), $message
    Write-Host $line
    if ($LogPath) {
        try {
            $dir = Split-Path -Parent $LogPath
            if ($dir -and -not (Test-Path $dir)) {
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
            }
            Add-Content -Path $LogPath -Value $line
        } catch {
            # Logging must never fail the install.
        }
    }
}

# <target-dir-name> = <zip-file-name> under <Root>\payload
$payloads = @(
    @{ Name = "agent-server";   Zip = "agent-server.zip" },
    @{ Name = "copilot-plugin"; Zip = "copilot-plugin.zip" }
)
if ($Payload) {
    $payloads = @($payloads | Where-Object { $_.Name -eq $Payload })
}

$payloadDir = Join-Path $Root "payload"

try {
    if ($Uninstall) {
        foreach ($p in $payloads) {
            $target = Join-Path $Root $p.Name
            if (Test-Path $target) {
                Write-Log "Removing $target"
                Remove-Item -Recurse -Force $target
            }
        }
        Write-Log "Payload cleanup complete."
        exit 0
    }

    $tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not (Test-Path $tarExe)) {
        throw "Windows tar.exe was not found at $tarExe."
    }

    foreach ($p in $payloads) {
        $zip = Join-Path $payloadDir $p.Zip
        $target = Join-Path $Root $p.Name

        if (-not (Test-Path $zip)) {
            throw "Payload archive not found: $zip"
        }

        # Clean the target so upgrades don't leave stale files behind.
        if (Test-Path $target) {
            Write-Log "Clearing existing $target"
            Remove-Item -Recurse -Force $target
        }
        New-Item -ItemType Directory -Force -Path $target | Out-Null

        Write-Log "Extracting $zip -> $target with tar.exe"
        $output = & $tarExe -xf $zip -C $target 2>&1
        $exitCode = $LASTEXITCODE
        $output | ForEach-Object { Write-Log "tar> $_" }
        if ($exitCode -ne 0) {
            throw "tar.exe exited with code $exitCode while extracting $zip."
        }
    }

    Write-Log "Payload extraction complete: $($payloads.Name -join ', ')."
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
