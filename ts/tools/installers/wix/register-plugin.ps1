# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Registers (or unregisters) the TypeAgent plugin with the GitHub Copilot CLI.

.DESCRIPTION
    Called automatically by the TypeAgent MSI installer as a deferred custom
    action.  Can also be run manually after installing the Copilot CLI.

    Registration mechanism (mirrors install-plugin.mjs):
      1. `copilot plugin marketplace add <InstallDir>` — registers the directory
         that contains .github/plugin/marketplace.json as a local marketplace.
      2. `copilot plugin install typeagent@typeagent-local` — installs the plugin
         from that marketplace into ~/.copilot/installed-plugins/.

    If `copilot` is not on PATH the script exits 0 (non-fatal), so the MSI
    install always succeeds even on machines without the Copilot CLI.

.PARAMETER InstallDir
    Path to the TypeAgent install root (default: the directory this script
    lives in).  Must contain .github\plugin\marketplace.json.

.PARAMETER Uninstall
    When set, unregisters the plugin instead of registering it.
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Uninstall
)

$ErrorActionPreference = "Continue"

function Find-CopilotCli {
    try {
        $cmd = Get-Command copilot -ErrorAction SilentlyContinue
        return $cmd?.Source
    } catch {
        return $null
    }
}

$copilotPath = Find-CopilotCli
if (-not $copilotPath) {
    Write-Host "[TypeAgent] GitHub Copilot CLI not found on PATH — skipping plugin registration."
    Write-Host "[TypeAgent] After installing Copilot CLI, re-run this script to register:"
    Write-Host "[TypeAgent]   powershell -File `"$PSCommandPath`" -InstallDir `"$InstallDir`""
    exit 0
}

Write-Host "[TypeAgent] Found Copilot CLI: $copilotPath"

# ── Uninstall path ─────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host "[TypeAgent] Unregistering TypeAgent Copilot CLI plugin..."
    try {
        & copilot plugin uninstall typeagent 2>&1 | ForEach-Object { Write-Host $_ }
    } catch {
        Write-Host "[TypeAgent] Note: uninstall skipped (plugin may not have been registered). $_"
    }
    try {
        & copilot plugin marketplace remove typeagent-local 2>&1 | ForEach-Object { Write-Host $_ }
    } catch {
        Write-Host "[TypeAgent] Note: marketplace remove skipped. $_"
    }
    Write-Host "[TypeAgent] Done."
    exit 0
}

# ── Install path ───────────────────────────────────────────────────────────────
$marketplaceRoot = $InstallDir.TrimEnd('\').TrimEnd('/')
$marketplaceJson = Join-Path $marketplaceRoot ".github\plugin\marketplace.json"

if (-not (Test-Path $marketplaceJson)) {
    Write-Host "[TypeAgent] marketplace.json not found at: $marketplaceJson"
    Write-Host "[TypeAgent] TypeAgent installation may be incomplete — skipping plugin registration."
    exit 0
}

Write-Host "[TypeAgent] Registering plugin from: $marketplaceRoot"

# 1. Register (or refresh) the local marketplace
$mpList = & copilot plugin marketplace list 2>&1 | Out-String
if ($mpList -match "typeagent-local") {
    Write-Host "[TypeAgent] Marketplace 'typeagent-local' already registered."
    Write-Host "[TypeAgent] Updating plugin..."
    & copilot plugin update typeagent 2>&1 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "[TypeAgent] Adding marketplace..."
    & copilot plugin marketplace add "$marketplaceRoot" 2>&1 | ForEach-Object { Write-Host $_ }

    # 2. Install the plugin from the marketplace
    $pluginList = & copilot plugin list 2>&1 | Out-String
    if ($pluginList -match "typeagent@typeagent-local") {
        Write-Host "[TypeAgent] Plugin already installed, updating..."
        & copilot plugin update typeagent 2>&1 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "[TypeAgent] Installing plugin..."
        & copilot plugin install "typeagent@typeagent-local" 2>&1 | ForEach-Object { Write-Host $_ }
    }
}

Write-Host "[TypeAgent] Plugin registration complete."
exit 0
