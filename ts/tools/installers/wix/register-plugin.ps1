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

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

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

    if (-not $script:CopilotCommand) {
        throw "Copilot CLI command path is not initialized."
    }

    $copilotCmdText = "$script:CopilotCommand $($Args -join ' ')"
    Write-Log "Running: $copilotCmdText"

    if ($script:CopilotCommand -like "*.ps1") {
        $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:CopilotCommand @Args 2>&1
    }
    else {
        $output = & $script:CopilotCommand @Args 2>&1
    }
    $exitCode = $LASTEXITCODE
    foreach ($line in @($output)) {
        Write-Log "copilot> $line"
    }

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Copilot command failed with exit code ${exitCode}: $script:CopilotCommand $($Args -join ' ')"
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
    # Copy the source directory to the plugins directory, then rename to plugin name
    $tempCopyPath = Join-Path $pluginsRoot (Split-Path -Leaf $PluginSourceDir)
    Copy-Item -Path $PluginSourceDir -Destination $pluginsRoot -Recurse -Force
    if ($tempCopyPath -ne $marketplacePluginDir -and (Test-Path $tempCopyPath)) {
        Rename-Item -Path $tempCopyPath -NewName (Split-Path -Leaf $marketplacePluginDir) -Force
    }

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

    $manifestJson = $manifest | ConvertTo-Json -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
    return $manifestPath
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
        Write-Log "Rejected VS Code wrapper path(s) for MSI context: $($rejectedShimPaths -join '; ')"
    }

    return $null
}

$copilotPath = Find-CopilotCli
$script:CopilotCommand = $copilotPath
New-Item -ItemType Directory -Force -Path (Split-Path -Path $LogPath -Parent) | Out-Null
Set-Content -Path $LogPath -Value ""

try {
    Write-Log "TypeAgent register-plugin starting"
    Write-Log "InstallDir: $InstallDir"
    Write-Log "Uninstall: $Uninstall"

    if (-not $copilotPath) {
        throw "GitHub Copilot CLI not found in MSI-safe locations. Install @github/copilot globally (for example at %APPDATA%\\npm\\copilot.cmd) or set COPILOT_CLI_PATH."
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
    $manifestPath = Ensure-LocalPluginMarketplace `
        -MarketplaceRoot $marketplaceRoot `
        -PluginName "typeagent" `
        -PluginSourceDir $pluginSourceDir `
        -PluginDescription "TypeAgent integration for Copilot CLI" `
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
