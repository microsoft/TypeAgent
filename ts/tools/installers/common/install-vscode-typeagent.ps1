# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Installs or removes a TypeAgent VS Code extension (chat or shell) and its
  optional desktop shortcut.

.DESCRIPTION
  Shared by install-typeagent.ps1 and the WiX MSI. Discovers a compatible
  per-user or system VS Code installation, installs the supplied VSIX, and
  (for the chat extension) creates a desktop shortcut that enables the
  proposed chat sessions API.

  Ownership is tracked under a per-extension HKCU key so multiple extensions
  installed by the same MSI don't overwrite each other's uninstall metadata.
  Pass -NoShortcut for extensions that don't need a launcher on the desktop.

  Exit codes:
    0  Success.
    2  VS Code was not found.
    3  VS Code is older than MinimumVersion.
    10 Installation or removal failed.
#>
[CmdletBinding()]
param(
    [ValidateSet("Discover", "Install", "Uninstall")]
    [string]$Action = "Install",
    [string]$VsixPath = "",
    [version]$MinimumVersion = "1.133.0",
    [string]$ExtensionId = "typeagent.vscode-chat",
    [string]$Owner = "standalone",
    [string]$ShortcutName = "VS Code with TypeAgent.lnk",
    # HKCU key used to track ownership of the installed extension. Each
    # TypeAgent-managed extension gets its own subkey so a Chat uninstall does
    # not clobber the Shell record (and vice versa).
    [string]$OwnershipKey = "HKCU:\Software\Microsoft\TypeAgent\VSCodeChat",
    # Skip desktop-shortcut creation and removal. Use for extensions that don't
    # need a dedicated VS Code launcher (e.g. the TypeAgent VS Code Shell,
    # which doesn't require proposed APIs).
    [switch]$NoShortcut,
    [string]$LogPath = "$env:LOCALAPPDATA\TypeAgent\logs\vscode-chat-install.log"
)

$ErrorActionPreference = "Stop"
$ownershipKey = $OwnershipKey

function Write-Log {
    param([string]$Message)

    $line = "[$([DateTime]::UtcNow.ToString('o'))] $Message"
    Write-Host $line
    if (-not $LogPath) {
        return
    }

    try {
        $directory = Split-Path -Parent $LogPath
        if ($directory -and -not (Test-Path -LiteralPath $directory)) {
            New-Item -ItemType Directory -Force -Path $directory | Out-Null
        }
        Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
    } catch {
        # Logging must not block installation.
    }
}

function Invoke-CodeCli {
    param(
        [Parameter(Mandatory = $true)][string]$CliPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # VS Code may emit Node warnings on stderr even when the command succeeds.
        $ErrorActionPreference = "Continue"
        $output = & $CliPath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Get-CodeExeFromCli {
    param([string]$CliPath)

    if (-not $CliPath) {
        return $null
    }

    $item = Get-Item -LiteralPath $CliPath -ErrorAction SilentlyContinue
    if (-not $item) {
        return $null
    }

    if ($item.Name -ieq "Code.exe") {
        return $item.FullName
    }

    if ($item.Directory.Name -ieq "bin") {
        $candidate = Join-Path $item.Directory.Parent.FullName "Code.exe"
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Add-CodeCandidate {
    param(
        [System.Collections.Generic.List[object]]$Candidates,
        [System.Collections.Generic.HashSet[string]]$Seen,
        [string]$CliPath,
        [string]$ExePath
    )

    if (-not $CliPath -or -not (Test-Path -LiteralPath $CliPath)) {
        return
    }
    if (-not $ExePath) {
        $ExePath = Get-CodeExeFromCli -CliPath $CliPath
    }
    if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
        return
    }

    $resolvedCli = (Resolve-Path -LiteralPath $CliPath).Path
    $resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
    if ($resolvedCli -like "*\github.copilot-chat\copilotCli\*") {
        return
    }
    if (-not $Seen.Add($resolvedExe.ToLowerInvariant())) {
        return
    }

    $Candidates.Add([pscustomobject]@{
        CliPath = $resolvedCli
        ExePath = $resolvedExe
    })
}

function Get-CodeCandidates {
    $candidates = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    $command = Get-Command code -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        Add-CodeCandidate -Candidates $candidates -Seen $seen `
            -CliPath $command.Source -ExePath (Get-CodeExeFromCli $command.Source)
    }

    $roots = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code")
    )
    if ($env:ProgramFiles) {
        $roots += Join-Path $env:ProgramFiles "Microsoft VS Code"
    }
    if (${env:ProgramFiles(x86)}) {
        $roots += Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code"
    }

    foreach ($root in $roots) {
        Add-CodeCandidate -Candidates $candidates -Seen $seen `
            -CliPath (Join-Path $root "bin\code.cmd") `
            -ExePath (Join-Path $root "Code.exe")
    }

    $appPathKeys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Code.exe",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\Code.exe",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Code.exe"
    )
    foreach ($key in $appPathKeys) {
        $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        if (-not $entry) {
            continue
        }
        $exePath = [string]$entry."(default)"
        if ($exePath -and (Test-Path -LiteralPath $exePath)) {
            $root = Split-Path -Parent $exePath
            Add-CodeCandidate -Candidates $candidates -Seen $seen `
                -CliPath (Join-Path $root "bin\code.cmd") -ExePath $exePath
        }
    }

    return $candidates
}

function Get-CodeVersion {
    param([string]$CliPath)

    $result = Invoke-CodeCli -CliPath $CliPath -Arguments @("--version")
    if ($result.ExitCode -ne 0) {
        throw "VS Code version check failed for '$CliPath': $($result.Output | Out-String)"
    }
    $versionText = @($result.Output)[0].ToString().Trim()
    $parsed = $null
    if (-not [version]::TryParse($versionText, [ref]$parsed)) {
        throw "Unable to parse VS Code version '$versionText' from '$CliPath'."
    }
    return $parsed
}

function Find-CompatibleCode {
    $foundVersion = $null
    foreach ($candidate in Get-CodeCandidates) {
        try {
            $version = Get-CodeVersion -CliPath $candidate.CliPath
            if (-not $foundVersion -or $version -gt $foundVersion) {
                $foundVersion = $version
            }
            if ($version -ge $MinimumVersion) {
                return [pscustomobject]@{
                    CliPath = $candidate.CliPath
                    ExePath = $candidate.ExePath
                    Version = $version
                }
            }
        } catch {
            Write-Log "Ignoring VS Code candidate '$($candidate.CliPath)': $($_.Exception.Message)"
        }
    }

    if ($foundVersion) {
        Write-Log "VS Code $foundVersion is installed, but $ExtensionId requires $MinimumVersion or newer."
        exit 3
    }

    Write-Log "Compatible VS Code was not found. Skipping $ExtensionId integration."
    exit 2
}

function Get-DesktopShortcutPath {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) {
        $shell = New-Object -ComObject WScript.Shell
        $desktop = $shell.SpecialFolders.Item("Desktop")
    }
    if (-not $desktop) {
        throw "Unable to resolve the current user's desktop directory."
    }
    return Join-Path $desktop $ShortcutName
}

function Get-InstalledExtensionVersion {
    param([string]$CliPath)

    $result = Invoke-CodeCli -CliPath $CliPath -Arguments @(
        "--list-extensions",
        "--show-versions"
    )
    if ($result.ExitCode -ne 0) {
        throw "Unable to list VS Code extensions: $($result.Output | Out-String)"
    }
    $prefix = "$ExtensionId@"
    $match = @($result.Output | Where-Object {
        $_.ToString().StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -First 1)
    if ($match.Count -eq 0) {
        return $null
    }
    return $match[0].ToString().Substring($prefix.Length)
}

function Save-Ownership {
    param(
        [object]$Code,
        [string]$ExtensionVersion,
        [string]$ShortcutPath
    )

    New-Item -Path $ownershipKey -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name InstalledByTypeAgent -Value 1 `
        -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name ExtensionId -Value $ExtensionId `
        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name Owner -Value $Owner `
        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name ExtensionVersion -Value $ExtensionVersion `
        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name CliPath -Value $Code.CliPath `
        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name VsCodePath -Value $Code.ExePath `
        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $ownershipKey -Name ShortcutPath -Value ([string]$ShortcutPath) `
        -PropertyType String -Force | Out-Null
}

function Install-VsCodeChat {
    if (-not $VsixPath) {
        throw "-VsixPath is required for installation."
    }
    if (-not (Test-Path -LiteralPath $VsixPath -PathType Leaf)) {
        throw "VSIX not found: $VsixPath"
    }

    $code = Find-CompatibleCode
    Write-Log "Installing $ExtensionId into VS Code $($code.Version) using '$($code.CliPath)'."
    $result = Invoke-CodeCli -CliPath $code.CliPath -Arguments @(
        "--install-extension",
        $VsixPath,
        "--force"
    )
    $result.Output | ForEach-Object { Write-Log "code> $_" }
    if ($result.ExitCode -ne 0) {
        throw "VS Code extension installation failed with exit code $($result.ExitCode)."
    }

    $installedVersion = Get-InstalledExtensionVersion -CliPath $code.CliPath
    if (-not $installedVersion) {
        throw "VS Code did not report '$ExtensionId' after installation."
    }

    $shortcutPath = ""
    if (-not $NoShortcut) {
        $shortcutPath = Get-DesktopShortcutPath
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $code.ExePath
        $shortcut.Arguments = "--new-window --enable-proposed-api=$ExtensionId"
        $shortcut.WorkingDirectory = $env:USERPROFILE
        $shortcut.IconLocation = "$($code.ExePath),0"
        $shortcut.Description = "Launch VS Code with TypeAgent Chat enabled"
        $shortcut.Save()
    }

    Save-Ownership -Code $code -ExtensionVersion $installedVersion `
        -ShortcutPath $shortcutPath
    Write-Log "Installed $ExtensionId@$installedVersion."
    if ($shortcutPath) {
        Write-Log "Created desktop shortcut: $shortcutPath"
    }
}

function Uninstall-VsCodeChat {
    $ownership = Get-ItemProperty -LiteralPath $ownershipKey -ErrorAction SilentlyContinue
    if (-not $ownership -or [string]$ownership.Owner -ne $Owner) {
        Write-Log "No $ExtensionId installation owned by '$Owner' was found."
        return
    }

    $shortcutPath = if ($ownership.ShortcutPath) {
        [string]$ownership.ShortcutPath
    } else {
        $null
    }
    if ($shortcutPath -and (Test-Path -LiteralPath $shortcutPath)) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Log "Removed desktop shortcut: $shortcutPath"
    }

    if ($ownership.InstalledByTypeAgent -eq 1) {
        $cliPath = [string]$ownership.CliPath
        if (-not $cliPath -or -not (Test-Path -LiteralPath $cliPath)) {
            $candidate = @(Get-CodeCandidates | Select-Object -First 1)
            $cliPath = if ($candidate.Count -gt 0) {
                [string]$candidate[0].CliPath
            } else {
                ""
            }
        }

        $installedVersion = if ($cliPath) {
            Get-InstalledExtensionVersion -CliPath $cliPath
        } else {
            $null
        }
        $ownedVersion = [string]$ownership.ExtensionVersion
        if ($installedVersion -and $installedVersion -eq $ownedVersion) {
            $result = Invoke-CodeCli -CliPath $cliPath -Arguments @(
                "--uninstall-extension",
                $ExtensionId
            )
            $result.Output | ForEach-Object { Write-Log "code> $_" }
            if ($result.ExitCode -ne 0) {
                throw "VS Code extension removal failed with exit code $($result.ExitCode)."
            }
            Write-Log "Removed $ExtensionId@$installedVersion."
        } elseif ($installedVersion) {
            Write-Log "Leaving $ExtensionId@$installedVersion installed because TypeAgent owns version $ownedVersion."
        }
    }

    if (Test-Path -LiteralPath $ownershipKey) {
        Remove-Item -LiteralPath $ownershipKey -Recurse -Force
    }
}

try {
    switch ($Action) {
        "Discover" {
            $code = Find-CompatibleCode
            Write-Log "Found VS Code $($code.Version) at '$($code.ExePath)'."
        }
        "Install" {
            Install-VsCodeChat
        }
        "Uninstall" {
            Uninstall-VsCodeChat
        }
    }
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 10
}
