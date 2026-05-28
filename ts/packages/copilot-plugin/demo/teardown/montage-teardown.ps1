# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# montage-teardown.ps1 — post-demo cleanup for the Montage demo.
# Invoked by demo-driver.ahk via @teardown directive (also runs on Esc abort).

param(
    [string]$DemoName = "montage"
)

$ErrorActionPreference = "Continue"  # cleanup is best-effort

$progressMessage = { param($m) Write-Host "[teardown] $m" }

# 1. Close apps that the demo opened. Best-effort — keep going on errors.
$appsToClose = @("Spotify", "Code", "msedge")
foreach ($name in $appsToClose) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $_.CloseMainWindow() | Out-Null
        } catch {}
    }
}

# 2. Move the most recent recording into a per-demo folder.
# Default for OBS recordings is configurable; for Game Bar it's:
#   $env:USERPROFILE\Videos\Captures
$captureDir = Join-Path $env:USERPROFILE "Videos\Captures"
$destDir    = Join-Path $env:USERPROFILE "Videos\TypeAgentDemos\$DemoName"
if (Test-Path $captureDir) {
    $latest = Get-ChildItem $captureDir -Filter *.mp4 -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 1
    if ($latest -and ($latest.LastWriteTime -gt (Get-Date).AddMinutes(-30))) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
        $newPath = Join-Path $destDir "$DemoName-$stamp.mp4"
        try {
            Move-Item $latest.FullName $newPath -Force
            & $progressMessage "moved recording to $newPath"
        } catch {
            & $progressMessage "could not move recording: $($_.Exception.Message)"
        }
    }
}

Write-Output "DONE"
