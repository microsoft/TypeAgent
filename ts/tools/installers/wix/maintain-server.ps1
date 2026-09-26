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

function Get-NodeScript([string]$command) {
    $tokens = @([regex]::Matches($command, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') })
    for ($index = 1; $index -lt $tokens.Count; $index++) {
        $token = $tokens[$index]
        if ($token -in @("-e", "--eval", "-p", "--print") -or $token -match "^--(eval|print)=") { return }
        if ($token -in @(
            "-r", "--require", "--import", "--loader", "--experimental-loader", "--inspect-port",
            "-C", "--conditions", "--disable-warning", "--disable-proto", "--dns-result-order",
            "--env-file", "--env-file-if-exists", "--icu-data-dir", "--openssl-config",
            "--redirect-warnings", "--diagnostic-dir", "--title", "--input-type",
            "--max-old-space-size", "--max-semi-space-size", "--stack-trace-limit"
        )) {
            $index++
            continue
        }
        if ($token -eq "--") {
            $index++
            if ($index -ge $tokens.Count) { return }
            $token = $tokens[$index]
        } elseif ($token.StartsWith("-")) {
            continue
        }
        if ([IO.Path]::IsPathRooted($token)) { return [IO.Path]::GetFullPath($token) }
        return
    }
}

function Test-PayloadCommand([string]$command, [string]$payload) {
    $script = Get-NodeScript $command
    return $script -and $script -in @(
        (Join-Path $payload "dist\server.js"),
        (Join-Path $payload "typeagent-serve.mjs")
    )
}

function Test-ProcessOwner($process, [string]$sid) {
    try {
        $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
        if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) {
            throw "Cannot verify ownership of payload process $($process.ProcessId)."
        }
    } catch {
        if (Get-SameProcess $process) { throw }
        Write-MaintenanceLog "Payload PID $($process.ProcessId) exited during discovery."
        return $false
    }
    return $true
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
            if (-not (Test-ProcessOwner $process $sid)) { continue }
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
                if (-not (Test-ProcessOwner $process $sid)) { continue }
                $owned[[int]$process.ProcessId] = $process
                $added = $true
            }
        }
    } while ($added)
    return @($owned.Values)
}

function Get-CreationTime($process) {
    if ($process.CreationTime) { return [string]$process.CreationTime }
    return $process.CreationDate.ToUniversalTime().Ticks.ToString()
}

function Get-ProcessIdentity($process) {
    return @{ ProcessId = $process.ProcessId; CreationTime = Get-CreationTime $process }
}

function Get-SameProcess($snapshot) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($snapshot.ProcessId)"
    if ($current -and (Get-CreationTime $current) -eq (Get-CreationTime $snapshot)) { return $current }
}

function Initialize-ProcessContext {
    if ("TypeAgentMaintenance.ProcessContext" -as [type]) { return }
    # Older installed launchers have no persisted environment. Read their process
    # parameters through a read-only handle, then protect the recovery data with DPAPI.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace TypeAgentMaintenance {
    public sealed class ProcessContext {
        public string Directory;
        public string Environment;
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern SafeProcessHandle OpenProcess(uint access, bool inherit, int id);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool ReadProcessMemory(SafeProcessHandle handle, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool GetProcessTimes(SafeProcessHandle handle, out long created, out long exited, out long kernel, out long user);
        [DllImport("ntdll.dll")]
        static extern int NtQueryInformationProcess(SafeProcessHandle handle, int info, IntPtr[] buffer, int size, out int returned);
        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes { public int Size; public IntPtr Descriptor; public int Inherit; }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfo {
            public int Size;
            public IntPtr Reserved, Desktop, Title;
            public int X, Y, Width, Height, CharsX, CharsY, Fill, Flags;
            public short Show, ReservedSize;
            public IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfoEx { public StartupInfo Info; public IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInformation { public IntPtr Process, Thread; public int Id, ThreadId; }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern SafeFileHandle CreateFileW(string name, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")]
        static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
            bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        public static int Start(string executable, string arguments, string directory, string environment, string log) {
            var security = new SecurityAttributes { Size = Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = 1 };
            using (var input = CreateFileW("NUL", 0x80000000, 7, ref security, 3, 0x80, IntPtr.Zero))
            using (var output = CreateFileW(log, 4, 7, ref security, 4, 0x80, IntPtr.Zero)) {
                if (input.IsInvalid || output.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                IntPtr attributes = Marshal.AllocHGlobal(size);
                IntPtr handles = Marshal.AllocHGlobal(2 * IntPtr.Size);
                IntPtr env = Marshal.StringToHGlobalUni(environment + "\0");
                bool initialized = false;
                try {
                    if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    initialized = true;
                    Marshal.WriteIntPtr(handles, input.DangerousGetHandle());
                    Marshal.WriteIntPtr(handles, IntPtr.Size, output.DangerousGetHandle());
                    // Only these two handles may reach the server. Inheriting
                    // MSI's other pipe handles prevents QuietExec reaching EOF.
                    if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles,
                        new IntPtr(2 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    var startup = new StartupInfoEx {
                        Info = new StartupInfo {
                            Size = Marshal.SizeOf(typeof(StartupInfoEx)), Flags = 0x100,
                            Input = input.DangerousGetHandle(), Output = output.DangerousGetHandle(), Error = output.DangerousGetHandle()
                        },
                        Attributes = attributes
                    };
                    ProcessInformation process;
                    var command = new StringBuilder("\"" + executable + "\" " + arguments);
                    if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                        0x08080400, env, directory, ref startup, out process))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot restart TypeAgent.");
                    CloseHandle(process.Thread);
                    CloseHandle(process.Process);
                    return process.Id;
                } finally {
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    Marshal.FreeHGlobal(attributes);
                    Marshal.FreeHGlobal(handles);
                    Marshal.ZeroFreeGlobalAllocUnicode(env);
                }
            }
        }
        static byte[] Bytes(SafeProcessHandle handle, long address, int size) {
            var bytes = new byte[size];
            IntPtr read;
            if (!ReadProcessMemory(handle, new IntPtr(address), bytes, new IntPtr(size), out read) || read.ToInt64() != size)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read TypeAgent launch context.");
            return bytes;
        }
        static long Pointer(SafeProcessHandle handle, long address, bool x86) {
            var bytes = Bytes(handle, address, x86 ? 4 : 8);
            return x86 ? BitConverter.ToUInt32(bytes, 0) : BitConverter.ToInt64(bytes, 0);
        }
        public static ProcessContext Read(int id, long expectedTicks) {
            if (IntPtr.Size != 8) throw new InvalidOperationException("MSI maintenance requires 64-bit PowerShell.");
            using (var handle = OpenProcess(0x410, false, id)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                long created, exited, kernel, user;
                if (!GetProcessTimes(handle, out created, out exited, out kernel, out user))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                // CIM exposes microseconds, whereas FILETIME exposes 100ns ticks.
                if (DateTime.FromFileTimeUtc(created).Ticks / 10 != expectedTicks / 10)
                    throw new InvalidOperationException("TypeAgent process identity changed.");
                var basic = new IntPtr[6];
                int returned;
                if (NtQueryInformationProcess(handle, 0, basic, 6 * IntPtr.Size, out returned) != 0)
                    throw new InvalidOperationException("Cannot query TypeAgent process parameters.");
                var wow = new IntPtr[1];
                if (NtQueryInformationProcess(handle, 26, wow, IntPtr.Size, out returned) != 0)
                    throw new InvalidOperationException("Cannot query TypeAgent process architecture.");
                bool x86 = wow[0] != IntPtr.Zero;
                long peb = (x86 ? wow[0] : basic[1]).ToInt64();
                long parameters = Pointer(handle, peb + (x86 ? 0x10 : 0x20), x86);
                long cwd = parameters + (x86 ? 0x24 : 0x38);
                int cwdLength = BitConverter.ToUInt16(Bytes(handle, cwd, 2), 0);
                long cwdBuffer = Pointer(handle, cwd + (x86 ? 4 : 8), x86);
                string directory = Encoding.Unicode.GetString(Bytes(handle, cwdBuffer, cwdLength));
                long environment = Pointer(handle, parameters + (x86 ? 0x48 : 0x80), x86);
                if (environment == 0) throw new InvalidOperationException("TypeAgent environment is unavailable.");
                var text = new StringBuilder();
                // Read only to each page boundary so the final page need not have
                // a readable successor. Stop at the environment's double NUL.
                for (int total = 0; total < 32 * 1024 * 1024;) {
                    int count = (int)Math.Min(4096 - (environment & 4095), 32 * 1024 * 1024 - total);
                    var bytes = Bytes(handle, environment, count);
                    for (int i = 0; i + 1 < count; i += 2) {
                        char c = (char)(bytes[i] | (bytes[i + 1] << 8));
                        if (c == '\0' && text.Length > 0 && text[text.Length - 1] == '\0')
                            return new ProcessContext { Directory = directory, Environment = text.ToString() };
                        text.Append(c);
                    }
                    environment += count;
                    total += count;
                }
                throw new InvalidOperationException("TypeAgent environment exceeded the capture limit.");
            }
        }
    }
}
'@
}

function Get-LaunchContext($server) {
    Initialize-ProcessContext
    $context = [TypeAgentMaintenance.ProcessContext]::Read($server.ProcessId, [long](Get-CreationTime $server))
    Add-Type -AssemblyName System.Security
    $json = @{ Directory = $context.Directory; Environment = $context.Environment } | ConvertTo-Json -Compress
    $protected = [Security.Cryptography.ProtectedData]::Protect(
        [Text.Encoding]::UTF8.GetBytes($json), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    return [Convert]::ToBase64String($protected)
}

function Start-RestoredServer($command) {
    Add-Type -AssemblyName System.Security
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
        [Convert]::FromBase64String($command.LaunchContext), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $context = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    Initialize-ProcessContext
    $recoveryLog = Join-Path $Root "logs\msi-restored-server.log"
    New-Item -ItemType Directory -Force -Path (Split-Path $recoveryLog) | Out-Null
    $childId = [TypeAgentMaintenance.ProcessContext]::Start(
        $command.Executable, $command.Arguments, $context.Directory, $context.Environment, $recoveryLog
    )
    $process = Get-Process -Id $childId -ErrorAction Stop
    try {
        if ($process.WaitForExit(1000)) {
            throw "Restored TypeAgent server exited. See '$recoveryLog'."
        }
    } finally { $process.Dispose() }
}

function Test-TaskServer($server, [string]$payload, $task) {
    if (-not $task -or $task.State -ne "Running") { return $false }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($server.ParentProcessId)"
    if (-not $parent -or $parent.Name -ne "wscript.exe" -or $parent.CreationDate -gt $server.CreationDate) {
        return $false
    }
    $tokens = @([regex]::Matches($parent.CommandLine, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') })
    return $tokens.Count -eq 2 -and $tokens[1] -ieq (Join-Path $payload "autostart-run.vbs") -and
        (Test-ProcessOwner $parent ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
}

function Get-RestartCommands($processes, [string]$payload, $task) {
    $entry = Join-Path $payload "dist\server.js"
    $servers = @($processes | Where-Object {
        $_.Name -eq "node.exe" -and $_.ExecutablePath -and
        (Get-NodeScript $_.CommandLine) -ieq $entry
    })
    foreach ($process in $processes) {
        if ($process.Name -eq "node.exe" -and $process.ProcessId -notin $servers.ProcessId -and
            $process.ParentProcessId -notin $processes.ProcessId -and (Get-SameProcess $process)) {
            throw "Cannot capture restart context for payload PID $($process.ProcessId): unrecognized Node entry point."
        }
    }
    foreach ($server in $servers) {
        if ($server.ParentProcessId -in $servers.ProcessId) { continue }
        if ($server.CommandLine -match '^(?:"[^"]+"|\S+)\s+(.+)$') {
            $arguments = $Matches[1]
            try {
                $taskOwned = Test-TaskServer $server $payload $task
                $context = if (-not $taskOwned) { Get-LaunchContext $server } else { $null }
            } catch {
                if (Get-SameProcess $server) { throw }
                Write-MaintenanceLog "Server PID $($server.ProcessId) exited before launch context capture."
                continue
            }
            if (-not (Get-SameProcess $server)) { continue }
            @{
                Executable = $server.ExecutablePath
                Arguments = $arguments
                ProcessId = $server.ProcessId
                CreationTime = Get-CreationTime $server
                TaskOwned = $taskOwned
                LaunchContext = $context
            }
        }
    }
}

function Get-GracefulShutdownPorts($processes, $listeners) {
    $localAddresses = @("127.0.0.1", "::1", "0.0.0.0", "::")
    foreach ($port in @($listeners.LocalPort | Sort-Object -Unique)) {
        $local = @($listeners | Where-Object {
            $_.LocalPort -eq $port -and $_.LocalAddress -in $localAddresses
        })
        if (
            $local.Count -gt 0 -and
            @($local | Where-Object { $_.OwningProcess -notin $processes.ProcessId }).Count -eq 0
        ) {
            $port
        }
    }
}

function Stop-RemainingPayloadProcesses($processes) {
    $unique = $processes | ForEach-Object { Get-ProcessIdentity $_ } | Sort-Object -Property ProcessId, CreationTime -Unique
    foreach ($process in ($unique | Sort-Object CreationTime -Descending)) {
        if (-not (Get-SameProcess $process)) { continue }
        Write-MaintenanceLog "Terminating remaining TypeAgent PID $($process.ProcessId)."
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        } catch {
            # A worker can exit after the identity check, including when its parent stops.
            if (Get-SameProcess $process) { throw }
            Write-MaintenanceLog "TypeAgent PID $($process.ProcessId) already exited."
        }
    }
}

function Stop-PayloadProcesses([string]$payload, $captured = @()) {
    $processes = @($captured) + @(Get-PayloadProcesses $payload)
    if (-not $processes.Count) { return }
    Write-MaintenanceLog "Stopping installed TypeAgent processes: $($processes.ProcessId -join ', ')."

    $stopScript = Join-Path $payload "dist\stop.js"
    $listeners = @(Get-NetTCPConnection -State Listen)
    $servers = @($processes | Where-Object {
        (Test-PayloadCommand $_.CommandLine $payload) -and (Get-SameProcess $_)
    })
    $node = $processes | Where-Object { $_.Name -eq "node.exe" -and $_.ExecutablePath } | Select-Object -First 1
    if ($node -and (Test-Path -LiteralPath $stopScript)) {
        $requestDeadline = [DateTime]::UtcNow.AddSeconds(10)
        # stop.js connects to localhost, not an arbitrary owned listen address.
        foreach ($port in @(Get-GracefulShutdownPorts $servers $listeners)) {
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
    Stop-RemainingPayloadProcesses $remaining
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

function Assert-RecoveryPath([string]$path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Automatic recovery refuses redirected path '$path'. Recovery files have been retained."
    }
}

function Restore-InterruptedMaintenance([string]$marker) {
    Assert-RecoveryPath $Root
    Assert-RecoveryPath $marker
    $previous = (Get-Content -LiteralPath $marker -Raw).Trim()
    if (-not $previous -or -not [IO.Path]::IsPathRooted($previous)) {
        throw "Maintenance marker has no absolute recovery path. Recovery files have been retained."
    }
    $previous = [IO.Path]::GetFullPath($previous).TrimEnd('\')
    if ($previous -ieq [IO.Path]::GetFullPath($TransactionDir).TrimEnd('\') -or
        (Split-Path $previous -Parent) -ine (Split-Path $Root -Parent) -or
        (Split-Path $previous -Leaf) -notlike 'TypeAgent-msi-*.tmp') {
        throw "Maintenance marker refers to an unexpected transaction '$previous'. Recovery files have been retained."
    }
    Assert-RecoveryPath $previous
    $stateFile = Join-Path $previous 'state.json'
    Assert-RecoveryPath $stateFile
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if (-not $state.Root -or [IO.Path]::GetFullPath($state.Root).TrimEnd('\') -ine $Root -or
        $state.Prepared -isnot [bool] -or $state.WasRunning -isnot [bool]) {
        throw "Previous maintenance state does not describe this installation. Recovery files have been retained."
    }
    $names = @('agent-server', 'copilot-plugin')
    $saved = @($state.SavedPayloads)
    if ($null -eq $state.SavedPayloads -or
        @($saved | Where-Object { $_ -notin $names }).Count -or
        @($saved | Sort-Object -Unique).Count -ne $saved.Count) {
        throw "Previous maintenance payload list is invalid. Recovery files have been retained."
    }
    foreach ($name in $names) {
        $backup = Join-Path $previous $name
        $installed = Join-Path $Root $name
        $hasBackup = Test-Path -LiteralPath $backup -PathType Container
        if (($hasBackup -and $name -notin $saved) -or
            ($state.Prepared -and $name -in $saved -and -not $hasBackup) -or
            (-not $state.Prepared -and $name -in $saved -and -not $hasBackup -and
                -not (Test-Path -LiteralPath $installed -PathType Container))) {
            throw "Cannot establish a complete previous '$name' payload. Recovery files have been retained."
        }
        foreach ($path in @($backup, $installed)) {
            if (Test-Path -LiteralPath $path) {
                # Walk without following junctions before rollback can move or
                # recursively remove anything referenced by old state.
                $pending = New-Object 'System.Collections.Generic.Stack[string]'
                $pending.Push($path)
                while ($pending.Count) {
                    $next = $pending.Pop()
                    Assert-RecoveryPath $next
                    if (Test-Path -LiteralPath $next -PathType Container) {
                        foreach ($child in Get-ChildItem -LiteralPath $next -Force) {
                            $pending.Push($child.FullName)
                        }
                    }
                }
            }
        }
    }
    if ($state.WasRunning) {
        foreach ($command in @($state.RestartCommands)) {
            if ($command.TaskOwned -isnot [bool] -or
                (-not $command.TaskOwned -and -not $command.LaunchContext)) {
                throw "Previous server launch context cannot be safely restored by this installer. Recovery files have been retained."
            }
        }
        if (-not @($state.RestartCommands).Count -and -not ($state.TaskXml -and $state.TaskWasRunning)) {
            throw "Previous running server has no recovery command. Recovery files have been retained."
        }
    }
    Write-MaintenanceLog "Recovering interrupted maintenance from '$previous' before continuing setup."
    # Use the current embedded implementation, never execute an older script
    # referenced by the marker. The child scope keeps the new transaction intact.
    & {
        param($Root, $TransactionDir, $LogPath)
        $Action = 'Rollback'
        Invoke-Maintenance
    } $Root $previous $LogPath
    if (Test-Path -LiteralPath $marker) {
        throw "Previous recovery did not clear its marker. Setup will not overwrite the recovery state."
    }
    Write-MaintenanceLog "Previous installation recovered; continuing the new maintenance transaction."
}

function Invoke-Maintenance {
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $payload = Join-Path $Root "agent-server"
    $marker = Join-Path $Root ".msi-maintenance"
    $statePath = Join-Path $TransactionDir "state.json"
    if ($Action -eq "Begin") {
        if (Test-Path -LiteralPath $marker) {
            Restore-InterruptedMaintenance $marker
        }
        $task = Get-OwnedAutostart $payload
        $processes = @(Get-PayloadProcesses $payload)
        $state = @{
            Root = $Root
            WasRunning = $processes.Count -gt 0
            RestartCommands = @(Get-RestartCommands $processes $payload $task)
            Processes = @($processes | ForEach-Object { Get-ProcessIdentity $_ })
            TaskXml = $(if ($task) { Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath } else { $null })
            TaskWasRunning = ($task -and $task.State -eq "Running")
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
        Stop-PayloadProcesses $payload $state.Processes
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
        if (
            (Test-Path -LiteralPath $marker) -and
            (Get-Content -LiteralPath $marker -Raw).Trim() -ne $TransactionDir
        ) {
            throw "Maintenance marker belongs to another transaction."
        }
        Set-Content -LiteralPath $marker -Value $TransactionDir
        $task = Get-OwnedAutostart $payload
        if ($task) {
            Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null
            Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
        }
        $backups = @($state.SavedPayloads | Where-Object {
            Test-Path -LiteralPath (Join-Path $TransactionDir $_)
        })
        # Even a failed Begin may have orphaned children. Never restart over
        # surviving processes, or discard recovery state if shutdown still fails.
        Stop-PayloadProcesses $payload $state.Processes
        if ($state.Prepared -or $backups.Count) {
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
        try {
            if ($state.TaskXml -and $state.TaskWasRunning) {
                Start-ScheduledTask -TaskName "TypeAgent Agent Server" -TaskPath "\"
                Write-MaintenanceLog "Restarted the restored TypeAgent scheduled task."
            }
            foreach ($command in @($state.RestartCommands | Where-Object { -not $_.TaskOwned })) {
                if (Get-SameProcess $command) { continue }
                Start-RestoredServer $command
                Write-MaintenanceLog "Requested restart using the original server launch context."
            }
            if (-not $state.RestartCommands.Count) {
                Write-MaintenanceLog "WARNING: No verified server launch command was available to restore."
            }
        } catch {
            Set-Content -LiteralPath $marker -Value $TransactionDir
            throw
        }
    }
    if ($Action -in @("Commit", "Rollback")) {
        foreach ($name in @("agent-server", "copilot-plugin")) {
            $backup = Join-Path $TransactionDir $name
            if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        }
        Remove-Item -LiteralPath $statePath
        $stagedScript = Join-Path $TransactionDir "maintain-server.ps1"
        if (Test-Path -LiteralPath $stagedScript) {
            Remove-Item -LiteralPath $stagedScript
            [IO.Directory]::Delete($TransactionDir)
        }
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
