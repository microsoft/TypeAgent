# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Provisions the runtime prerequisites the external agent-server variant needs:
  Claude Code from PATH, the TypeAgent-managed GitHub Copilot runtime, and a
  Node.js >= 22 check. Mirrors install-typeagent.ps1 so MSI and standalone
  installs use the same runtime contract.

.DESCRIPTION
  The MSI ships the 'external' agent-server variant, which prunes the bundled
  Claude/Copilot runtimes. Claude remains a per-user global prerequisite.
  Copilot is installed only for the Copilot provider into TypeAgent's versioned
  per-user runtime cache by the deployed setup command. Every failure is
  non-fatal (logged + warned) so a prerequisite hiccup never rolls back the
  MSI; the agent-server install itself succeeds and setup remains retryable.

.PARAMETER LogPath
  Optional log file; the script also writes to stdout (captured by the MSI log).
#>
param(
    [string]$LogPath,
    [ValidateSet("AISYSTEMS", "COPILOT")]
    [string]$Provider = "AISYSTEMS",
    [string]$AgentServerDir = "$env:LOCALAPPDATA\TypeAgent\agent-server",
    [string]$PluginInstallDir = "$env:LOCALAPPDATA\TypeAgent",
    [string]$FeedRegistry = "",
    [string]$UserDataDir,
    [string]$RuntimeRoot
)

$ErrorActionPreference = "Continue"

if ($UserDataDir) {
    $env:TYPEAGENT_USER_DATA_DIR = $UserDataDir
    $env:TYPEAGENT_CONFIG_DIR = $UserDataDir
}
if ($RuntimeRoot) {
    $env:TYPEAGENT_RUNTIME_ROOT = $RuntimeRoot
}

# Azure DevOps resource GUID (audience for the npm feed bearer token). Matches
# packages/defaultAgentProvider/src/installSources/feedAuth.ts.
$AdoResource = "499b84ac-1321-427f-aa17-267ca6975798"

. (Join-Path $PSScriptRoot "resolve-node.ps1")

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

function Test-Command([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Resolve the Azure CLI (az.cmd) from an MSI service context. PATH was already
# refreshed from the registry by Resolve-NodeExe; add the well-known install dir
# as a fallback so a machine-wide `az` is found even if PATH still lags.
function Resolve-AzCmd {
    $cmd = Get-Command az -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) {
        if (-not $base) { continue }
        $p = Join-Path $base "Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
        if (Test-Path $p) { return $p }
    }
    return $null
}

# Mint a short-lived Azure DevOps bearer token for the feed (feedAuth.ts
# pattern). Uses an existing `az` session only; interactive sign-in is deferred
# to the post-install setup command so silent MSI installs never block.
function Get-FeedToken([string]$azCmd) {
    if (-not $azCmd) { return $null }
    function Invoke-AzToken {
        try {
            $out = & $azCmd account get-access-token --resource $AdoResource --output json 2>$null | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
            $t = ($out | ConvertFrom-Json).accessToken
            if ($t) { return $t }
        } catch { }
        return $null
    }
    return (Invoke-AzToken)
}

# Write a throwaway npm userconfig (.npmrc) carrying the bearer token scoped to
# the feed. Returns the file path; caller removes its directory when done.
function New-TransientNpmrc([string]$registry, [string]$token) {
    $authKey = $registry -replace '^https:', ''
    $baseAuthKey = $authKey -replace 'registry/?$', ''
    $dir = Join-Path $env:TEMP ("ta-npmauth-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir ".npmrc"
    $content = "registry=$registry`n$($baseAuthKey):_authToken=$token`n$($authKey):_authToken=$token`n$($authKey):always-auth=true`n"
    Set-Content -Path $file -Value $content -NoNewline -Encoding ascii
    return $file
}

# npm global installs of the CLIs. Non-fatal: warn and continue on any failure.
# Pulls through the Azure feed with the transient auth config so no persistent
# credential/broker interaction is required in the installer service context.
function Install-Cli([string]$command, [string]$package, [string]$friendly, [string]$registry, [string]$userconfig) {
    if (Test-Command $command) {
        Write-Log "  $friendly already on PATH: $((Get-Command $command).Source)"
        return
    }
    Write-Log "  Installing $friendly from $registry"
    if (-not $registry -or -not $userconfig) {
        Write-Log "  WARNING: authenticated TypeAgent feed access is required to install $friendly. npm was not invoked."
        return
    }
    $npmArgs = @("install", "-g", $package, "--registry", $registry, "--userconfig", $userconfig)
    try {
        & npm @npmArgs 2>&1 | ForEach-Object { Write-Log "    $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "  WARNING: '$package' install exited with code $LASTEXITCODE. Re-run TypeAgent setup after authenticating to the package feed."
            return
        }
    } catch {
        Write-Log "  WARNING: '$package' install failed: $($_.Exception.Message). Re-run TypeAgent setup after authenticating to the package feed."
        return
    }
    if (Test-Command $command) {
        Write-Log "  ${friendly}: $((Get-Command $command).Source)"
    } else {
        Write-Log "  WARNING: '$command' not found on PATH after install. Open a new session and retry TypeAgent setup."
    }
}

function Get-RuntimeManifest {
    $manifestPath = Join-Path $AgentServerDir "copilot-runtime.json"
    if (-not (Test-Path $manifestPath)) {
        return $null
    }
    try {
        return Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    } catch {
        Write-Log "  WARNING: could not read Copilot runtime manifest: $($_.Exception.Message)"
        return $null
    }
}

function Invoke-CopilotRuntimeSetup([string]$nodeExe) {
    $serve = Join-Path $AgentServerDir "typeagent-serve.mjs"
    if (-not (Test-Path $serve)) {
        Write-Log "  WARNING: Copilot setup launcher not found at $serve."
        return $null
    }
    Write-Log "  Installing the SDK-compatible Copilot runtime from the TypeAgent package feed."
    & $nodeExe $serve setup --provider copilot --runtime-only --non-interactive 2>&1 |
        ForEach-Object { Write-Log "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Log "  WARNING: Copilot runtime setup is incomplete. Run: node `"$serve`" setup --provider copilot"
        return $null
    }
    $runtimeTool = Join-Path $AgentServerDir "tools\copilotRuntime.mjs"
    $pathOutput = & $nodeExe $runtimeTool path 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $pathOutput -and (Test-Path $pathOutput)) {
        Write-Log "  Copilot runtime: $pathOutput"
        return [string]$pathOutput
    }
    Write-Log "  WARNING: Copilot runtime was installed but its executable could not be resolved."
    return $null
}

function Invoke-PluginRegistration([string]$copilotPath) {
    $registerScript = Join-Path $PluginInstallDir "register-plugin.ps1"
    if (-not (Test-Path $registerScript)) {
        Write-Log "  WARNING: plugin registration script not found at $registerScript."
        return
    }
    $previousPath = $env:COPILOT_CLI_PATH
    try {
        if ($copilotPath) {
            $env:COPILOT_CLI_PATH = $copilotPath
        }
        Write-Log "  Registering the TypeAgent Copilot plugin after CLI/runtime resolution."
        & $registerScript -InstallDir $PluginInstallDir -LogPath (Join-Path $env:LOCALAPPDATA "TypeAgent\logs\msi-register-plugin.log") 2>&1 |
            ForEach-Object { Write-Log "    $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "  WARNING: Copilot plugin registration is deferred until a usable CLI is available."
        }
    } finally {
        $env:COPILOT_CLI_PATH = $previousPath
    }
}

Write-Log "Provisioning external runtime prerequisites for provider $Provider."
if ($UserDataDir) {
    Write-Log "  TypeAgent user data: $UserDataDir"
}
if ($RuntimeRoot) {
    Write-Log "  TypeAgent runtime root: $RuntimeRoot"
}

# Resolve node from an MSI service context (refreshes PATH + probes managers),
# so a bare `node`/`npm` on the interactive PATH is found here too.
$nodeExe = Resolve-NodeExe

# --- Node.js >= 22 (warn only; the MSI does not bundle Node) ------------------
if (-not $nodeExe) {
    Write-Log "  WARNING: Node.js >= 22 was not found. The agent-server requires it. Install it (e.g. 'winget install OpenJS.NodeJS.LTS') and re-run provisioning."
} else {
    $nodeMajor = Get-NodeMajor $nodeExe
    if ($nodeMajor -lt 22) {
        Write-Log "  WARNING: Node.js >= 22 required; found $(& $nodeExe --version) at $nodeExe. Upgrade (e.g. 'winget install OpenJS.NodeJS.LTS')."
    } else {
        Write-Log "  Node $(& $nodeExe --version) ($nodeExe)"
    }
}

# --- External runtimes -------------------------------------------------------
if (-not (Test-Command npm)) {
    Write-Log "  WARNING: npm (ships with Node.js) was not found; cannot install Claude or the managed Copilot runtime. Install Node.js >= 22 and retry TypeAgent setup."
} else {
    # Authenticate to the Azure feed non-interactively (public npmjs is blocked
    # by policy; the feed proxies it). The interactive broker tokenHelper in the
    # user's ~/.npmrc cannot run in the installer service (session 0), so we mint
    # a bearer token via the Azure CLI and pass a transient auth config instead.
    $manifest = Get-RuntimeManifest
    $registry = if ($FeedRegistry) { $FeedRegistry } elseif ($manifest -and $manifest.registry) { [string]$manifest.registry } else { $null }
    $userconfig = $null
    $azCmd = Resolve-AzCmd
    if (-not $azCmd) {
        Write-Log "  WARNING: Azure CLI ('az') not found; authenticated TypeAgent feed installation is unavailable. npm will not use another registry."
    } else {
        $token = Get-FeedToken $azCmd
        if ($token -and $registry) {
            $userconfig = New-TransientNpmrc $registry $token
            Write-Log "  Feed auth ready (registry: $registry)"
        } else {
            Write-Log "  WARNING: TypeAgent feed authentication or configuration is unavailable. npm will not use another registry."
        }
    }

    try {
        Install-Cli "claude" "@anthropic-ai/claude-code" "Claude Code CLI" $registry $userconfig
    } finally {
        if ($userconfig) {
            try { Remove-Item (Split-Path -Parent $userconfig) -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

$copilotPath = $null
if ($Provider -eq "COPILOT" -and $nodeExe) {
    $copilotPath = Invoke-CopilotRuntimeSetup $nodeExe
}
Invoke-PluginRegistration $copilotPath

if ($Provider -eq "COPILOT") {
    Write-Log "  NOTE: complete GitHub sign-in with: node `"$AgentServerDir\typeagent-serve.mjs`" setup --provider copilot"
}

Write-Log "Prerequisite provisioning complete."
# Always succeed: prerequisite issues are surfaced as warnings, not install failures.
exit 0
