# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Test-only replacement for authenticated/runtime integration. WXS scheduling,
# real payload extraction, maintenance, and Windows Installer remain unchanged.
param(
    [string]$ServePath, [string]$LogPath, [string]$LocalAppDataDir,
    [string]$RuntimeRoot, [string]$ServeCommand, [string]$Port,
    [string]$ServeArgs, [string]$Provider, [string]$ServeCommandArg
)
$ErrorActionPreference = "Stop"
$installRoot = $PSScriptRoot
$entry = Join-Path $installRoot 'agent-server\dist\server.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = 'TypeAgent Agent Server'

if ($ServeCommand -eq 'autostart' -and $ServeCommandArg -eq 'disable') {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    # Match the legacy runtime's scoped autostart cleanup, even when the payload
    # has already been moved to the transaction backup.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($entry)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} elseif ($ServeCommand -eq 'autostart' -and $ServeCommandArg -eq 'enable') {
    $shim = Join-Path $installRoot 'agent-server\autostart-run.vbs'
    $command = '"""' + $node.Replace('"', '""') + '"" ""' + $entry.Replace('"', '""') + '"""'
    Set-Content -LiteralPath $shim -Encoding ASCII -Value @"
Set sh = CreateObject("WScript.Shell")
sh.Run $command, 0, True
"@
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$shim`""
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Force | Out-Null
} elseif ($ServeCommand -eq 'start') {
    . (Join-Path $installRoot 'lifecycle-maintenance.ps1')
    $Root = $installRoot
    $context = Get-LaunchContext (Get-CimInstance Win32_Process -Filter "ProcessId=$PID")
    Start-RestoredServer @{ Executable = $node; Arguments = "`"$entry`""; LaunchContext = $context }
} else {
    throw "Unexpected fixture command: $ServeCommand"
}
