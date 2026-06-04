# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# macros-setup.ps1 — pre-demo setup for the user-defined macros demo.

param(
    [string]$DemoName = "macros"
)

$ErrorActionPreference = "Stop"
$msg = { param($m) Write-Host "[setup] $m" }

# 1. Ensure TypeAgent server is reachable.
& $msg "checking TypeAgent server..."
try {
    $sock = New-Object System.Net.Sockets.TcpClient
    $sock.ConnectAsync("localhost", 8999).Wait(2000) | Out-Null
    if (-not $sock.Connected) { Throw "not connected" }
    $sock.Close()
} catch {
    & $msg "starting TypeAgent server..."
    $repoRoot = "D:\repos\TypeAgent\ts"
    Start-Process -FilePath "pwsh" `
        -ArgumentList "-NoExit", "-Command", "cd `"$repoRoot`"; pnpm run start:server" `
        -WindowStyle Minimized
    Start-Sleep -Seconds 6
}

# 2. Clear stale demo-state file.
$statePath = if ($env:TYPEAGENT_DEMO_STATE_PATH) {
    $env:TYPEAGENT_DEMO_STATE_PATH
} else {
    Join-Path $env:TEMP "copilot-demo-state.json"
}
if (Test-Path $statePath) {
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
}

# 3. Verify gh CLI auth (macros demo doesn't strictly need it, but the
# Copilot CLI environment expects it).
try {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        & $msg "WARN: gh CLI not authenticated."
    }
} catch {
    & $msg "WARN: gh CLI not on PATH."
}

Write-Output "READY"
