# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param([Parameter(Mandatory = $true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Real MSI transactions are restricted to disposable GitHub-hosted Windows runners.'
}
. (Join-Path $PSScriptRoot '..\..\..\installers\wix\maintain-server.ps1')
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$manifest = Get-Content -LiteralPath (Join-Path $OutputDir 'manifest.json') -Raw | ConvertFrom-Json
if (-not $manifest.IceValidated) { throw 'Packages did not pass ICE validation.' }
if ($manifest.RootName -ne 'TypeAgent-MsiLifecycle' -or $manifest.UpgradeCode -ne '528E3F97-8B53-4D80-92FA-AF3919D029BE') {
    throw 'Unexpected transaction-test product identity.'
}
$root = Join-Path $env:LOCALAPPDATA $manifest.RootName
$taskName = 'TypeAgent Agent Server'
$registry = 'HKCU:\Software\Microsoft\TypeAgentMsiLifecycle'
if ((Test-Path $root) -or (Test-Path $registry) -or
    (Test-Path (Join-Path $env:LOCALAPPDATA 'TypeAgent')) -or
    (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    throw 'Runner is not clean; refusing to modify an existing installation or task.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 18999 -ErrorAction SilentlyContinue) {
    throw 'Fixture port is already in use.'
}
$script:results = @()
$script:step = 0
$installer = New-Object -ComObject WindowsInstaller.Installer
$baseline = $manifest.Packages | Where-Object Name -eq 'baseline'
$candidate = $manifest.Packages | Where-Object Name -eq 'candidate'
$userData = Join-Path $env:USERPROFILE '.typeagent-lifecycle-user-data'
New-Item -ItemType Directory -Path $userData | Out-Null
$sentinel = Join-Path $userData 'keep.txt'
Set-Content -LiteralPath $sentinel -Value 'preserve user data across every transaction' -Encoding ASCII
$sentinelHash = (Get-FileHash $sentinel).Hash
$unrelated = Start-Process node.exe -ArgumentList '-e "setInterval(()=>{},1000)"' -WindowStyle Hidden -PassThru

function Assert($condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function Invoke-Msi($package, [string]$operation, [string]$label, [bool]$expectFailure = $false) {
    $script:step++
    $log = Join-Path $OutputDir ('{0:D2}-{1}.log' -f $script:step, $label)
    $arguments = @($operation, "`"$($package.Path)`"", '/qn', '/norestart', '/L*V', "`"$log`"",
        'STARTSERVER=1', 'AUTOSTART=1', 'VSCODECHAT=0', 'VSCODESHELL=0', 'SHELL=0')
    $process = Start-Process msiexec.exe -ArgumentList $arguments -PassThru
    try {
        if (-not $process.WaitForExit(180000)) {
            $process.Kill()
            throw "MSI timed out: $label; see $log"
        }
        $code = $process.ExitCode
    } finally { $process.Dispose() }
    $script:results += @{ Label = $label; ExitCode = $code; ExpectedFailure = $expectFailure; Log = $log }
    $script:results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutputDir 'results.json')
    if ($expectFailure) {
        Assert ($code -eq 1603) "Failure injection returned $code instead of 1603: $label"
        Assert (!!(Select-String -LiteralPath $log -Pattern 'Action start.*LifecycleFail')) "Failure injection was not reached: $label"
    } else {
        Assert ($code -eq 0) "MSI returned $code (including reboot-required is unexpected): $label"
    }
    Assert (-not (Select-String -LiteralPath $log -Pattern 'Error 2613|Error 2762')) "Invalid MSI sequencing: $label"
    Assert (-not $unrelated.HasExited) "Unrelated Node process was stopped: $label"
    Assert ((Get-FileHash $sentinel).Hash -eq $sentinelHash) "User data changed: $label"
}

function Get-Health([string]$version) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $lastError = ''
    do {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:18999/health' -TimeoutSec 2
            if ($health.version -eq $version) { return $health }
            $lastError = "Expected $version; found $($health.version)"
        } catch { $lastError = $_.Exception.Message }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Server is not healthy: $lastError"
}

function Assert-Installed($package) {
    $health = Get-Health $package.Version
    Assert ($installer.ProductState($package.ProductCode) -eq 5) "Product not registered: $($package.Name)"
    Assert ((Get-ItemProperty $registry).Version -eq $package.Version) 'Registry version mismatch'
    Assert ((Get-FileHash (Join-Path $root 'agent-server\dist\server.js')).Hash -eq $package.ServerHash) 'Server hash mismatch'
    Assert ((Get-Content (Join-Path $root 'copilot-plugin\version.txt') -Raw).Trim() -eq $package.Version) 'Plugin payload version mismatch'
    Assert (-not (Test-Path (Join-Path $root '.msi-maintenance'))) 'Maintenance marker stranded after transaction'
    $task = Get-ScheduledTask -TaskName $taskName
    Assert $task.Settings.Enabled 'Autostart is disabled'
    $servers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains((Join-Path $root 'agent-server\dist\server.js'))
    })
    Assert ($servers.Count -eq 1) "Expected one server, found $($servers.Count)"
    return $health
}

function Assert-Gone($health) {
    foreach ($id in @($health.pid, $health.child)) {
        Assert (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) "Previous fixture PID $id survived"
    }
}

function Assert-Uninstalled($package, $previous) {
    Assert-Gone $previous
    Assert ($installer.ProductState($package.ProductCode) -eq -1) 'Uninstalled product still registered'
    Assert (-not (Test-Path (Join-Path $root 'agent-server'))) 'Uninstall left server payload'
    Assert (-not (Test-Path (Join-Path $root 'copilot-plugin'))) 'Uninstall left plugin payload'
    Assert (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) 'Uninstall left autostart task'
    Assert (-not (Test-Path (Join-Path $root '.msi-maintenance'))) 'Uninstall left maintenance marker'
}

try {
    Invoke-Msi $baseline '/i' 'baseline-install'
    $old = Assert-Installed $baseline
    foreach ($package in @($manifest.Packages | Where-Object Failure)) {
        Invoke-Msi $package '/i' $package.Name $true
        Assert-Gone $old
        $old = Assert-Installed $baseline
        Assert ($installer.ProductState($package.ProductCode) -eq -1) 'Failed upgrade remained registered'
    }
    # Exercise a running logon task in addition to the manual daemon restored above.
    Stop-PayloadProcesses (Join-Path $root 'agent-server')
    Start-ScheduledTask -TaskName $taskName
    $old = Get-Health $baseline.Version
    Assert ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') 'Fixture task did not remain running'
    Invoke-Msi $candidate '/i' 'upgrade-running-task'
    Assert-Gone $old
    $current = Assert-Installed $candidate
    Assert ($installer.ProductState($baseline.ProductCode) -eq -1) 'Old MSI registration survived upgrade'
    Remove-Item -LiteralPath (Join-Path $root 'copilot-plugin\version.txt')
    Invoke-Msi $candidate '/fa' 'repair-missing-payload'
    Assert-Gone $current
    $current = Assert-Installed $candidate
    for ($cycle = 1; $cycle -le 2; $cycle++) {
        Invoke-Msi $candidate '/x' "uninstall-$cycle"
        Assert-Uninstalled $candidate $current
        Invoke-Msi $candidate '/i' "reinstall-$cycle"
        $current = Assert-Installed $candidate
    }
    Invoke-Msi $candidate '/x' 'final-uninstall'
    Assert-Uninstalled $candidate $current
    'All Windows Installer lifecycle scenarios passed.' | Set-Content (Join-Path $OutputDir 'passed.txt')
} finally {
    # Diagnostics precede cleanup, including on assertion/transaction failure.
    $diagnostics = Join-Path $OutputDir 'diagnostics'
    New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null
    Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($root)
    } | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine |
        ConvertTo-Json | Set-Content (Join-Path $diagnostics 'processes.json')
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
        Select-Object TaskName, State, Actions, Settings | ConvertTo-Json -Depth 5 |
        Set-Content (Join-Path $diagnostics 'task.json')
    foreach ($logRoot in @((Join-Path $root 'logs'), (Join-Path $env:LOCALAPPDATA 'TypeAgent\logs'))) {
        if (Test-Path $logRoot) { Copy-Item -Path (Join-Path $logRoot '*') -Destination $diagnostics -Force }
    }
    if (Test-Path $root) {
        Get-ChildItem -LiteralPath $root -Recurse -Force |
            Select-Object FullName, Length | ConvertTo-Json | Set-Content (Join-Path $diagnostics 'files.json')
    }
    if (-not $unrelated.HasExited) { $unrelated.Kill(); $unrelated.WaitForExit() }
    $unrelated.Dispose()
    # Do not hide failed recovery by manually repairing the test product here.
    # The hosted VM is discarded; its logs and packages remain in the artifact.
}
