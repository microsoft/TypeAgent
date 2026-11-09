param(
    [Parameter(Mandatory=$true)][string]$Directory,
    [Parameter(Mandatory=$true)][string]$PipeName,
    [Parameter(Mandatory=$true)][long]$DeadlineMs
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
if ($PipeName -notmatch '^typeagent-native-[a-f0-9-]{36}$') { throw 'Invalid owned pipe name' }
$scratch = Join-Path $root 'compiler'
New-Item -ItemType Directory -Path $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
try {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
public sealed class NativeHookPipe : IDisposable {
    private readonly NamedPipeServerStream pipe;
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle handle, out uint pid);
    [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    private static extern IntPtr CommandLineToArgvW(string line, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    public NativeHookPipe(string name) {
        PipeSecurity acl = new PipeSecurity();
        acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, acl);
    }
    public uint Accept(int timeout) {
        IAsyncResult pending = pipe.BeginWaitForConnection(null, null);
        using (pending.AsyncWaitHandle) {
            if (!pending.AsyncWaitHandle.WaitOne(timeout)) throw new TimeoutException("Owned pipe accept deadline");
            pipe.EndWaitForConnection(pending);
        }
        uint pid;
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid) || pid == 0)
            throw new Win32Exception();
        return pid;
    }
    public string Read(int timeout) {
        MemoryStream result = new MemoryStream();
        byte[] value = new byte[1];
        DateTime until = DateTime.UtcNow.AddMilliseconds(timeout);
        for (int i = 0; i < 65536; i++) {
            int remaining = (int)(until - DateTime.UtcNow).TotalMilliseconds;
            if (remaining <= 0) throw new TimeoutException("Owned pipe read deadline");
            var next = pipe.ReadAsync(value, 0, 1);
            if (!next.Wait(remaining)) throw new TimeoutException("Owned pipe read deadline");
            if (next.Result == 0) throw new IOException("Incomplete hook association packet");
            if (value[0] == 10) return new UTF8Encoding(false, true).GetString(result.ToArray());
            result.WriteByte(value[0]);
        }
        throw new IOException("Hook association packet exceeds bound");
    }
    public void Acknowledge() {
        byte[] text = Encoding.UTF8.GetBytes("associated\n");
        pipe.Write(text, 0, text.Length);
        pipe.Flush();
    }
    public static string[] Arguments(string command) {
        int count;
        IntPtr raw = CommandLineToArgvW(command, out count);
        if (raw == IntPtr.Zero) throw new Win32Exception();
        try {
            string[] result = new string[count];
            for (int i = 0; i < count; i++)
                result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(raw, i * IntPtr.Size));
            return result;
        } finally { LocalFree(raw); }
    }
    public void Dispose() { pipe.Dispose(); }
}
'@
function Identity($process) {
    if (-not $process -or [string]::IsNullOrWhiteSpace($process.ExecutablePath) -or
        [string]::IsNullOrWhiteSpace($process.CommandLine)) { throw 'OS hook identity incomplete' }
    [ordered]@{
        ProcessId=$process.ProcessId
        ParentProcessId=$process.ParentProcessId
        StartedMs=([DateTimeOffset]$process.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()
        ExecutablePath=$process.ExecutablePath
        Arguments=[NativeHookPipe]::Arguments($process.CommandLine)
    }
}
$index = 0
while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $DeadlineMs -and $index -lt 32) {
    $pipe = New-Object NativeHookPipe($PipeName)
    try {
        if ($index -eq 0) {
            @{ serverPid=$PID; pipe=$PipeName; api='GetNamedPipeClientProcessId/SafePipeHandle' } |
                ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $root 'ready.json')
        }
        $remaining = [int][Math]::Min(300000, $DeadlineMs - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        $peerId = $pipe.Accept($remaining)
        $observedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $all = @(Get-CimInstance Win32_Process)
        $peer = $all | Where-Object ProcessId -eq $peerId
        $children = @($all | Where-Object ParentProcessId -eq $peerId | ForEach-Object { Identity $_ })
        $ancestry = @()
        $cursor = $peer
        for ($depth = 0; $cursor -and $depth -lt 16; $depth++) {
            $ancestry += Identity $cursor
            $parent = $cursor.ParentProcessId
            $cursor = $all | Where-Object ProcessId -eq $parent
            if ($cursor -and [string]::IsNullOrWhiteSpace($cursor.ExecutablePath)) { break }
        }
        $packet = $pipe.Read([int][Math]::Min(15000, $DeadlineMs - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())) | ConvertFrom-Json
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$peerId"
        $before = Identity $peer
        $after = Identity $current
        if ($before.StartedMs -ne $after.StartedMs -or
            $before.ExecutablePath -ne $after.ExecutablePath -or
            $before.ParentProcessId -ne $after.ParentProcessId) { throw 'Hook peer identity changed while reading' }
        $receipt = [ordered]@{
            protocol='native-hook-os-association-v1'
            serverPid=$PID
            pipe=$PipeName
            osApi='GetNamedPipeClientProcessId/SafePipeHandle'
            observedAtMs=$observedAt
            peer=$before
            peerAfter=$after
            ancestry=$ancestry
            children=$children
            packet=$packet
        }
        $file = Join-Path $root ('receipt-{0:d4}.json' -f $index)
        $pending = "$file.pending"
        $receipt | ConvertTo-Json -Depth 16 | Set-Content -Encoding UTF8 $pending
        Move-Item -LiteralPath $pending -Destination $file
        $pipe.Acknowledge()
        $index++
    } finally { $pipe.Dispose() }
}
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
