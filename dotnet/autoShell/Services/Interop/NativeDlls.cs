// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services.Interop;

/// <summary>
/// Native DLL name constants for P/Invoke declarations.
/// </summary>
internal static class NativeDlls
{
    public const string User32 = "user32.dll";
    public const string Kernel32 = "kernel32.dll";
    public const string Shell32 = "shell32.dll";
    public const string WlanApi = "wlanapi.dll";
}
