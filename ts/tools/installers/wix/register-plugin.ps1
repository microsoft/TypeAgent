# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Registers (or unregisters) the TypeAgent plugin with the GitHub Copilot CLI.

.DESCRIPTION
    Called automatically by the TypeAgent MSI installer as a deferred custom
    action.  Can also be run manually after installing the Copilot CLI.

     Registration mechanism (mirrors install-typeagent.ps1):
        1. Build/update local marketplace payload under
            ~/.copilot/marketplaces/typeagent-local.
        2. Ensure marketplace registration with Copilot CLI.
        3. Install typeagent@typeagent-local.

     On install/upgrade this script is strict: failures return non-zero and
     should block MSI completion.

.PARAMETER InstallDir
    Path to the TypeAgent install root (default: the directory this script
    lives in).  Must contain .github\plugin\marketplace.json.

.PARAMETER Uninstall
    When set, unregisters the plugin instead of registering it.

.PARAMETER LogPath
    Path to log file for registration diagnostics.
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Uninstall,
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\msi-register-plugin.log"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)
    $timestamp = (Get-Date).ToString("s")
    $line = "[$timestamp] $Message"
    Write-Host $line
    Add-Content -Path $LogPath -Value $line
}

function Invoke-Copilot {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args,
        [switch]$AllowFailure
    )

    Write-Log "Running: copilot $($Args -join ' ')"
    $output = & copilot @Args 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in @($output)) {
        Write-Log "copilot> $line"
    }

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Copilot command failed with exit code $exitCode: copilot $($Args -join ' ')"
    }

    return ($output | Out-String)
}

function Ensure-LocalPluginMarketplace {
    param(
        [Parameter(Mandatory = $true)][string]$MarketplaceRoot,
        [Parameter(Mandatory = $true)][string]$PluginName,
        [Parameter(Mandatory = $true)][string]$PluginSourceDir,
        [Parameter(Mandatory = $true)][string]$PluginDescription,
        [Parameter(Mandatory = $true)][string]$PluginVersion
    )

    $manifestDir = Join-Path $MarketplaceRoot ".github\plugin"
    $manifestPath = Join-Path $manifestDir "marketplace.json"
    $pluginsRoot = Join-Path $MarketplaceRoot "plugins"
    $marketplacePluginDir = Join-Path $pluginsRoot $PluginName

    New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
    New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null

    if (Test-Path $marketplacePluginDir) {
        Remove-Item -Recurse -Force $marketplacePluginDir
    }
    Copy-Item -Path $PluginSourceDir -Destination $pluginsRoot -Recurse -Force

    $manifest = $null
    if (Test-Path $manifestPath) {
        try {
            $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Log "Existing marketplace.json is invalid JSON; recreating."
            $manifest = $null
        }
    }

    if ($null -eq $manifest) {
        $manifest = [ordered]@{
            name = "typeagent-local"
            owner = [ordered]@{
                name = "Microsoft"
            }
            metadata = [ordered]@{
                description = "Local TypeAgent plugin marketplace"
                version = "1.0.0"
            }
            plugins = @()
        }
    }

    $existingPlugins = @()
    if ($manifest.plugins) {
        foreach ($entry in @($manifest.plugins)) {
            if ($entry.name -ne $PluginName) {
                $existingPlugins += $entry
            }
        }
    }

    $pluginEntry = [ordered]@{
        name = $PluginName
        description = $PluginDescription
        version = $PluginVersion
        source = "plugins/$PluginName"
    }
    $existingPlugins += $pluginEntry

    $manifest.name = "typeagent-local"
    if (-not $manifest.owner -or -not $manifest.owner.name) {
        $manifest.owner = [ordered]@{ name = "Microsoft" }
    }
    if (-not $manifest.metadata) {
        $manifest.metadata = [ordered]@{}
    }
    if (-not $manifest.metadata.description) {
        $manifest.metadata.description = "Local TypeAgent plugin marketplace"
    }
    if (-not $manifest.metadata.version) {
        $manifest.metadata.version = "1.0.0"
    }
    $manifest.plugins = $existingPlugins

    $manifest | ConvertTo-Json -Depth 20 | Set-Content -Path $manifestPath -Encoding UTF8
    return $manifestPath
}

function Find-CopilotCli {
    try {
        $cmd = Get-Command copilot -ErrorAction SilentlyContinue
        return $cmd?.Source
    } catch {
        return $null
    }
}

$copilotPath = Find-CopilotCli
New-Item -ItemType Directory -Force -Path (Split-Path -Path $LogPath -Parent) | Out-Null
Set-Content -Path $LogPath -Value ""

try {
    Write-Log "TypeAgent register-plugin starting"
    Write-Log "InstallDir: $InstallDir"
    Write-Log "Uninstall: $Uninstall"

    if (-not $copilotPath) {
        throw "GitHub Copilot CLI not found on PATH."
    }

    Write-Log "Found Copilot CLI: $copilotPath"

    if ($Uninstall) {
        Write-Log "Uninstall mode: removing plugin and marketplace"
        Invoke-Copilot -Args @("plugin", "uninstall", "typeagent") -AllowFailure | Out-Null
        Invoke-Copilot -Args @("plugin", "marketplace", "remove", "typeagent-local") -AllowFailure | Out-Null
        Write-Log "Uninstall mode completed"
        exit 0
    }

    $pluginSourceDir = Join-Path $InstallDir "copilot-plugin"
    if (-not (Test-Path $pluginSourceDir)) {
        throw "Plugin source directory not found: $pluginSourceDir"
    }

    $pluginJsonPath = Join-Path $pluginSourceDir "plugin.json"
    $pluginVersion = "0.0.1"
    if (Test-Path $pluginJsonPath) {
        $pluginJson = Get-Content -Raw -Path $pluginJsonPath | ConvertFrom-Json
        if ($pluginJson.version) {
            $pluginVersion = [string]$pluginJson.version
        }
    }

    $marketplaceRoot = Join-Path $env:USERPROFILE ".copilot\marketplaces\typeagent-local"
    Write-Log "Updating local marketplace at: $marketplaceRoot"
    $manifestPath = Ensure-LocalPluginMarketplace \
        -MarketplaceRoot $marketplaceRoot \
        -PluginName "typeagent" \
        -PluginSourceDir $pluginSourceDir \
        -PluginDescription "TypeAgent integration for Copilot CLI" \
        -PluginVersion $pluginVersion
    Write-Log "Marketplace manifest updated: $manifestPath"

    $mpList = Invoke-Copilot -Args @("plugin", "marketplace", "list")
    if ($mpList -notmatch "typeagent-local") {
        Write-Log "Adding marketplace typeagent-local"
        Invoke-Copilot -Args @("plugin", "marketplace", "add", $marketplaceRoot) | Out-Null
    }

    Write-Log "Refreshing marketplace index"
    Invoke-Copilot -Args @("plugin", "marketplace", "update", "typeagent-local") | Out-Null

    $pluginList = Invoke-Copilot -Args @("plugin", "list")
    if ($pluginList -match "typeagent@typeagent-local") {
        Write-Log "Plugin already installed; reinstalling to refresh content"
        Invoke-Copilot -Args @("plugin", "uninstall", "typeagent") -AllowFailure | Out-Null
    }

    Write-Log "Installing typeagent@typeagent-local"
    Invoke-Copilot -Args @("plugin", "install", "typeagent@typeagent-local") | Out-Null

    $verifyList = Invoke-Copilot -Args @("plugin", "list")
    if ($verifyList -notmatch "typeagent@typeagent-local") {
        throw "Plugin verification failed: typeagent@typeagent-local missing from 'copilot plugin list'"
    }

    Write-Log "Plugin registration complete"
    exit 0
}
catch {
    $message = $_.Exception.Message
    if (-not [string]::IsNullOrWhiteSpace($message)) {
        Write-Log "ERROR: $message"
    }
    else {
        Write-Log "ERROR: Unknown registration failure"
    }
    Write-Host "[TypeAgent] Registration failed. See log: $LogPath"
    exit 1
}
