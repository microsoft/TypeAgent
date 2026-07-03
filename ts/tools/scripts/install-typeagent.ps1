# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Install the TypeAgent agent-server (and prerequisites) on a bare machine
  WITHOUT the TypeAgent repo — the standalone installer.

.DESCRIPTION
  Complements typeagent-serve.mjs (which assumes the artifact is already present
  and prerequisites exist). This script provisions what a bare machine lacks:

    1. Verifies Node >= 22.
    2. For the 'external' artifact variant, provisions the Claude Code + GitHub
       Copilot CLIs on PATH (the external-cli agent-server resolves them at
       runtime; see @typeagent/agent-sdk/node claudeExecutableOption). The 'full'
       variant bundles those runtimes, so this step is skipped.
    3. Downloads the agent-server Universal package for this RID from the feed.
    4. Installs and registers the Copilot CLI plugin (from feed by default, or -PluginSource).
    5. Runs config provisioning and starts the daemon via the artifact's
       typeagent-serve.mjs. Config provisioning depends on -Provider:
         aisystems (default) - getKeys + browser login (AI Systems Key Vault).
         ollama / copilot     - synthesize config.local.yaml locally (no Key Vault).
    6. (Optional, -DevTunnel) sets up a Microsoft Dev Tunnel and hosts it so a
       client on another device can reach the service.

  Azure CLI (with az login) is used to download from the feed. This is the
  install-time exception; runtime config provisioning uses getKeys' browser
  credential (aisystems) or a locally generated config (ollama/copilot).

.EXAMPLE
  pwsh ./install-typeagent.ps1
  pwsh ./install-typeagent.ps1 -Variant full -Version 0.0.1-12345
  pwsh ./install-typeagent.ps1 -Provider ollama    # local chat, no Key Vault
  pwsh ./install-typeagent.ps1 -Provider copilot   # Copilot SDK chat, no Key Vault
  pwsh ./install-typeagent.ps1 -DevTunnel   # also expose the service via a Dev Tunnel
  pwsh ./install-typeagent.ps1 -BootstrapPrereqs
  pwsh ./install-typeagent.ps1 -Upgrade     # force fresh download, replacing existing assets
    pwsh ./install-typeagent.ps1 -PluginSource C:\temp\typeagent-plugin   # install plugin from local folder
#>

[CmdletBinding()]
param(
    [ValidateSet("external", "full")]
    [string]$Variant = "external",
    [string]$Version = "latest",
    [string]$InstallDir = "$env:LOCALAPPDATA\TypeAgent\agent-server",
    [string]$Org = "https://dev.azure.com/msctoproj",
    [string]$Project = "AI_Systems",
    [string]$Feed = "typeagent",
    [string]$PluginSource = "",
    [string]$PluginVersion = "latest",
    [string]$PluginPackageName = "typeagent-copilot-plugin",
    # Local source cache for the plugin payload before registering it with the
    # Copilot CLI. Keep this separate from Copilot's managed installed-plugins
    # directory so the CLI owns the final installed layout.
    [string]$PluginInstallDir = "$env:USERPROFILE\.copilot\available-plugins\typeagent",
    [string]$PluginMarketplaceName = "typeagent-local",
    [string]$PluginMarketplaceDir = "$env:USERPROFILE\.copilot\marketplaces\typeagent-local",
    [switch]$NoStart,
    # Opt-in: run setup-typeagent-prereqs.ps1 first to install missing base
    # prerequisites (Node/Azure CLI and optional extras for selected switches).
    [switch]$BootstrapPrereqs,
    # Opt-in: force a fresh download of agent-server, replacing existing assets at
    # -InstallDir. By default, reuses existing downloaded assets if present.
    [switch]$Upgrade,
    # Opt-in: set up a Microsoft Dev Tunnel so another device (e.g. a phone) can
    # reach this agent-server, and start the tunnel host alongside the daemon.
    [switch]$DevTunnel,
    # With -DevTunnel: allow anonymous client access (WARNING: removes the only
    # access control on the otherwise-unauthenticated service). Default private.
    [switch]$DevTunnelAnonymous,
    # Endpoint provider for LLM calls:
    #   aisystems - download config from the AI Systems Key Vault (default, needs az login access).
    #   ollama    - local OpenAI-compatible chat via 'ollama serve' (no Key Vault).
    #   copilot   - GitHub Copilot SDK chat via an authenticated 'copilot' CLI (no Key Vault).
    [ValidateSet("aisystems", "ollama", "copilot")]
    [string]$Provider = "aisystems",
    # Embedding source for ollama/copilot providers (independent of chat):
    #   local (default, bundled CPU-only), ollama, openai, or none.
    [ValidateSet("local", "ollama", "openai", "none")]
    [string]$Embedding = "local",
    [string]$OllamaHost = "http://localhost:11434",
    [string]$ChatModel = "",
    [string]$CopilotModel = "",
    [string]$EmbeddingEndpoint = "",
    [string]$EmbeddingModel = "",
    [string]$OpenAIKey = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Error $msg; exit 1 }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-AzureDevOpsAuthError {
    param(
        [Parameter(Mandatory = $true)][string]$Text
    )

    return (
        $Text -match "Before you can run Azure DevOps commands, you need to run the login command" -or
        $Text -match "az devops login" -or
        $Text -match "azure-devops-cli-auth" -or
        $Text -match "TF401444" -or
        $Text -match "401" -or
        $Text -match "403"
    )
}

function Invoke-AzLoginForAccess {
    param(
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Write-Host ""
    Write-Host $Reason -ForegroundColor Yellow
    Write-Host "Launching 'az login' so you can select an identity with access..." -ForegroundColor Yellow
    & az login --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "Azure login did not complete successfully."
    }
}

function Invoke-AzureDevOpsCommandWithRetry {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [Parameter(Mandatory = $true)][string]$LoginReason
    )

    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $output = & $Command 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            return $output
        }

        $outputText = ($output | Out-String)
        if ($attempt -eq 1 -and (Test-AzureDevOpsAuthError -Text $outputText)) {
            Invoke-AzLoginForAccess -Reason $LoginReason
            continue
        }

        if ($outputText) {
            Write-Host $outputText
        }
        Fail $FailureMessage
    }
}

function Test-CopilotPluginRegistered {
    param(
        [Parameter(Mandatory = $true)][string]$PluginName
    )

    $copilotConfigPath = Join-Path $env:USERPROFILE ".copilot\config.json"
    if (-not (Test-Path $copilotConfigPath)) {
        return $false
    }

    try {
        $config = Get-Content -Raw -Path $copilotConfigPath | ConvertFrom-Json
    } catch {
        return $false
    }

    $installedPlugins = @($config.installedPlugins)
    foreach ($installedPlugin in $installedPlugins) {
        if ($installedPlugin -is [string] -and $installedPlugin -eq $PluginName) {
            return $true
        }
        if ($installedPlugin -and $installedPlugin.name -eq $PluginName) {
            return $true
        }
    }

    return $false
}

function Ensure-LocalPluginMarketplace {
    param(
        [Parameter(Mandatory = $true)][string]$MarketplaceRoot,
        [Parameter(Mandatory = $true)][string]$MarketplaceName,
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
        } catch {
            Write-Host "  Existing marketplace.json is invalid JSON; recreating it"
            $manifest = $null
        }
    }

    if ($null -eq $manifest) {
        $manifest = [ordered]@{
            name = $MarketplaceName
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

    $manifest.name = $MarketplaceName
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

function Resolve-LatestUniversalPackageVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Organization,
        [Parameter(Mandatory = $true)][string]$ProjectName,
        [Parameter(Mandatory = $true)][string]$FeedName,
        [Parameter(Mandatory = $true)][string]$PackageName
    )

    $json = Invoke-AzureDevOpsCommandWithRetry `
        -Command {
            & az devops invoke `
                --organization $Organization `
                --area packaging --resource packages `
                --route-parameters project=$ProjectName feedId=$FeedName `
                --query-parameters protocolType=upack packageNameQuery=$PackageName includeAllVersions=true `
                --api-version 7.1 --output json --only-show-errors
        } `
        -FailureMessage "Failed to query package versions for '$PackageName' from feed '$FeedName'." `
        -LoginReason "Azure DevOps feed access failed while listing versions for '$PackageName'."
    if (-not $json) {
        Fail "Failed to query package versions for '$PackageName' from feed '$FeedName'."
    }

    $response = $json | ConvertFrom-Json
    if ($null -eq $response -or $null -eq $response.value) {
        Fail "Unexpected response while listing versions for '$PackageName'."
    }

    $pkg = @($response.value | Where-Object { $_.name -eq $PackageName -and $_.protocolType -eq "upack" } | Select-Object -First 1)
    if ($pkg.Count -eq 0) {
        Fail "Package '$PackageName' was not found in feed '$FeedName'."
    }

    $versions = @($pkg[0].versions | Where-Object { -not $_.isDeleted })
    if ($versions.Count -eq 0) {
        Fail "Package '$PackageName' has no available versions in feed '$FeedName'."
    }

    # Prefer service-computed latest; fallback to most recent publish date.
    $latest = @($versions | Where-Object { $_.isLatest } | Select-Object -First 1)
    if ($latest.Count -eq 0) {
        $latest = @($versions | Sort-Object -Property publishDate -Descending | Select-Object -First 1)
    }

    $latestVersion = [string]$latest[0].version
    if (-not $latestVersion) {
        Fail "Unable to resolve latest version for '$PackageName'."
    }

    return $latestVersion
}

function Invoke-PrereqBootstrap {
    $scriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $PSScriptRoot }
    if (-not $scriptDir) {
        Fail "Unable to resolve script directory for prerequisite bootstrap."
    }

    $bootstrapScript = Join-Path $scriptDir "setup-typeagent-prereqs.ps1"
    if (-not (Test-Path $bootstrapScript)) {
        Fail "-BootstrapPrereqs was requested but setup-typeagent-prereqs.ps1 was not found next to this script."
    }

    Write-Step "Bootstrapping prerequisites via setup-typeagent-prereqs.ps1"
    $bootstrapArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $bootstrapScript,
        "-Variant", $Variant,
        "-Org", $Org,
        "-Project", $Project
    )
    if ($DevTunnel) { $bootstrapArgs += "-DevTunnel" }
    & pwsh @bootstrapArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "Prerequisite bootstrap failed."
    }
}

function Test-AzureDevOpsProjectAccess {
    param(
        [Parameter(Mandatory = $true)][string]$Organization,
        [Parameter(Mandatory = $true)][string]$ProjectName
    )

    Invoke-AzureDevOpsCommandWithRetry `
        -Command {
            & az devops project show --organization $Organization --project $ProjectName --only-show-errors
        } `
        -FailureMessage (@(
            "Azure DevOps authentication failed for organization '$Organization' and project '$ProjectName'.",
            "Run one of the following and re-run this script:",
            "  1) az login                           (AAD/MSA identity with org access)",
            "  2) az devops login --organization $Organization   (PAT auth)",
            "See: https://aka.ms/azure-devops-cli-auth"
        ) -join [Environment]::NewLine) `
        -LoginReason "Azure DevOps project access failed for '$ProjectName'."
    return $true
}

function Invoke-UniversalPackageDownload {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$PackageName
    )

    Invoke-AzureDevOpsCommandWithRetry `
        -Command { & az @Arguments } `
        -FailureMessage "Artifact download failed for $PackageName." `
        -LoginReason "Azure DevOps feed access failed while downloading '$PackageName'."
    return $true
}

if ($BootstrapPrereqs) {
    Invoke-PrereqBootstrap
}

# --- 1. Node >= 22 -----------------------------------------------------------
Write-Step "Checking Node.js"
if (-not (Test-Command node)) {
    Fail "Node.js >= 22 is required and was not found on PATH. Install it (e.g. 'winget install OpenJS.NodeJS.LTS') and re-run."
}
$nodeMajor = (& node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if ([int]$nodeMajor -lt 22) {
    Fail "Node.js >= 22 required; found v$(& node --version). Upgrade and re-run."
}
Write-Host "  Node $(& node --version)"

# --- 2. External-CLI prerequisites (Claude Code + Copilot CLI) ---------------
if ($Variant -eq "external") {
    Write-Step "Provisioning external CLIs (claude, copilot)"
    if (-not (Test-Command npm)) {
        Fail "npm is required to install the CLIs (ships with Node)."
    }
    if (-not (Test-Command claude)) {
        Write-Host "  Installing Claude Code CLI (npm i -g @anthropic-ai/claude-code)"
        & npm install -g "@anthropic-ai/claude-code"
    } else {
        Write-Host "  claude already on PATH: $((Get-Command claude).Source)"
    }
    if (-not (Test-Command copilot)) {
        Write-Host "  Installing GitHub Copilot CLI (npm i -g @github/copilot)"
        & npm install -g "@github/copilot"
    } else {
        Write-Host "  copilot already on PATH: $((Get-Command copilot).Source)"
    }
    Write-Host "  NOTE: both CLIs require a one-time auth (e.g. 'claude' / 'copilot' login) before agent actions work."
}

# --- 3. Download the agent-server artifact from the feed ---------------------
Write-Step "Downloading agent-server artifact from feed '$Feed'"
if (-not (Test-Command az)) {
    Fail "Azure CLI ('az') is required to download from the feed. Install it and run 'az login'."
}
& az extension add --name azure-devops --only-show-errors 2>$null
try { & az account show --only-show-errors *> $null } catch {
    Write-Host "  Not logged in — launching 'az login'..."
    & az login --only-show-errors | Out-Null
}

# Set defaults and verify DevOps auth up front so package download errors are actionable.
& az devops configure --defaults organization=$Org project=$Project --only-show-errors 2>$null
[void](Test-AzureDevOpsProjectAccess -Organization $Org -ProjectName $Project)

$arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
$rid = "win32-$arch"
$pkgName = "agent-server.$rid"

$serve = Join-Path $InstallDir "typeagent-serve.mjs"
$assetExists = Test-Path $serve

if ($Upgrade -and $assetExists) {
    Write-Host "  -Upgrade specified: removing existing assets for fresh download"
    Remove-Item -Recurse -Force $InstallDir
    $assetExists = $false
}

if ($assetExists) {
    Write-Host "  Using existing agent-server assets at $InstallDir"
} else {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Write-Host "  Downloading $pkgName ($Version) -> $InstallDir"
    $resolvedVersion = $Version
    if ($Version -eq "latest") {
        Write-Host "  Resolving latest concrete package version (including prerelease versions)..."
        $resolvedVersion = Resolve-LatestUniversalPackageVersion -Organization $Org -ProjectName $Project -FeedName $Feed -PackageName $pkgName
        Write-Host "  Resolved latest version: $resolvedVersion"
    }
    $verArgs = @("--version", $resolvedVersion)
    $dlArgs = @("artifacts", "universal", "download", "--organization", $Org, "--project", $Project, "--scope", "project", "--feed", $Feed, "--name", $pkgName) + @($verArgs) + @("--path", $InstallDir, "--only-show-errors")
    [void](Invoke-UniversalPackageDownload -Arguments $dlArgs -PackageName $pkgName)
}

if (-not (Test-Path $serve)) { Fail "Agent-server assets missing typeagent-serve.mjs (unexpected layout)." }

# --- 4. Install and register the Copilot CLI plugin ---------------------------
Write-Step "Installing Copilot CLI plugin"
$pluginSourceDir = $PluginInstallDir
$pluginConfig = Join-Path $pluginSourceDir "plugin.json"
$pluginMcpServer = Join-Path $pluginSourceDir "dist\mcp\server.js"
$pluginName = "typeagent"
$pluginDescription = "TypeAgent Copilot CLI plugin"
$pluginResolvedVersion = $PluginVersion

if (-not (Test-Command copilot)) {
    if (-not (Test-Command npm)) {
        Fail "GitHub Copilot CLI is required to register the plugin, and npm is not available to install it."
    }

    Write-Host "  Installing GitHub Copilot CLI (npm i -g @github/copilot)"
    & npm install -g "@github/copilot"
    if (-not (Test-Command copilot)) {
        Fail "GitHub Copilot CLI was not found after installation."
    }
}

if ($Upgrade -and (Test-Path $pluginSourceDir)) {
    Write-Host "  -Upgrade specified: removing existing plugin assets for fresh download"
    Remove-Item -Recurse -Force $pluginSourceDir
}

if ($PluginSource -ne "") {
    Write-Host "  Using local plugin source: $PluginSource"
    $pluginSourceDir = $PluginSource
    $pluginConfig = Join-Path $pluginSourceDir "plugin.json"
    $pluginMcpServer = Join-Path $pluginSourceDir "dist\mcp\server.js"
} elseif (Test-Path $pluginConfig) {
    Write-Host "  Using existing downloaded plugin source at $pluginSourceDir"
} else {
    New-Item -ItemType Directory -Force -Path $pluginSourceDir | Out-Null
    $resolvedPluginVersion = $PluginVersion
    if ($PluginVersion -eq "latest") {
        Write-Host "  Resolving latest plugin version for $PluginPackageName..."
        $resolvedPluginVersion = Resolve-LatestUniversalPackageVersion -Organization $Org -ProjectName $Project -FeedName $Feed -PackageName $PluginPackageName
        Write-Host "  Resolved plugin version: $resolvedPluginVersion"
    }
    $pluginResolvedVersion = $resolvedPluginVersion

    Write-Host "  Downloading plugin $PluginPackageName ($resolvedPluginVersion) -> $pluginSourceDir"
    $pluginDlArgs = @(
        "artifacts", "universal", "download",
        "--organization", $Org,
        "--project", $Project,
        "--scope", "project",
        "--feed", $Feed,
        "--name", $PluginPackageName,
        "--version", $resolvedPluginVersion,
        "--path", $pluginSourceDir,
        "--only-show-errors"
    )
    [void](Invoke-UniversalPackageDownload -Arguments $pluginDlArgs -PackageName $PluginPackageName)
}

try {
    $pluginManifest = Get-Content -Raw -Path $pluginConfig | ConvertFrom-Json -Depth 20
    if ($pluginManifest.version) {
        $pluginResolvedVersion = [string]$pluginManifest.version
    }
    if ($pluginManifest.description) {
        $pluginDescription = [string]$pluginManifest.description
    }
} catch {
    Write-Host "  Warning: unable to parse plugin.json for metadata; using defaults"
}

if (-not (Test-Path $pluginConfig)) {
    Fail "Plugin install failed: missing plugin.json at $pluginSourceDir."
}
if (-not (Test-Path $pluginMcpServer)) {
    Fail "Plugin install failed: missing MCP server entrypoint at $pluginMcpServer."
}
Write-Host "  Plugin source ready at $pluginSourceDir"
Write-Host "  MCP server entrypoint found: $pluginMcpServer"

$registerPluginScript = Join-Path (Split-Path -Parent $PSScriptRoot) "installers\common\register-plugin.mjs"
if (-not (Test-Path $registerPluginScript)) {
    Fail "Shared plugin registration script not found: $registerPluginScript"
}

$pluginRegisterLogPath = Join-Path (Join-Path $env:USERPROFILE ".typeagent") "logs\register-plugin.log"
Write-Host "  Registering plugin with shared script"
$registerArgs = @(
    $registerPluginScript,
    "--install-dir", $InstallDir,
    "--plugin-source-dir", $pluginSourceDir,
    "--marketplace-name", $PluginMarketplaceName,
    "--marketplace-root", $PluginMarketplaceDir,
    "--plugin-name", $pluginName,
    "--plugin-description", $pluginDescription,
    "--plugin-version", $pluginResolvedVersion,
    "--log-path", $pluginRegisterLogPath
)
& node @registerArgs
if ($LASTEXITCODE -ne 0) {
    Fail "Copilot plugin registration failed. See log: $pluginRegisterLogPath"
}
Write-Host "  Copilot plugin '$pluginName' registered successfully"

# --- 5. Provision config + start the daemon ----------------------------------
if ($Provider -eq "aisystems") {
    Write-Step "Provisioning config (getKeys, browser login)"
    $provisionOutput = & node $serve provision 2>&1
    $provisionExitCode = $LASTEXITCODE
    if ($provisionOutput) { $provisionOutput | ForEach-Object { Write-Host $_ } }

    if ($provisionExitCode -ne 0) {
        $provisionText = ($provisionOutput | Out-String)
        $isKeyVaultAuthError = (
            $provisionText -match "Caller is not authorized" -or
            $provisionText -match "Microsoft\.KeyVault/vaults/secrets/getSecret/action" -or
            $provisionText -match "Failed to read 'typeagent-config' from vault"
        )

        if ($isKeyVaultAuthError) {
            Write-Host "" 
            Write-Host "Key Vault access failed for the current Azure identity." -ForegroundColor Yellow
            Write-Host "Launching 'az login' so you can select an identity with access..." -ForegroundColor Yellow
            & az login --only-show-errors | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Fail "Config provisioning failed and az login did not complete successfully."
            }

            Write-Step "Retrying config provisioning after az login"
            $retryOutput = & node $serve provision 2>&1
            $retryExitCode = $LASTEXITCODE
            if ($retryOutput) { $retryOutput | ForEach-Object { Write-Host $_ } }
            if ($retryExitCode -ne 0) {
                Fail "Config provisioning failed after re-authentication. Confirm the selected identity has Key Vault access."
            }
        } else {
            Fail "Config provisioning failed."
        }
    }
} else {
    # Self-host provider: synthesize config.local.yaml locally (no Key Vault / az login).
    Write-Step "Provisioning config for '$Provider' provider (self-host, no Key Vault)"
    $provisionArgs = @($serve, "provision", "--provider", $Provider, "--force", "--embedding", $Embedding)
    if ($Provider -eq "ollama") {
        $provisionArgs += @("--ollama-host", $OllamaHost)
        if ($ChatModel) { $provisionArgs += @("--chat-model", $ChatModel) }
    }
    if ($Provider -eq "copilot" -and $CopilotModel) {
        $provisionArgs += @("--copilot-model", $CopilotModel)
    }
    if ($Embedding -eq "ollama") {
        $provisionArgs += @("--ollama-host", $OllamaHost)
    }
    if ($EmbeddingEndpoint) { $provisionArgs += @("--embedding-endpoint", $EmbeddingEndpoint) }
    if ($EmbeddingModel) { $provisionArgs += @("--embedding-model", $EmbeddingModel) }
    if ($OpenAIKey) { $provisionArgs += @("--openai-key", $OpenAIKey) }

    & node @provisionArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "Self-host config generation failed for provider '$Provider'."
    }

    if ($Provider -eq "ollama") {
        Write-Host "  Reminder: ensure 'ollama serve' is running and the '$(if ($ChatModel) { $ChatModel } else { 'llama3.2' })' model is pulled." -ForegroundColor Yellow
        # Best-effort reachability probe (non-fatal).
        try {
            $probe = [System.Net.HttpWebRequest]::Create("$OllamaHost/api/tags")
            $probe.Timeout = 2000
            $probe.Method = "GET"
            $probe.GetResponse().Close()
            Write-Host "  Ollama reachable at $OllamaHost." -ForegroundColor Green
        } catch {
            Write-Host "  WARNING: could not reach Ollama at $OllamaHost. Start it before using the agent." -ForegroundColor Yellow
        }
    }
    if ($Provider -eq "copilot") {
        Write-Host "  Reminder: the 'copilot' CLI must be installed and authenticated (github login)." -ForegroundColor Yellow
    }
}

# Validate that provisioning produced embedding config required at startup.
$typeAgentConfigDir = if ($env:TYPEAGENT_CONFIG_DIR) {
    $env:TYPEAGENT_CONFIG_DIR
} elseif ($env:TYPEAGENT_USER_DATA_DIR) {
    $env:TYPEAGENT_USER_DATA_DIR
} else {
    Join-Path $env:USERPROFILE ".typeagent"
}
$configLocalPath = Join-Path $typeAgentConfigDir "config.local.yaml"
# Embeddings may come from an Azure/OpenAI endpoint OR the bundled local model
# (embedding.provider: local). "none" intentionally disables embeddings and the
# dependent features degrade gracefully, so no endpoint is required.
$hasEmbeddingEnv = (-not [string]::IsNullOrWhiteSpace($env:AZURE_OPENAI_ENDPOINT_EMBEDDING)) -or
    (-not [string]::IsNullOrWhiteSpace($env:OPENAI_ENDPOINT_EMBEDDING)) -or
    (-not [string]::IsNullOrWhiteSpace($env:TYPEAGENT_EMBEDDING_PROVIDER))
$hasEmbeddingInFile = $false
if (Test-Path $configLocalPath) {
    $hasEmbeddingInFile = [bool](Select-String -Path $configLocalPath -Pattern "AZURE_OPENAI_ENDPOINT_EMBEDDING|OPENAI_ENDPOINT_EMBEDDING|azureOpenAiEndpointEmbedding|endpointEmbedding|endpoint_embedding|^embedding:|provider:\s*(local|openai|azure|none)" -Quiet)
}

if (-not $hasEmbeddingEnv -and -not $hasEmbeddingInFile) {
    $msg = @(
        "Provisioning completed, but no embedding configuration was found.",
        "Expected one of: an embedding endpoint (AZURE_OPENAI_ENDPOINT_EMBEDDING / OPENAI_ENDPOINT_EMBEDDING / endpointEmbedding),",
        "or an 'embedding:' section (provider: local | openai | azure | none) in the config.",
        "Checked: env vars and '$configLocalPath'",
        "Without embeddings, semantic search and related features are disabled (the server still starts).",
        "For detailed startup diagnostics: set TYPEAGENT_DEBUG=1 and run 'node typeagent-serve.mjs start --debug', then 'node typeagent-serve.mjs logs'."
    ) -join [Environment]::NewLine
    Write-Warning $msg
}

# --- 6. Optional: set up + host a Dev Tunnel for cross-device access ----------
if ($DevTunnel) {
    Write-Step "Setting up Dev Tunnel (cross-device access)"
    if (-not (Test-Command devtunnel)) {
        Write-Host "  Installing devtunnel CLI (winget install Microsoft.devtunnel)"
        & winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements 2>$null
        if (-not (Test-Command devtunnel)) {
            Fail "devtunnel CLI not found after install. Install it manually and re-run with -DevTunnel."
        }
    }
    $setup = Join-Path $InstallDir "setup-devtunnel.mjs"
    $setupArgs = @($setup)
    if ($DevTunnelAnonymous) { $setupArgs += "--anonymous" }
    & node @setupArgs
    if ($LASTEXITCODE -ne 0) { Fail "Dev Tunnel setup failed." }
    # Bring the tunnel host up with the daemon (start below honors --tunnel).
    $env:TYPEAGENT_TUNNEL = "1"
}

if (-not $NoStart) {
    Write-Step "Starting agent-server"
    $startArgs = @($serve, "start")
    if ($DevTunnel) { $startArgs += "--tunnel" }
    & node @startArgs
    $startExitCode = $LASTEXITCODE
    if ($startExitCode -ne 0) {
        $daemonLogPath = Join-Path $typeAgentConfigDir "agent-server.log"
        $logText = ""
        if (Test-Path $daemonLogPath) {
            try {
                $logText = Get-Content -Raw -Path $daemonLogPath
            } catch {
                $logText = ""
            }
        }

        $isOpenAiPermissionError = (
            $logText -match "PermissionDenied" -and
            $logText -match "openai\.azure\.com" -and
            $logText -match "embeddings"
        )

        if ($isOpenAiPermissionError) {
            $msg = @(
                "Agent server failed to start due to Azure OpenAI authorization failure.",
                "Detected in daemon log: '$daemonLogPath'",
                "The configured identity does not have permission to call the embeddings deployment.",
                "Remediation:",
                "  1) az login   (choose an account with access to the OpenAI resource/deployment)",
                "  2) Verify config.local.yaml points to a deployment your selected principal can use",
                "  3) Re-run: node `"$serve`" start --debug",
                "  4) Check logs: node `"$serve`" logs"
            ) -join [Environment]::NewLine
            Fail $msg
        }

        if (Test-Path $daemonLogPath) {
            Write-Host "  Agent-server daemon log: $daemonLogPath" -ForegroundColor Yellow
        }
        Fail "Agent server failed to start. Re-run with TYPEAGENT_DEBUG=1 and inspect 'node `"$serve`" logs'."
    }
}

Write-Host ""
Write-Host "TypeAgent agent-server installed at $InstallDir" -ForegroundColor Green
Write-Host "  Start:    node `"$serve`" start"
Write-Host "  Status:   node `"$serve`" status"
Write-Host "  Logs:     node `"$serve`" logs"
Write-Host "  Stop:     node `"$serve`" stop"
if ($DevTunnel) {
    Write-Host "  Tunnel:   node `"$serve`" tunnel status   (list-tunnels.mjs shows the client URL + token)"
}
