# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Provisions the runtime prerequisites the external agent-server variant needs:
  the Claude Code and GitHub Copilot CLIs (resolved from PATH at runtime), plus
  a Node.js >= 22 check. Mirrors the external-CLI step in install-typeagent.ps1
  so an MSI install matches the standalone installer.

.DESCRIPTION
  The MSI ships the 'external' agent-server variant, which prunes the bundled
  Claude/Copilot runtimes and expects `claude` and `copilot` on PATH. This
  script installs them per-user via `npm i -g` when missing. It is intentionally
  lightweight (no winget/admin/UAC): npm global installs land in the user's npm
  prefix, so it runs impersonated as the installing user. Every failure is
  non-fatal (logged + warned) so a prerequisite hiccup never rolls back the MSI;
  the agent-server install itself succeeds and the user is told what to fix.

.PARAMETER LogPath
  Optional log file; the script also writes to stdout (captured by the MSI log).
#>
param(
    [string]$LogPath,
    # Authoritative Azure Artifacts npm registry the CLIs are pulled through
    # (public npmjs is blocked by policy; this feed proxies it as upstream).
    # Overridable so the MSI can bake an org-specific feed if needed.
    [string]$FeedRegistry = "https://pkgs.dev.azure.com/msctoproj/AI_Systems/_packaging/typeagent-feed/npm/registry/"
)

$ErrorActionPreference = "Continue"

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
# pattern). Non-interactive when an `az` session exists; attempts a one-time
# `az login` (browser) fallback otherwise. Returns the token or $null.
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
    $token = Invoke-AzToken
    if ($token) { return $token }
    Write-Log "  No active 'az' session; attempting 'az login' for feed access."
    try {
        & $azCmd login --only-show-errors 2>&1 | ForEach-Object { Write-Log "    $_" }
    } catch {
        Write-Log "  WARNING: 'az login' failed: $($_.Exception.Message)"
    }
    return (Invoke-AzToken)
}

# Write a throwaway npm userconfig (.npmrc) carrying the bearer token scoped to
# the feed. Returns the file path; caller removes its directory when done.
function New-TransientNpmrc([string]$registry, [string]$token) {
    $authKey = $registry -replace '^https:', ''
    $base = $registry -replace 'registry/?$', ''
    $dir = Join-Path $env:TEMP ("ta-npmauth-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir ".npmrc"
    $content = "$($base):_authToken=$token`n$($authKey):_authToken=$token`n$($authKey):always-auth=true`n"
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
    Write-Log "  Installing $friendly (npm i -g $package)"
    $npmArgs = @("install", "-g", $package)
    if ($registry -and $userconfig) {
        $npmArgs += @("--registry", $registry, "--userconfig", $userconfig)
    }
    try {
        & npm @npmArgs 2>&1 | ForEach-Object { Write-Log "    $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "  WARNING: '$package' install exited with code $LASTEXITCODE. Install it manually: npm i -g $package"
            return
        }
    } catch {
        Write-Log "  WARNING: '$package' install failed: $($_.Exception.Message). Install it manually: npm i -g $package"
        return
    }
    if (Test-Command $command) {
        Write-Log "  ${friendly}: $((Get-Command $command).Source)"
    } else {
        Write-Log "  WARNING: '$command' not found on PATH after install (open a new session, or install manually: npm i -g $package)."
    }
}

Write-Log "Provisioning external-CLI prerequisites (claude, copilot)."

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

# --- External CLIs (claude, copilot) -----------------------------------------
if (-not (Test-Command npm)) {
    Write-Log "  WARNING: npm (ships with Node.js) was not found; cannot install claude/copilot. Install Node.js >= 22, then run: npm i -g @anthropic-ai/claude-code @github/copilot"
} else {
    # Authenticate to the Azure feed non-interactively (public npmjs is blocked
    # by policy; the feed proxies it). The interactive broker tokenHelper in the
    # user's ~/.npmrc cannot run in the installer service (session 0), so we mint
    # a bearer token via the Azure CLI and pass a transient auth config instead.
    $registry = $null
    $userconfig = $null
    $azCmd = Resolve-AzCmd
    if (-not $azCmd) {
        Write-Log "  WARNING: Azure CLI ('az') not found; cannot authenticate to the package feed. CLIs may fail to install. Install az + run 'az login', then: npm i -g @anthropic-ai/claude-code @github/copilot"
    } else {
        $token = Get-FeedToken $azCmd
        if ($token) {
            $registry = $FeedRegistry
            $userconfig = New-TransientNpmrc $registry $token
            Write-Log "  Feed auth ready (registry: $registry)"
        } else {
            Write-Log "  WARNING: could not obtain a feed access token from 'az'. CLIs may fail to install. Run 'az login', then: npm i -g @anthropic-ai/claude-code @github/copilot"
        }
    }

    try {
        Install-Cli "claude" "@anthropic-ai/claude-code" "Claude Code CLI" $registry $userconfig
        Install-Cli "copilot" "@github/copilot" "GitHub Copilot CLI" $registry $userconfig
    } finally {
        if ($userconfig) {
            try { Remove-Item (Split-Path -Parent $userconfig) -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    Write-Log "  NOTE: both CLIs require a one-time sign-in (run 'claude' and 'copilot' once) before agent actions work."
}

Write-Log "Prerequisite provisioning complete."
# Always succeed: prerequisite issues are surfaced as warnings, not install failures.
exit 0
