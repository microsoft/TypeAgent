# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# macros-teardown.ps1 — post-demo cleanup for the user-defined macros demo.

param(
    [string]$DemoName = "macros"
)

$ErrorActionPreference = "Continue"
$msg = { param($m) Write-Host "[teardown] $m" }

# Move recent recording to per-demo folder (same pattern as montage-teardown).
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
            & $msg "moved recording to $newPath"
        } catch {
            & $msg "could not move recording: $($_.Exception.Message)"
        }
    }
}

Write-Output "DONE"
