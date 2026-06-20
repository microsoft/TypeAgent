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
    4. (Optional) installs the Copilot CLI plugin from -PluginSource.
    5. Runs config provisioning (getKeys, browser login) and starts the daemon
       via the artifact's typeagent-serve.mjs.
    6. (Optional, -DevTunnel) sets up a Microsoft Dev Tunnel and hosts it so a
       client on another device can reach the service.

  Azure CLI (with az login) is used to download from the feed. This is the
  install-time exception; runtime config provisioning still uses getKeys'
  browser credential (no az login needed for that).

.EXAMPLE
  pwsh ./install-typeagent.ps1
  pwsh ./install-typeagent.ps1 -Variant full -Version 0.0.1-12345
  pwsh ./install-typeagent.ps1 -DevTunnel   # also expose the service via a Dev Tunnel
    pwsh ./install-typeagent.ps1 -BootstrapPrereqs
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
    [switch]$NoStart,
    # Opt-in: run setup-typeagent-prereqs.ps1 first to install missing base
    # prerequisites (Node/Azure CLI and optional extras for selected switches).
    [switch]$BootstrapPrereqs,
    # Opt-in: set up a Microsoft Dev Tunnel so another device (e.g. a phone) can
    # reach this agent-server, and start the tunnel host alongside the daemon.
    [switch]$DevTunnel,
    # With -DevTunnel: allow anonymous client access (WARNING: removes the only
    # access control on the otherwise-unauthenticated service). Default private.
    [switch]$DevTunnelAnonymous
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Error $msg; exit 1 }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
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
    $bootstrapArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $bootstrapScript, "-Variant", $Variant)
    if ($DevTunnel) { $bootstrapArgs += "-DevTunnel" }
    & pwsh @bootstrapArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "Prerequisite bootstrap failed."
    }
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

$arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
$rid = "win32-$arch"
$pkgName = "agent-server.$rid"

if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "  $pkgName ($Version) -> $InstallDir"
$verArgs = if ($Version -eq "latest") { @("--version", "*") } else { @("--version", $Version) }
& az artifacts universal download `
    --organization $Org --project $Project --scope project `
    --feed $Feed --name $pkgName @verArgs --path $InstallDir --only-show-errors
if ($LASTEXITCODE -ne 0) { Fail "Artifact download failed for $pkgName." }

$serve = Join-Path $InstallDir "typeagent-serve.mjs"
if (-not (Test-Path $serve)) { Fail "Downloaded artifact missing typeagent-serve.mjs (unexpected layout)." }

# --- 4. Optional: install the Copilot CLI plugin -----------------------------
if ($PluginSource -ne "") {
    Write-Step "Installing Copilot CLI plugin from $PluginSource"
    $pluginDest = Join-Path $env:USERPROFILE ".copilot\installed-plugins\typeagent"
    New-Item -ItemType Directory -Force -Path (Split-Path $pluginDest) | Out-Null
    if (Test-Path $pluginDest) { Remove-Item -Recurse -Force $pluginDest }
    Copy-Item -Recurse -Force $PluginSource $pluginDest
    Write-Host "  Plugin copied to $pluginDest"
}

# --- 5. Provision config + start the daemon ----------------------------------
Write-Step "Provisioning config (getKeys, browser login)"
& node $serve provision
if ($LASTEXITCODE -ne 0) { Fail "Config provisioning failed." }

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
}

Write-Host ""
Write-Host "TypeAgent agent-server installed at $InstallDir" -ForegroundColor Green
Write-Host "  Start:    node `"$serve`" start"
Write-Host "  Status:   node `"$serve`" status"
Write-Host "  Stop:     node `"$serve`" stop"
if ($DevTunnel) {
    Write-Host "  Tunnel:   node `"$serve`" tunnel status   (list-tunnels.mjs shows the client URL + token)"
}
