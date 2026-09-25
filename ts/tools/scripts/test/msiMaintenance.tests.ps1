# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param([string]$MaintenanceScript)
$ErrorActionPreference = "Stop"
. $MaintenanceScript

function Assert($condition, [string]$message) {
    if (-not $condition) { throw $message }
}

$testDir = Join-Path ([IO.Path]::GetTempPath()) ("typeagent-maintenance-test-" + [guid]::NewGuid())
$Root = Join-Path $testDir "installation with spaces"
$TransactionDir = Join-Path $testDir "transaction"
$LogPath = Join-Path $testDir "maintenance.log"
$script:tasks = @()
$script:taskEvents = @()
function Get-ScheduledTask { return $script:tasks }
function Disable-ScheduledTask { param($TaskName, $TaskPath); $script:taskEvents += "disabled" }
function Stop-ScheduledTask { param($TaskName, $TaskPath); $script:taskEvents += "stopped" }
function Export-ScheduledTask { param($TaskName, $TaskPath); return "<original-task />" }
function Register-ScheduledTask { param($TaskName, $TaskPath, $Xml, [switch]$Force); $script:taskEvents += "restored:$Xml" }
function Unregister-ScheduledTask { param($TaskName, $TaskPath, $Confirm); $script:taskEvents += "removed"; $script:tasks = @() }
function Get-CimInstance { param($ClassName, $Filter); return @() }
$originalStop = ${function:Stop-PayloadProcesses}
function Stop-PayloadProcesses([string]$payload) {
    Assert (Test-Path (Join-Path $Root ".msi-maintenance")) "shutdown ran without blocking startup"
    & $originalStop $payload
}

try {
    New-Item -ItemType Directory -Path $Root, $TransactionDir | Out-Null
    $payload = Join-Path $Root "agent-server"
    $plugin = Join-Path $Root "copilot-plugin"
    New-Item -ItemType Directory -Path $payload, $plugin | Out-Null
    Set-Content -LiteralPath (Join-Path $payload "old.txt") -Value "old server"
    Set-Content -LiteralPath (Join-Path $plugin "old.txt") -Value "old plugin"
    $script:tasks = @([pscustomobject]@{
        TaskName = "TypeAgent Agent Server"; TaskPath = "\"
        Actions = @([pscustomobject]@{ Arguments = '"' + (Join-Path $payload "autostart-run.vbs") + '"' })
    })
    $Action = "Begin"
    Invoke-Maintenance
    Assert (Test-Path (Join-Path $Root ".msi-maintenance")) "maintenance marker missing"
    Assert (-not (Test-Path $payload)) "old payload was not moved out of the uninstall path"
    Assert (Test-Path (Join-Path $TransactionDir "agent-server\old.txt")) "rollback backup missing"
    Assert (($script:taskEvents -join ",") -eq "disabled,stopped") "autostart was not paused"
    New-Item -ItemType Directory -Path $payload, $plugin | Out-Null
    Set-Content -LiteralPath (Join-Path $payload "new.txt") -Value "new server"
    $Action = "Complete"
    Invoke-Maintenance
    Assert (-not (Test-Path (Join-Path $Root ".msi-maintenance"))) "startup remains blocked"
    $Action = "Rollback"
    Invoke-Maintenance
    Assert (Test-Path (Join-Path $payload "old.txt")) "rollback did not restore original server"
    Assert (-not (Test-Path (Join-Path $payload "new.txt"))) "rollback retained new files"
    Assert (Test-Path (Join-Path $plugin "old.txt")) "rollback did not restore plugin"
    Assert ($script:taskEvents -contains "restored:<original-task />") "autostart definition not restored"

    $handle = [IO.File]::Open((Join-Path $payload "old.txt"), "Open", "Read", "None")
    try {
        $Action = "Begin"
        $failed = $false
        try { Invoke-Maintenance } catch {
            $failed = $true
            Assert ($_.Exception.Message -match "Payload is still locked") "wrong locked-file error"
        }
        Assert $failed "locked payload unexpectedly accepted"
        Assert (Test-Path (Join-Path $payload "old.txt")) "preflight deleted a file"
        Assert (Test-Path (Join-Path $plugin "old.txt")) "preflight damaged second payload"
    } finally { $handle.Dispose() }
    $Action = "Rollback"
    Invoke-Maintenance
    Assert (Test-Path (Join-Path $payload "old.txt")) "preflight rollback damaged original files"

    $script:tasks[0].Actions[0].Arguments = '"C:\another-install\autostart-run.vbs"'
    $Action = "Begin"
    $failed = $false
    try { Invoke-Maintenance } catch {
        $failed = $true
        Assert ($_.Exception.Message -match "different installation") "wrong task-ownership error"
    }
    Assert $failed "foreign autostart task was accepted"
    Assert (-not (Test-Path (Join-Path $Root ".msi-maintenance"))) "foreign task failure created a marker"
    $script:tasks = @()

    # Commit leaves the new payload intact and removes only the backups.
    $Action = "Begin"
    Invoke-Maintenance
    New-Item -ItemType Directory -Path $payload | Out-Null
    Set-Content -LiteralPath (Join-Path $payload "new.txt") -Value "new server"
    $Action = "Complete"
    Invoke-Maintenance
    $Action = "Commit"
    Invoke-Maintenance
    Assert (Test-Path (Join-Path $payload "new.txt")) "commit removed the new payload"
    Assert (-not (Test-Path (Join-Path $TransactionDir "agent-server"))) "commit retained old payload"

    # First-install rollback removes the newly extracted directories.
    Remove-Item -LiteralPath $payload -Recurse -Force
    $Action = "Begin"
    Invoke-Maintenance
    New-Item -ItemType Directory -Path $payload | Out-Null
    $Action = "Rollback"
    Invoke-Maintenance
    Assert (-not (Test-Path $payload)) "first-install rollback left a payload"

    # Rollback must not depend on MSI's PATH or lose custom server arguments.
    $Action = "Begin"
    Invoke-Maintenance
    $state = Get-Content (Join-Path $TransactionDir "state.json") -Raw | ConvertFrom-Json
    $state.WasRunning = $true
    $state.RestartCommands = @(@{
        Executable = "C:\version-manager\node.exe"
        Arguments = '"' + (Join-Path $payload "dist\server.js") + '" --port 9123 --config inbox'
        ProcessId = 999999
        CreationDate = Get-Date
    })
    Save-MaintenanceState $state
    $script:restarts = @()
    function Start-Process {
        param($FilePath, $ArgumentList, $WindowStyle)
        Assert (-not (Test-Path (Join-Path $Root ".msi-maintenance"))) "restart occurred while maintenance was active"
        $script:restarts += @{ Executable = $FilePath; Arguments = $ArgumentList }
    }
    $Action = "Rollback"
    Invoke-Maintenance
    Assert ($script:restarts.Count -eq 1) "rollback did not request a restart"
    Assert ($script:restarts[0].Executable -eq "C:\version-manager\node.exe") "rollback resolved a different Node"
    Assert ($script:restarts[0].Arguments -match "--port 9123 --config inbox") "rollback lost startup arguments"
    Remove-Item Function:Start-Process

    $command = '"C:\Program Files\nodejs\node.exe" "' + (Join-Path $payload "dist\server.js") + '"'
    Assert (Test-PayloadCommand $command $payload) "quoted installed entry was not recognized"
    Assert (-not (Test-PayloadCommand ($command.Replace("agent-server\", "agent-server-other\")) $payload)) "sibling install matched"
    Assert (-not (Test-PayloadCommand ('node.exe C:\tools\linter.js "' + (Join-Path $payload "dist\server.js") + '"') $payload)) "a data argument was mistaken for the running script"
    Assert (Test-PayloadCommand ($command.Replace('" "' , '" --enable-source-maps "')) $payload) "Node runtime flags hid the installed entry"

    $now = Get-Date
    $script:processes = @(
        [pscustomobject]@{ ProcessId = 100; ParentProcessId = 1; CreationDate = $now; Name = "node.exe"; CommandLine = $command + " --port 9123"; ExecutablePath = "C:\Program Files\nodejs\node.exe" },
        [pscustomobject]@{ ProcessId = 101; ParentProcessId = 100; CreationDate = $now.AddSeconds(1); Name = "helper.exe" },
        [pscustomobject]@{ ProcessId = 102; ParentProcessId = 101; CreationDate = $now.AddSeconds(2); Name = "helper.exe" },
        [pscustomobject]@{ ProcessId = 103; ParentProcessId = 100; CreationDate = $now.AddSeconds(-1); Name = "unrelated.exe" }
    )
    function Get-CimInstance {
        param($ClassName, $Filter)
        if ($Filter -match "ProcessId=(\d+)") {
            return $script:processes | Where-Object { $_.ProcessId -eq [int]$Matches[1] }
        }
        return $script:processes
    }
    function Invoke-CimMethod {
        param($InputObject, $MethodName)
        return @{ ReturnValue = 0; Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
    }
    $owned = @(Get-PayloadProcesses $payload)
    Assert (($owned.ProcessId | Sort-Object) -join "," -eq "100,101,102") "process-tree scope is incorrect"
    $commands = @(Get-RestartCommands $owned $payload)
    Assert ($commands.Count -eq 1) "restart command selection included non-server children"
    Assert ($commands[0].Arguments -eq ('"' + (Join-Path $payload "dist\server.js") + '" --port 9123')) "restart arguments were not retained verbatim"
    $listeners = @(
        @{ LocalAddress = "192.168.1.20"; LocalPort = 8999; OwningProcess = 100 },
        @{ LocalAddress = "127.0.0.1"; LocalPort = 8999; OwningProcess = 999 },
        @{ LocalAddress = "::1"; LocalPort = 9123; OwningProcess = 100 },
        @{ LocalAddress = "127.0.0.1"; LocalPort = 9123; OwningProcess = 999 },
        @{ LocalAddress = "0.0.0.0"; LocalPort = 9124; OwningProcess = 100 }
    )
    $ports = @(Get-GracefulShutdownPorts $owned $listeners)
    Assert ($ports.Count -eq 1 -and $ports[0] -eq 9124) "localhost-only shutdown could reach an unrelated listener"
    $snapshot = $script:processes[0].PSObject.Copy()
    $script:processes[0].CreationDate = $now.AddMinutes(1)
    Assert (-not (Get-SameProcess $snapshot)) "reused PID was accepted"

    $script:stopCalls = 0
    function Stop-Process {
        param($Id, [switch]$Force, $ErrorAction)
        $script:stopCalls++
    }
    $current = $script:processes[0].PSObject.Copy()
    Stop-RemainingPayloadProcesses @($current, $current.PSObject.Copy())
    Assert ($script:stopCalls -eq 1) "duplicate snapshots caused repeated termination"
    Stop-RemainingPayloadProcesses @($snapshot)
    Assert ($script:stopCalls -eq 1) "a reused PID was terminated"

    function Stop-Process {
        param($Id, [switch]$Force, $ErrorAction)
        $script:stopCalls++
        $script:processes = @($script:processes | Where-Object { $_.ProcessId -ne $Id })
        throw "Cannot find a process with the process identifier $Id."
    }
    Stop-RemainingPayloadProcesses @($current)
    Assert ($script:stopCalls -eq 2) "concurrent exit scenario did not exercise termination"
    Assert ((Get-Content $LogPath -Raw) -match "PID 100 already exited") "concurrent exit was not logged"

    $script:processes = @($current)
    function Stop-Process {
        param($Id, [switch]$Force, $ErrorAction)
        throw "Access is denied for PID $Id."
    }
    $failed = $false
    try { Stop-RemainingPayloadProcesses @($current) } catch {
        $failed = $true
        Assert ($_.Exception.Message -eq "Access is denied for PID 100.") "termination error was replaced"
    }
    Assert $failed "failure to stop a still-live process was swallowed"
    Remove-Item Function:Stop-Process

    # Exercise real shutdown against an isolated Node parent and orphaned child.
    Remove-Item Function:Get-CimInstance
    Remove-Item Function:Invoke-CimMethod
    Set-Item Function:Stop-PayloadProcesses -Value $originalStop
    New-Item -ItemType Directory -Path (Join-Path $payload "dist") -Force | Out-Null
    $serverFile = Join-Path $payload "dist\server.js"
    $stopFile = Join-Path $payload "dist\stop.js"
    $readyFile = Join-Path $testDir "ready.json"
    $signalFile = Join-Path $testDir "stop.signal"
    $childFile = Join-Path $testDir "child.js"
    Set-Content -LiteralPath $childFile -Value 'setInterval(() => {}, 1000);'
    $jsReady = ConvertTo-Json $readyFile -Compress
    $jsSignal = ConvertTo-Json $signalFile -Compress
    $jsChild = ConvertTo-Json $childFile -Compress
    Set-Content -LiteralPath $serverFile -Value @"
const fs = require("node:fs");
const net = require("node:net");
const child = require("node:child_process").spawn(process.execPath, [$jsChild], {stdio:"ignore"});
const server = net.createServer();
server.listen(0, "127.0.0.1", () => fs.writeFileSync($jsReady, JSON.stringify({parent:process.pid,child:child.pid})));
setInterval(() => { if (fs.existsSync($jsSignal)) process.exit(0); }, 20);
"@
    Set-Content -LiteralPath $stopFile -Value "require('node:fs').writeFileSync($jsSignal, 'stop');"
    $node = (Get-Command node.exe).Source
    $unrelated = Start-Process -FilePath $node -ArgumentList "`"$childFile`"" -PassThru -WindowStyle Hidden
    $parent = Start-Process -FilePath $node -ArgumentList "`"$serverFile`"" -PassThru -WindowStyle Hidden
    $childId = $null
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while (-not (Test-Path $readyFile) -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 100
        }
        $ready = Get-Content $readyFile -Raw | ConvertFrom-Json
        $childId = $ready.child
        Stop-PayloadProcesses $payload
        Assert (Test-Path $signalFile) "graceful shutdown was not requested"
        Assert ($parent.HasExited) "parent is still running"
        Assert (-not (Get-Process -Id $childId -ErrorAction SilentlyContinue)) "orphaned child is still running"
        Assert (-not $unrelated.HasExited) "unrelated Node process was terminated"
    } finally {
        if (-not $parent.HasExited) { $parent.Kill(); $parent.WaitForExit() }
        if ($childId) { Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue }
        if (-not $unrelated.HasExited) { $unrelated.Kill(); $unrelated.WaitForExit() }
        $parent.Dispose()
        $unrelated.Dispose()
    }
    Write-Host "All maintenance scenarios passed"
} finally {
    Remove-Item -LiteralPath $testDir -Recurse -Force
}
