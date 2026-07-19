# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
    Download and install the TypeAgent Shell (Windows) from Azure Blob Storage.

.DESCRIPTION
    Windows sibling of install-shell.sh. Reads the electron-updater channel
    metadata (<channel>-<arch>.yml) from the shell's Azure Blob Storage
    container, resolves the NSIS setup package path, downloads it, and runs it
    silently (NSIS /S).

    Blob reads use either:
      * an anonymous HTTPS base URL (-BlobBaseUrl), or
      * the Azure CLI (az storage blob download --auth-mode login), matching
        install-shell.sh. This requires 'az login' with access to the account.

.EXAMPLE
    pwsh ./install-shell.ps1 -Storage mystorage -Container mycontainer -Channel lkg

.EXAMPLE
    # Anonymous/public container (no az login required)
    pwsh ./install-shell.ps1 -BlobBaseUrl https://mystorage.blob.core.windows.net/mycontainer -Channel lkg
#>
[CmdletBinding()]
param(
    [string]$Storage = "",
    [string]$Container = "",
    [string]$Channel = "lkg",
    # Optional anonymous HTTPS base for public containers, e.g.
    # https://<account>.blob.core.windows.net/<container>. When set, the Azure
    # CLI is not used.
    [string]$BlobBaseUrl = "",
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\install-shell.log",
    # Do not launch the shell after install.
    [switch]$NoStart,
    # Skip the check that the TypeAgent agent-server is installed. The shipped
    # shell is connect-only and auto-spawns the agent-server, so by default this
    # script ensures the agent-server is present (installing it via
    # install-typeagent.ps1 when missing) before installing the shell.
    [switch]$SkipTypeAgentCheck,
    # Extra arguments splatted to install-typeagent.ps1 when the agent-server is
    # missing (e.g. @{ Provider = "copilot"; BootstrapPrereqs = $true }).
    [hashtable]$TypeAgentArgs = @{}
)

$ErrorActionPreference = "Stop"

function Initialize-Log {
    param([string]$Path)
    if ($Path) {
        $dir = Split-Path -Parent $Path
        if ($dir -and -not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        Set-Content -Path $Path -Value "" -Encoding utf8
    }
}

function Write-Log {
    param([string]$Message)
    $line = "[$([DateTime]::UtcNow.ToString('o'))] $Message"
    Write-Host $line
    if ($LogPath) {
        Add-Content -Path $LogPath -Value $line -Encoding utf8
    }
}

function Fail {
    param([string]$Message)
    Write-Log "ERROR: $Message"
    exit 1
}

function Get-Arch {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
        "x86"   { return "x64" }
        default {
            Fail "Unsupported processor architecture: $($env:PROCESSOR_ARCHITECTURE)"
        }
    }
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-BlobFile {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if ($BlobBaseUrl) {
        $url = "$($BlobBaseUrl.TrimEnd('/'))/$Name"
        Write-Log "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing
        return
    }

    if (-not (Test-Command az)) {
        Fail "Azure CLI ('az') not found and no -BlobBaseUrl provided. Install Azure CLI or pass -BlobBaseUrl for a public container."
    }
    if (-not $Storage) {
        Fail "-Storage is required when -BlobBaseUrl is not provided."
    }

    $containerName = if ($Container) { $Container } else { $Storage }
    Write-Log "Downloading blob '$Name' from $Storage/$containerName"
    & az storage blob download `
        --account-name $Storage `
        --container-name $containerName `
        --name $Name `
        --file $Destination `
        --auth-mode login `
        --overwrite 2>&1 | ForEach-Object { Write-Log "az> $_" }
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to download '$Name' from $Storage/$containerName. Ensure 'az login' has access to the account."
    }
}

function Get-PackagePathFromYml {
    param([Parameter(Mandatory = $true)][string]$YmlPath)

    # electron-updater metadata: the top-level 'path:' entry names the setup exe.
    $match = Select-String -Path $YmlPath -Pattern '^\s*path:\s*(.+)$' | Select-Object -First 1
    if (-not $match) {
        Fail "Could not find 'path:' in metadata file $YmlPath."
    }
    $value = $match.Matches[0].Groups[1].Value.Trim().Trim("'`"")
    if (-not $value) {
        Fail "Empty 'path:' value in metadata file $YmlPath."
    }
    return $value
}

Initialize-Log -Path $LogPath

# The shipped shell is connect-only: it auto-spawns and connects to a separately
# installed TypeAgent agent-server. Ensure that server is installed first so the
# shell has something to connect to, mirroring the MSI ordering (agent service
# before shell). The agent-server install lays down typeagent-serve.mjs at its
# InstallDir root (see install-typeagent.ps1).
if (-not $SkipTypeAgentCheck) {
    $agentServerMarker = Join-Path $env:LOCALAPPDATA "TypeAgent\agent-server\typeagent-serve.mjs"
    if (Test-Path $agentServerMarker) {
        Write-Log "Found TypeAgent agent-server at $agentServerMarker."
    } else {
        Write-Log "TypeAgent agent-server not found at $agentServerMarker; installing it first via install-typeagent.ps1."
        $installTypeAgent = Join-Path $PSScriptRoot "install-typeagent.ps1"
        if (-not (Test-Path $installTypeAgent)) {
            Fail "Cannot find install-typeagent.ps1 next to install-shell.ps1 to satisfy the agent-server dependency. Re-run with -SkipTypeAgentCheck to bypass."
        }
        & $installTypeAgent @TypeAgentArgs
        if ($LASTEXITCODE -ne 0) {
            Fail "Agent-server install (install-typeagent.ps1) failed with exit code $LASTEXITCODE; aborting shell install."
        }
        if (-not (Test-Path $agentServerMarker)) {
            Fail "install-typeagent.ps1 completed but agent-server marker still missing at $agentServerMarker."
        }
        Write-Log "TypeAgent agent-server installed."
    }
}

if (-not $BlobBaseUrl -and -not $Storage) {
    Fail "Provide either -Storage (with optional -Container) or -BlobBaseUrl."
}

$arch = Get-Arch
$channelArch = "$Channel-$arch"
$ymlName = "$channelArch.yml"

Write-Log "Installing TypeAgent Shell (channel '$Channel', arch '$arch')"

$dest = Join-Path $env:TEMP "typeagent-install-shell"
if (Test-Path $dest) {
    Remove-Item -Recurse -Force $dest
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null

try {
    $ymlPath = Join-Path $dest $ymlName
    Get-BlobFile -Name $ymlName -Destination $ymlPath

    $packageName = Get-PackagePathFromYml -YmlPath $ymlPath
    Write-Log "Resolved shell package: $packageName"

    $packagePath = Join-Path $dest $packageName
    Get-BlobFile -Name $packageName -Destination $packagePath

    if (-not (Test-Path $packagePath)) {
        Fail "Shell package not found after download: $packagePath"
    }

    Write-Log "Running silent install: $packagePath /S"
    $proc = Start-Process -FilePath $packagePath -ArgumentList "/S" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Fail "Shell installer exited with code $($proc.ExitCode)."
    }

    Write-Log "TypeAgent Shell installed successfully."

    if (-not $NoStart) {
        $exe = Join-Path $env:LOCALAPPDATA "Programs\typeagentshell\typeagentshell.exe"
        if (Test-Path $exe) {
            Write-Log "Launching TypeAgent Shell."
            Start-Process -FilePath $exe | Out-Null
        } else {
            Write-Log "Shell executable not found at $exe; skipping launch."
        }
    }
} finally {
    if (Test-Path $dest) {
        Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
    }
}

exit 0
