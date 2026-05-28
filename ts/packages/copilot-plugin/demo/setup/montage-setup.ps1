# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# montage-setup.ps1 — pre-demo setup for the Montage demo.
# Invoked by demo-driver.ahk via @setup directive.
#
# Conventions:
# - Emit "READY" on stdout when finished so the driver knows we are done.
# - Errors should be fatal (non-zero exit). The driver shows the error
#   in the HUD and waits for the recorder to decide whether to push through.

param(
    [string]$DemoName = "montage"
)

$ErrorActionPreference = "Stop"
$progressMessage = { param($m) Write-Host "[setup] $m" }

# 1. Ensure the TypeAgent agent server is reachable.
& $progressMessage "checking TypeAgent server at ws://localhost:8999..."
try {
    $sock = New-Object System.Net.Sockets.TcpClient
    $sock.ConnectAsync("localhost", 8999).Wait(2000) | Out-Null
    if (-not $sock.Connected) {
        Throw "no connection"
    }
    $sock.Close()
    & $progressMessage "TypeAgent server is up."
} catch {
    & $progressMessage "TypeAgent server not running — starting it..."
    $repoRoot = "D:\repos\TypeAgent\ts"
    if (-not (Test-Path $repoRoot)) {
        Throw "TypeAgent repo not found at $repoRoot"
    }
    Start-Process -FilePath "pwsh" `
        -ArgumentList "-NoExit", "-Command", "cd `"$repoRoot`"; pnpm run start:server" `
        -WindowStyle Minimized
    Start-Sleep -Seconds 6
}

# 2. Close apps that might steal focus or appear in a recording from a
# prior run. Add/remove based on what the specific demo touches.
$appsToClose = @("Spotify", "Code", "msedge", "chrome")
foreach ($name in $appsToClose) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $_.CloseMainWindow() | Out-Null
        } catch {}
    }
}
Start-Sleep -Milliseconds 500

# 3. Clear any stale demo-state file from a previous run so the driver
# doesn't immediately pick it up as "this turn is done".
$statePath = if ($env:TYPEAGENT_DEMO_STATE_PATH) {
    $env:TYPEAGENT_DEMO_STATE_PATH
} else {
    Join-Path $env:TEMP "copilot-demo-state.json"
}
if (Test-Path $statePath) {
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
    & $progressMessage "cleared stale demo-state file."
}

# 4. (Optional) Verify Copilot CLI authentication.
try {
    $ghStatus = & gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        & $progressMessage "WARN: gh CLI not authenticated (gh auth login)."
    }
} catch {
    & $progressMessage "WARN: gh CLI not found on PATH."
}

Write-Output "READY"
