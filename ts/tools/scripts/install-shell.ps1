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
    # Optional Azure Artifacts Universal Package fallback. When the blob
    # download(s) fail (e.g. the storage account disallows anonymous access),
    # the shell is pulled from the feed instead via `az artifacts universal
    # download` (authenticated with the caller's `az login`). The feed is
    # published to alongside blob storage by the release pipeline.
    [string]$Feed = "",
    [string]$FeedPackage = "",
    [string]$FeedVersion = "",
    [string]$Organization = "",
    [string]$Project = "",
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
        [Parameter(Mandatory = $true)][string]$Destination,
        # Force the anonymous HTTPS path (requires -BlobBaseUrl).
        [switch]$Anonymous
    )

    if ($Anonymous) {
        if (-not $BlobBaseUrl) { throw "No -BlobBaseUrl provided for anonymous download." }
        $url = "$($BlobBaseUrl.TrimEnd('/'))/$Name"
        Write-Log "Downloading (anonymous) $url"
        Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing
        return
    }

    if (-not (Test-Command az)) {
        throw "Azure CLI ('az') not found for authenticated blob download."
    }
    if (-not $Storage) {
        throw "-Storage is required for an authenticated blob download."
    }

    $containerName = if ($Container) { $Container } else { $Storage }
    Write-Log "Downloading (az) blob '$Name' from $Storage/$containerName"
    $output = & az storage blob download `
        --account-name $Storage `
        --container-name $containerName `
        --name $Name `
        --file $Destination `
        --auth-mode login `
        --overwrite 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Log "az> $_" }
    if ($exitCode -ne 0) {
        throw "az storage blob download failed for '$Name' from $Storage/$containerName."
    }
}

# Download the whole shell Universal Package (channel .yml + setup exe) from the
# Azure Artifacts feed into $Destination. Authenticated via the caller's
# `az login`; policy-compliant (no anonymous access, no public npmjs).
function Resolve-LatestFeedVersion {
    $output = & az devops invoke `
        --organization $Organization `
        --area packaging `
        --resource packages `
        --route-parameters project=$Project feedId=$Feed `
        --query-parameters protocolType=upack packageNameQuery=$FeedPackage includeAllVersions=true `
        --api-version 7.1 `
        --output json `
        --only-show-errors 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "Failed to list versions for '$FeedPackage' in feed '$Feed': $details"
    }

    $response = ($output | Out-String) | ConvertFrom-Json
    $package = @(
        $response.value |
            Where-Object { $_.name -eq $FeedPackage -and $_.protocolType -eq "UPack" } |
            Select-Object -First 1
    )
    if ($package.Count -eq 0) {
        throw "Package '$FeedPackage' was not found in feed '$Feed'."
    }

    $versions = @($package[0].versions | Where-Object { $_.isListed -and -not $_.isDeleted })
    if ($versions.Count -eq 0) {
        throw "Package '$FeedPackage' has no listed versions in feed '$Feed'."
    }

    $latest = @($versions | Where-Object { $_.isLatest } | Select-Object -First 1)
    if ($latest.Count -eq 0) {
        $latest = @($versions | Sort-Object publishDate -Descending | Select-Object -First 1)
    }

    $version = [string]$latest[0].version
    if (-not $version) {
        throw "Unable to resolve the latest version of '$FeedPackage'."
    }
    return $version
}

function Get-ShellFromFeed {
    param([Parameter(Mandatory = $true)][string]$Destination)

    if (-not (Test-Command az)) {
        throw "Azure CLI ('az') not found; cannot download the shell from the feed."
    }
    if (-not $Organization) {
        throw "-Organization is required for a feed download."
    }
    if (-not $Project) {
        throw "-Project is required for a feed download."
    }
    # `az artifacts universal download` lives in the azure-devops extension.
    $extensionOutput = & az extension add --name azure-devops --only-show-errors 2>&1
    $extensionExitCode = $LASTEXITCODE
    $extensionOutput | ForEach-Object { Write-Log "az> $_" }
    if ($extensionExitCode -ne 0) {
        throw "Failed to install or update the Azure DevOps CLI extension."
    }

    $ver = if ($FeedVersion) { $FeedVersion } else { Resolve-LatestFeedVersion }
    Write-Log "Downloading universal package '$FeedPackage' v$ver from feed '$Feed'"
    $azArgs = @(
        "artifacts", "universal", "download",
        "--organization", $Organization,
        "--feed", $Feed,
        "--name", $FeedPackage,
        "--version", $ver,
        "--path", $Destination
    )
    if ($Project) { $azArgs += @("--project", $Project, "--scope", "project") }
    $downloadOutput = & az @azArgs 2>&1
    $downloadExitCode = $LASTEXITCODE
    $downloadOutput | ForEach-Object { Write-Log "az> $_" }
    if ($downloadExitCode -ne 0) {
        throw "az artifacts universal download failed for '$FeedPackage' v$ver from feed '$Feed'."
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

if (-not $BlobBaseUrl -and -not $Storage -and -not ($Feed -and $FeedPackage)) {
    Fail "Provide a shell source: -Storage (with optional -Container), -BlobBaseUrl, or -Feed with -FeedPackage/-Organization."
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
    $script:packagePath = $null

    # Try each configured source in order until one yields the channel .yml AND
    # the setup package it references. Authenticated az-blob first, then the
    # feed as a fallback. An explicit -BlobBaseUrl (anonymous, standalone
    # public-container use) is only tried as a last resort.
    $sources = @()
    if ($Storage) { $sources += "az-blob" }
    if ($Feed -and $FeedPackage) { $sources += "feed" }
    if ($BlobBaseUrl) { $sources += "anon-blob" }

    $obtained = $false
    foreach ($src in $sources) {
        try {
            Write-Log "Attempting shell download via '$src'."
            switch ($src) {
                "anon-blob" {
                    Get-BlobFile -Name $ymlName -Destination $ymlPath -Anonymous
                    $packageName = Get-PackagePathFromYml -YmlPath $ymlPath
                    Write-Log "Resolved shell package: $packageName"
                    $script:packagePath = Join-Path $dest $packageName
                    Get-BlobFile -Name $packageName -Destination $script:packagePath -Anonymous
                }
                "az-blob" {
                    Get-BlobFile -Name $ymlName -Destination $ymlPath
                    $packageName = Get-PackagePathFromYml -YmlPath $ymlPath
                    Write-Log "Resolved shell package: $packageName"
                    $script:packagePath = Join-Path $dest $packageName
                    Get-BlobFile -Name $packageName -Destination $script:packagePath
                }
                "feed" {
                    Get-ShellFromFeed -Destination $dest
                    if (-not (Test-Path $ymlPath)) {
                        throw "Feed package did not contain the channel metadata '$ymlName'."
                    }
                    $packageName = Get-PackagePathFromYml -YmlPath $ymlPath
                    Write-Log "Resolved shell package: $packageName"
                    $script:packagePath = Join-Path $dest $packageName
                    if (-not (Test-Path $script:packagePath)) {
                        throw "Feed package did not contain the setup package '$packageName'."
                    }
                }
            }
            if ($script:packagePath -and (Test-Path $script:packagePath)) {
                $obtained = $true
                Write-Log "Shell payload obtained via '$src'."
                break
            }
        } catch {
            Write-Log "WARNING: shell download via '$src' failed: $($_.Exception.Message)"
            Remove-Item $ymlPath -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not $obtained) {
        Fail "Could not download the TypeAgent Shell from any configured source (tried: $($sources -join ', ')). Ensure network access and 'az login', or verify the -BlobBaseUrl/-Feed coordinates."
    }

    $packagePath = $script:packagePath
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
