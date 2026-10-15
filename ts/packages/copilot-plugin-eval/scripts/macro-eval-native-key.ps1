param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [Parameter(Mandatory = $true)][ValidateSet('Down', 'Enter')][string]$Key
)
$ErrorActionPreference = 'Stop'
$run = (Resolve-Path -LiteralPath $RunDirectory).Path
$state = Get-Content -Raw (Join-Path $run 'console-state.json') | ConvertFrom-Json
$owner = Get-Content -Raw (Join-Path $run 'owner.json') | ConvertFrom-Json
$identities = Get-Content -Raw (Join-Path $run 'process-identities.json') | ConvertFrom-Json
if ($state.phase -ne 'running' -or $state.title -ne $owner.title) {
    throw 'Owned console state changed before key input'
}
foreach ($processId in @($state.bridgePid, $state.cliPid)) {
    $expected = @($identities | Where-Object ProcessId -eq $processId)
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    if ($expected.Count -ne 1 -or -not $current -or
        [string]::IsNullOrWhiteSpace($expected[0].ExecutablePath)) {
        throw 'Exact owned key-input process identity unavailable'
    }
    $started = ([DateTimeOffset]$current.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()
    if ($started -ne $expected[0].StartedMs -or
        $current.ParentProcessId -ne $expected[0].ParentProcessId -or
        $current.ExecutablePath -ne $expected[0].ExecutablePath) {
        throw 'Owned key-input process identity changed'
    }
}
$scratch = Join-Path $run ('key-driver-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:TMPDIR = $scratch
try {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class OwnedConsoleKey {
    [DllImport("kernel32.dll")] private static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern uint MapVirtualKeyW(uint key, uint mode);
    [StructLayout(LayoutKind.Explicit, Size=20)]
    private struct Input {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(4)] public int Down;
        [FieldOffset(8)] public ushort Repeat;
        [FieldOffset(10)] public ushort Key;
        [FieldOffset(12)] public ushort Scan;
        [FieldOffset(14)] public char Character;
        [FieldOffset(16)] public uint State;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool WriteConsoleInputW(IntPtr handle, Input[] records, uint count, out uint written);
    public static void Press(uint pid, bool down) {
        FreeConsole();
        if (!AttachConsole(pid)) throw new Win32Exception();
        IntPtr handle = new IntPtr(-1);
        try {
            handle = CreateFileW("CONIN$", 0xc0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new Win32Exception();
            ushort key = (ushort)(down ? 40 : 13);
            ushort scan = (ushort)MapVirtualKeyW(key, 0);
            Input[] input = {
                new Input { Type=1, Down=1, Repeat=1, Key=key, Scan=scan, Character=down ? '\0' : '\r', State=down ? 256u : 0u },
                new Input { Type=1, Down=0, Repeat=1, Key=key, Scan=scan, Character=down ? '\0' : '\r', State=down ? 256u : 0u }
            };
            uint written;
            if (!WriteConsoleInputW(handle, input, 2, out written) || written != 2)
                throw new Win32Exception();
        } finally {
            if (handle != new IntPtr(-1)) CloseHandle(handle);
            FreeConsole();
        }
    }
}
'@
[OwnedConsoleKey]::Press([uint32]$state.bridgePid, $Key -eq 'Down')
@{ key=$Key; bridgePid=$state.bridgePid; provenance='owned AttachConsole/CONIN$/WriteConsoleInputW' } | ConvertTo-Json -Compress
} finally {
    Remove-Item -LiteralPath $scratch -Force -Recurse
}
