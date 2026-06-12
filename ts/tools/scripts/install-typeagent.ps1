# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Install the TypeAgent agent-server (and prerequisites) on a machine WITHOUT
  the TypeAgent repo or Agency — the non-agency standalone installer.

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

  Azure CLI (with az login) is used to download from the feed. This is the
  install-time exception; runtime config provisioning still uses getKeys'
  browser credential (no az login needed for that).

.EXAMPLE
  pwsh ./install-typeagent.ps1
  pwsh ./install-typeagent.ps1 -Variant full -Version 0.0.1-12345
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
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Error $msg; exit 1 }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
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

if (-not $NoStart) {
    Write-Step "Starting agent-server"
    & node $serve start
}

Write-Host ""
Write-Host "TypeAgent agent-server installed at $InstallDir" -ForegroundColor Green
Write-Host "  Start:    node `"$serve`" start"
Write-Host "  Status:   node `"$serve`" status"
Write-Host "  Stop:     node `"$serve`" stop"
