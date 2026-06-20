# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Bootstraps prerequisites for install-typeagent.ps1 on a fresh Windows machine.

.DESCRIPTION
  Installs/verifies the prerequisites expected by install-typeagent.ps1:

    1. winget (required installer backend)
    2. Node.js >= 22 (OpenJS.NodeJS.LTS via winget when needed)
    3. Azure CLI (Microsoft.AzureCLI via winget when missing)
    4. Azure DevOps az extension
    5. Optional: az login
    6. For Variant=external: claude + copilot CLIs via npm -g
    7. Optional: devtunnel CLI when -DevTunnel is specified

  This script is standalone and does not require a local TypeAgent repository.

.EXAMPLE
  pwsh ./setup-typeagent-prereqs.ps1

.EXAMPLE
  pwsh ./setup-typeagent-prereqs.ps1 -Variant full -SkipAzLogin

.EXAMPLE
  pwsh ./setup-typeagent-prereqs.ps1 -Variant external -DevTunnel

.EXAMPLE
  pwsh ./setup-typeagent-prereqs.ps1 -NoAutoElevate
#>

[CmdletBinding()]
param(
    [ValidateSet("external", "full")]
    [string]$Variant = "external",
    [switch]$DevTunnel,
    [switch]$SkipAzLogin,
    [switch]$ForceReinstallCli,
    [switch]$NoAutoElevate,
    [Parameter(DontShow)]
    [switch]$ElevatedInstance
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" }
function Write-WarnMsg($msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Error $msg; exit 1 }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-IsAdministrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NodeNeedsInstall {
    if (-not (Test-Command node)) { return $true }
    $major = (& node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
    return ([int]$major -lt 22)
}

function Get-AzureCliNeedsInstall {
    return (-not (Test-Command az))
}

function Get-DevTunnelNeedsInstall {
    if (-not $DevTunnel) { return $false }
    return (-not (Test-Command devtunnel))
}

function Test-RequiresAdminInstall {
    return (Get-NodeNeedsInstall) -or (Get-AzureCliNeedsInstall) -or (Get-DevTunnelNeedsInstall)
}

function Restart-ScriptElevated {
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } elseif ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } else { $null }
    if (-not $scriptPath) {
        Fail "Cannot auto-elevate because the script path is unavailable. Save the script to a file and run it with -File."
    }

    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $tempScriptDir = Join-Path $env:TEMP "TypeAgent_Prereqs_$timestamp"
    $tempScriptPath = Join-Path $tempScriptDir "setup-typeagent-prereqs.ps1"

    $powershellExecutable = if ($PSVersionTable.PSEdition -eq "Core") { "pwsh.exe" } else { "powershell.exe" }

    $argList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $tempScriptPath,
        "-Variant", $Variant,
        "-ElevatedInstance"
    )
    if ($DevTunnel) { $argList += "-DevTunnel" }
    if ($SkipAzLogin) { $argList += "-SkipAzLogin" }
    if ($ForceReinstallCli) { $argList += "-ForceReinstallCli" }

    try {
        Write-Step "Some prerequisite installs may require administrator rights"
        Write-Info "Requesting elevation via UAC"

        New-Item -ItemType Directory -Path $tempScriptDir -Force | Out-Null
        Copy-Item $scriptPath -Destination $tempScriptPath -Force

        $process = Start-Process $powershellExecutable -ArgumentList $argList -Verb RunAs -Wait -PassThru
        if ($null -eq $process) {
            return 1
        }
        return $process.ExitCode
    }
    finally {
        if (Test-Path $tempScriptDir) {
            Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    Write-Info "Installing $DisplayName ($Id) via winget"
    & winget install --id $Id --exact --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Fail "winget install failed for $DisplayName ($Id)."
    }
    Refresh-Path
}

function Ensure-Node {
    Write-Step "Ensuring Node.js >= 22"

    $needsInstall = $false
    if (-not (Test-Command node)) {
        $needsInstall = $true
    } else {
        $major = (& node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
        if ([int]$major -lt 22) {
            Write-WarnMsg "Found Node $(& node --version), but Node >= 22 is required."
            $needsInstall = $true
        }
    }

    if ($needsInstall) {
        Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
    }

    if (-not (Test-Command node)) {
        Fail "Node was not found on PATH after install. Open a new PowerShell session and re-run."
    }

    $majorAfter = (& node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
    if ([int]$majorAfter -lt 22) {
        Fail "Node >= 22 required; found v$(& node --version)."
    }

    if (-not (Test-Command npm)) {
        Fail "npm was not found on PATH; npm is required."
    }

    Write-Ok "Node: $(& node --version)"
    Write-Ok "npm:  $(& npm --version)"
}

function Ensure-AzureCli {
    Write-Step "Ensuring Azure CLI"

    if (-not (Test-Command az)) {
        Install-WingetPackage -Id "Microsoft.AzureCLI" -DisplayName "Azure CLI"
    }

    if (-not (Test-Command az)) {
        Fail "Azure CLI (az) was not found on PATH after install. Open a new PowerShell session and re-run."
    }

    $azVersion = "unknown"
    try {
        $azVersionObj = & az version --output json | ConvertFrom-Json
        if ($null -ne $azVersionObj.'azure-cli') {
            $azVersion = [string]$azVersionObj.'azure-cli'
        }
    } catch {
        # Continue; version display is informational only.
    }
    Write-Ok "az:   $azVersion"

    Write-Step "Ensuring Azure DevOps extension"
    & az extension add --name azure-devops --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to install/verify the azure-devops extension."
    }
    Write-Ok "az extension 'azure-devops' is installed"

    if (-not $SkipAzLogin) {
        Write-Step "Ensuring az login"
        try {
            & az account show --only-show-errors *> $null
            Write-Ok "Already logged in to Azure CLI"
        } catch {
            Write-Info "Launching az login"
            & az login --only-show-errors | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Fail "az login failed."
            }
            Write-Ok "Azure CLI login completed"
        }
    }
}

function Ensure-NpmGlobalCli {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$PackageName,
        [Parameter(Mandatory = $true)][string]$FriendlyName
    )

    $shouldInstall = $ForceReinstallCli -or -not (Test-Command $Command)

    if ($shouldInstall) {
        Write-Info "Installing $FriendlyName (npm i -g $PackageName)"
        & npm install -g $PackageName
        if ($LASTEXITCODE -ne 0) {
            Fail "npm global install failed for $PackageName"
        }
        Refresh-Path
    }

    if (-not (Test-Command $Command)) {
        Fail "$FriendlyName command '$Command' was not found on PATH after install."
    }

    Write-Ok "$FriendlyName: $((Get-Command $Command).Source)"
}

function Ensure-ExternalClis {
    Write-Step "Ensuring external CLIs (claude, copilot)"
    Ensure-NpmGlobalCli -Command "claude" -PackageName "@anthropic-ai/claude-code" -FriendlyName "Claude Code CLI"
    Ensure-NpmGlobalCli -Command "copilot" -PackageName "@github/copilot" -FriendlyName "GitHub Copilot CLI"
    Write-WarnMsg "Remember to sign in once: run 'claude' and 'copilot' interactively."
}

function Ensure-DevTunnel {
    Write-Step "Ensuring devtunnel CLI"

    if (-not (Test-Command devtunnel)) {
        Install-WingetPackage -Id "Microsoft.devtunnel" -DisplayName "Microsoft Dev Tunnel"
    }

    if (-not (Test-Command devtunnel)) {
        Fail "devtunnel was not found on PATH after install."
    }

    Write-Ok "devtunnel: available"
}

Write-Step "Validating installer backend (winget)"
if (-not (Test-Command winget)) {
    Fail "winget is required but was not found. Install App Installer from Microsoft Store and re-run."
}
Write-Ok "winget: available"

$needsAdminInstall = Test-RequiresAdminInstall
$isAdmin = Test-IsAdministrator
if ($needsAdminInstall -and -not $isAdmin) {
    if ($NoAutoElevate) {
        Fail "Missing prerequisites require admin rights to install. Re-run as Administrator or remove -NoAutoElevate."
    }

    $exitCode = Restart-ScriptElevated
    if ($exitCode -ne 0) {
        Fail "Elevation failed or was cancelled (exit code $exitCode)."
    }
    exit 0
}

if ($ElevatedInstance) {
    Write-Ok "Running elevated prerequisite setup"
}

Ensure-Node
Ensure-AzureCli

if ($Variant -eq "external") {
    Ensure-ExternalClis
}

if ($DevTunnel) {
    Ensure-DevTunnel
}

Write-Host ""
Write-Host "Prerequisite setup completed." -ForegroundColor Green
Write-Host ""
Write-Host "Next step:" -ForegroundColor Cyan
Write-Host "  Run install-typeagent.ps1 (local or from GitHub raw URL)."
if ($Variant -eq "external") {
    Write-Host "  If not already authenticated, run: claude ; copilot"
}
