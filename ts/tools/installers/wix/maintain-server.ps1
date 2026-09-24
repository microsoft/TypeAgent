# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param(
    [ValidateSet("Begin", "Complete", "Rollback", "Commit")][string]$Action,
    [string]$Root,
    [string]$TransactionDir,
    [string]$LogPath
)

$ErrorActionPreference = "Stop"

function Write-MaintenanceLog([string]$message) {
    $line = "{0} {1}" -f (Get-Date -Format "s"), $message
    Write-Host $line
    if ($LogPath) {
        New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
        Add-Content -LiteralPath $LogPath -Value $line
    }
}

function Test-PayloadCommand([string]$command, [string]$payload) {
    foreach ($entry in @("dist\server.js", "typeagent-serve.mjs")) {
        $file = [regex]::Escape((Join-Path $payload $entry))
        if ($command -match "(?i)(?:^|\s)`"?$file`"?(?:\s|$)") { return $true }
    }
    return $false
}

function Get-PayloadProcesses([string]$payload) {
    $prefix = $payload.TrimEnd('\') + '\'
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $all = @(Get-CimInstance Win32_Process)
    $owned = @{}
    foreach ($process in $all) {
        if ($process.Name -ne "node.exe" -or $process.ProcessId -eq $PID) { continue }
        $matches = Test-PayloadCommand $process.CommandLine $payload
        if (-not $matches) {
            try {
                $live = Get-Process -Id $process.ProcessId -ErrorAction Stop
                $matches = @($live.Modules | Where-Object {
                    $_.FileName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
                }).Count -gt 0
            } catch {
                # Unrelated/protected processes may not permit module inspection.
                continue
            }
        }
        if ($matches) {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
            if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) {
                throw "Cannot stop payload process $($process.ProcessId): ownership could not be verified."
            }
            $owned[[int]$process.ProcessId] = $process
        }
    }
    do {
        $added = $false
        foreach ($process in $all) {
            $parent = $owned[[int]$process.ParentProcessId]
            if (
                $parent -and -not $owned.ContainsKey([int]$process.ProcessId) -and
                $process.CreationDate -ge $parent.CreationDate
            ) {
                $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
                if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) {
                    throw "Cannot verify ownership of child process $($process.ProcessId)."
                }
                $owned[[int]$process.ProcessId] = $process
                $added = $true
            }
        }
    } while ($added)
    return @($owned.Values)
}

function Get-SameProcess($snapshot) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($snapshot.ProcessId)"
    if ($current -and $current.CreationDate -eq $snapshot.CreationDate) { return $current }
}

function Stop-PayloadProcesses([string]$payload) {
    $processes = @(Get-PayloadProcesses $payload)
    if (-not $processes.Count) { return }
    Write-MaintenanceLog "Stopping installed TypeAgent processes: $($processes.ProcessId -join ', ')."

    $stopScript = Join-Path $payload "dist\stop.js"
    $listeners = @(Get-NetTCPConnection -State Listen | Where-Object {
        $listener = $_
        @($processes | Where-Object {
            $_.ProcessId -eq $listener.OwningProcess -and
            (Test-PayloadCommand $_.CommandLine $payload)
        }).Count -gt 0
    })
    $node = $processes | Where-Object { $_.Name -eq "node.exe" -and $_.ExecutablePath } | Select-Object -First 1
    if ($node -and (Test-Path -LiteralPath $stopScript)) {
        $requestDeadline = [DateTime]::UtcNow.AddSeconds(10)
        foreach ($port in @($listeners.LocalPort | Sort-Object -Unique)) {
            $remainingMs = [int]($requestDeadline - [DateTime]::UtcNow).TotalMilliseconds
            if ($remainingMs -le 0) { break }
            Write-MaintenanceLog "Requesting graceful shutdown on port $port."
            $request = Start-Process -FilePath $node.ExecutablePath -ArgumentList @(
                "`"$stopScript`"", "--port", "$port"
            ) -WindowStyle Hidden -PassThru
            if (-not $request.WaitForExit($remainingMs)) {
                Write-MaintenanceLog "Graceful shutdown request timed out."
                $request.Kill()
                $request.WaitForExit()
            } elseif ($request.ExitCode -ne 0) {
                Write-MaintenanceLog "Graceful shutdown request exited with code $($request.ExitCode)."
            }
            $request.Dispose()
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $remaining = @($processes | Where-Object { Get-SameProcess $_ })
        if (-not $remaining.Count) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    # Keep the original snapshots so orphaned children remain in scope.
    $remaining = @($processes) + @(Get-PayloadProcesses $payload)
    foreach ($process in ($remaining | Sort-Object CreationDate -Descending)) {
        if (Get-SameProcess $process) {
            Write-MaintenanceLog "Terminating remaining TypeAgent PID $($process.ProcessId)."
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $live = @($remaining | Where-Object { Get-SameProcess $_ }) + @(Get-PayloadProcesses $payload)
        if (-not $live.Count) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "TypeAgent processes did not stop: $($live.ProcessId -join ', '). Payload files have not been removed."
}

function Assert-PayloadUnlocked([string]$payload) {
    if (-not (Test-Path -LiteralPath $payload)) { return }
    foreach ($file in Get-ChildItem -LiteralPath $payload -Recurse -File) {
        $handle = $null
        try {
            $handle = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        } catch {
            throw "Payload is still locked: '$($file.FullName)'. No payload files have been deleted. $($_.Exception.Message)"
        } finally {
            if ($handle) { $handle.Dispose() }
        }
    }
}

function Get-OwnedAutostart([string]$payload) {
    $task = @(Get-ScheduledTask | Where-Object {
        $_.TaskName -eq "TypeAgent Agent Server" -and $_.TaskPath -eq "\"
    }) | Select-Object -First 1
    if (-not $task) { return }
    $shim = Join-Path $payload "autostart-run.vbs"
    if (
        @($task.Actions).Count -ne 1 -or -not $task.Actions[0].Arguments -or
        $task.Actions[0].Arguments.Trim('"') -ine $shim
    ) {
        throw "The TypeAgent autostart task belongs to a different installation; refusing to change it."
    }
    return $task
}

function Save-MaintenanceState($state) {
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $TransactionDir "state.json") -Encoding UTF8
}

function Invoke-Maintenance {
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $payload = Join-Path $Root "agent-server"
    $marker = Join-Path $Root ".msi-maintenance"
    $statePath = Join-Path $TransactionDir "state.json"
    if ($Action -eq "Begin") {
        if (Test-Path -LiteralPath $marker) {
            throw "A previous TypeAgent maintenance operation is incomplete. See '$LogPath'."
        }
        $task = Get-OwnedAutostart $payload
        $state = @{
            Root = $Root
            WasRunning = @(Get-PayloadProcesses $payload).Count -gt 0
            TaskXml = $(if ($task) { Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath } else { $null })
            SavedPayloads = @("agent-server", "copilot-plugin" | Where-Object {
                Test-Path -LiteralPath (Join-Path $Root $_)
            })
            Prepared = $false
        }
        Save-MaintenanceState $state
        New-Item -ItemType Directory -Force -Path $Root | Out-Null
        Set-Content -LiteralPath $marker -Value $TransactionDir
        if ($task) {
            Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null
        }
        Stop-PayloadProcesses $payload
        if ($task) { Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath }
        foreach ($name in @("agent-server", "copilot-plugin")) {
            Assert-PayloadUnlocked (Join-Path $Root $name)
        }
        foreach ($name in $state.SavedPayloads) {
            $target = Join-Path $Root $name
            [IO.Directory]::Move($target, (Join-Path $TransactionDir $name))
        }
        $state.Prepared = $true
        Save-MaintenanceState $state
        Write-MaintenanceLog "TypeAgent stopped; previous payloads preserved for rollback."
        return
    }
    if (-not (Test-Path -LiteralPath $statePath)) { return }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.Root -ine $Root) { throw "Maintenance state does not match the installation." }
    if ($Action -eq "Rollback") {
        $backups = @($state.SavedPayloads | Where-Object {
            Test-Path -LiteralPath (Join-Path $TransactionDir $_)
        })
        if ($state.Prepared -or $backups.Count) {
            Stop-PayloadProcesses $payload
            foreach ($name in @("agent-server", "copilot-plugin")) {
                $target = Join-Path $Root $name
                if ($name -in $backups -or ($state.Prepared -and $name -notin $state.SavedPayloads)) {
                    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
                }
                if ($name -in $backups) {
                    [IO.Directory]::Move((Join-Path $TransactionDir $name), $target)
                }
            }
        }
        if ($state.TaskXml) {
            Register-ScheduledTask -TaskName "TypeAgent Agent Server" -TaskPath "\" -Xml $state.TaskXml -Force | Out-Null
        } else {
            $task = Get-OwnedAutostart $payload
            if ($task) {
                Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false
            }
        }
    }
    if ($Action -eq "Commit" -and -not (Test-Path -LiteralPath $payload)) {
        $task = Get-OwnedAutostart $payload
        if ($task) {
            Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false
        }
    }
    if (Test-Path -LiteralPath $marker) {
        if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $TransactionDir) {
            throw "Maintenance marker belongs to another transaction."
        }
        Remove-Item -LiteralPath $marker
    }
    if ($Action -eq "Rollback" -and $state.WasRunning) {
        $launcher = Join-Path $payload "typeagent-serve.mjs"
        if (Test-Path -LiteralPath $launcher) {
            $node = (Get-Command node.exe -ErrorAction Stop).Source
            Start-Process -FilePath $node -ArgumentList @("`"$launcher`"", "start") -WindowStyle Hidden | Out-Null
            Write-MaintenanceLog "Requested restart of the restored TypeAgent server."
        } else {
            Write-MaintenanceLog "WARNING: Restored server launcher is unavailable; unable to restart."
        }
    }
    if ($Action -in @("Commit", "Rollback")) {
        foreach ($name in @("agent-server", "copilot-plugin")) {
            $backup = Join-Path $TransactionDir $name
            if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        }
        Remove-Item -LiteralPath $statePath
    }
    Write-MaintenanceLog "TypeAgent maintenance $Action complete."
}

if ($MyInvocation.InvocationName -ne ".") {
    try {
        Invoke-Maintenance
    } catch {
        Write-MaintenanceLog "ERROR: $($_.Exception)"
        exit 1
    }
}
