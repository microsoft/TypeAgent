# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Shared helper (dot-source it) that locates a usable node.exe from an MSI
  deferred custom-action context.

.DESCRIPTION
  MSI deferred custom actions run under the Windows Installer service, whose
  environment block is a stale snapshot captured when the service started. It
  therefore does NOT reflect a bare `node` on the user's interactive PATH —
  neither a Program Files\nodejs entry added to the machine PATH after the
  service started, nor (especially) a Node provided by a version manager such
  as fnm / nvm / Volta, which inject node into the *session* PATH only.

  Resolve-NodeExe fixes this by (1) refreshing $env:PATH and a few manager env
  vars from the registry (Machine + User) and (2) probing the well-known
  install locations of Node itself and the common version managers. On success
  it prepends node's directory to $env:PATH (so npm/npx and child `node`
  invocations resolve too) and returns the full path to node.exe. Returns $null
  when no Node can be found, letting callers warn-and-continue rather than fail.
#>

function Update-PathFromRegistry {
    # Rebuild $env:PATH from the persisted Machine + User values so nodes
    # installed to Program Files\nodejs (official installer / winget) are seen
    # even if the installer service's environment predates them.
    try {
        $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $combined = @($machine, $user) | Where-Object { $_ } | ForEach-Object { $_ }
        if ($combined) {
            $env:PATH = ($combined -join ';') + ';' + $env:PATH
        }
    } catch {
        # Best effort only.
    }
    # Version managers keep their root in a user env var; surface them too.
    foreach ($name in @("FNM_DIR", "NVM_HOME", "NVM_SYMLINK", "VOLTA_HOME")) {
        if (-not [System.Environment]::GetEnvironmentVariable($name, "Process")) {
            $val = [System.Environment]::GetEnvironmentVariable($name, "User")
            if (-not $val) { $val = [System.Environment]::GetEnvironmentVariable($name, "Machine") }
            if ($val) { Set-Item -Path "Env:$name" -Value $val -ErrorAction SilentlyContinue }
        }
    }
}

function Get-NodeMajor([string]$nodeExe) {
    try {
        $v = & $nodeExe -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>$null
        return [int]$v
    } catch {
        return 0
    }
}

function Resolve-NodeExe {
    Update-PathFromRegistry

    $found = @()

    # 1) PATH (now refreshed) — cheapest, and honors an explicit install.
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command node -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { $found += $cmd.Source }

    # 2) Official installer / winget: Program Files\nodejs.
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) {
        if ($base) { $found += (Join-Path $base "nodejs\node.exe") }
    }

    # 3) fnm — default alias first, then the highest installed version.
    $fnmRoots = @($env:FNM_DIR, (Join-Path $env:APPDATA "fnm"), (Join-Path $env:LOCALAPPDATA "fnm")) |
        Where-Object { $_ } | Select-Object -Unique
    foreach ($root in $fnmRoots) {
        $found += (Join-Path $root "aliases\default\installation\node.exe")
        $versionsDir = Join-Path $root "node-versions"
        if (Test-Path $versionsDir) {
            Get-ChildItem $versionsDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^v?\d+\.' } |
                Sort-Object { [version]($_.Name -replace '^v', '') } -Descending |
                ForEach-Object { $found += (Join-Path $_.FullName "installation\node.exe") }
        }
    }

    # 4) nvm-windows — symlink target or highest version under NVM_HOME.
    if ($env:NVM_SYMLINK) { $found += (Join-Path $env:NVM_SYMLINK "node.exe") }
    if ($env:NVM_HOME -and (Test-Path $env:NVM_HOME)) {
        Get-ChildItem $env:NVM_HOME -Directory -Filter "v*" -ErrorAction SilentlyContinue |
            Sort-Object { [version]($_.Name -replace '^v', '') } -Descending |
            ForEach-Object { $found += (Join-Path $_.FullName "node.exe") }
    }

    # 5) Volta.
    $voltaHome = if ($env:VOLTA_HOME) { $env:VOLTA_HOME } else { Join-Path $env:LOCALAPPDATA "Volta" }
    $voltaImg = Join-Path $voltaHome "tools\image\node"
    if (Test-Path $voltaImg) {
        Get-ChildItem $voltaImg -Directory -ErrorAction SilentlyContinue |
            Sort-Object { [version]($_.Name -replace '^v', '') } -Descending |
            ForEach-Object { $found += (Join-Path $_.FullName "node.exe") }
    }

    foreach ($candidate in ($found | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-Path $candidate) {
            # Prefer Node >= 22 but accept anything usable as a last resort.
            $dir = Split-Path -Parent $candidate
            $env:PATH = "$dir;$env:PATH"
            return $candidate
        }
    }

    return $null
}
