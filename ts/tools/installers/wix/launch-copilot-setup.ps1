# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param(
    [Parameter(Mandatory = $true)]
    [string]$ServePath,
    [string]$UserDataDir,
    [string]$LocalAppDataDir,
    [string]$RuntimeRoot,
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\copilot-setup-launch.log"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "resolve-node.ps1")

$UserDataDir = Resolve-TypeAgentUserDataDir $UserDataDir $LocalAppDataDir

function Write-LaunchLog([string]$Message) {
    try {
        $directory = Split-Path -Parent $LogPath
        if ($directory -and -not (Test-Path $directory)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
        Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format "s"), $Message)
    } catch { }
}

try {
    $nodeExe = Resolve-NodeExe
    if (-not $nodeExe) {
        Write-LaunchLog "Node.js >= 22 was not found; Copilot setup was not launched."
        exit 0
    }
    if (-not (Test-Path $ServePath)) {
        Write-LaunchLog "TypeAgent setup launcher was not found at $ServePath."
        exit 0
    }

    $escapedNode = $nodeExe.Replace("'", "''")
    $escapedServe = $ServePath.Replace("'", "''")
    $escapedUserDataDir = $UserDataDir.Replace("'", "''")
    $userDataSetup = @"
`$env:TYPEAGENT_USER_DATA_DIR = '$escapedUserDataDir'
`$env:TYPEAGENT_CONFIG_DIR = '$escapedUserDataDir'
"@
    $runtimeRootSetup = if ($RuntimeRoot) {
        "`$env:TYPEAGENT_COPILOT_RUNTIME_ROOT = '$($RuntimeRoot.Replace("'", "''"))'`r`n"
    } else {
        ""
    }
    $setupCommand = @"
$userDataSetup
$runtimeRootSetup
`$Host.UI.RawUI.WindowTitle = 'TypeAgent GitHub Copilot Setup'
& '$escapedNode' '$escapedServe' setup --provider copilot --device-code
if (`$LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host 'GitHub Copilot setup completed successfully.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'GitHub Copilot setup is incomplete. Run this command again to retry:' -ForegroundColor Yellow
    Write-Host "& '$escapedNode' '$escapedServe' setup --provider copilot --device-code"
}
Read-Host 'Press Enter to close'
"@
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($setupCommand)
    )
    $powershellExe = Join-Path $PSHOME "powershell.exe"
    Start-Process -FilePath $powershellExe -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", $encodedCommand
    ) | Out-Null
    Write-LaunchLog "Started interactive GitHub Copilot setup."
} catch {
    Write-LaunchLog "Could not launch GitHub Copilot setup: $($_.Exception.Message)"
}
