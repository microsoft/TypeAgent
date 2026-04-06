// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;
using autoShell.Services.Interop;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="ISystemParametersService"/> using Win32 P/Invoke.
/// </summary>
internal partial class WindowsSystemParametersService : ISystemParametersService
{
    [LibraryImport(NativeDlls.User32, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SystemParametersInfo(int uiAction, int uiParam, IntPtr pvParam, int fWinIni);

    [LibraryImport(NativeDlls.User32, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SystemParametersInfo(int uiAction, int uiParam, int[] pvParam, int fWinIni);

    [LibraryImport(NativeDlls.User32, EntryPoint = "SystemParametersInfoW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);

    /// <inheritdoc/>
    public bool SetParameter(int action, int param, IntPtr vparam, int flags)
    {
        return SystemParametersInfo(action, param, vparam, flags);
    }

    /// <inheritdoc/>
    public bool SetParameter(int action, int param, string vparam, int flags)
    {
        return SystemParametersInfo(action, param, vparam, flags) != 0;
    }

    /// <inheritdoc/>
    public bool SetParameter(int action, int param, int[] vparam, int flags)
    {
        return SystemParametersInfo(action, param, vparam, flags);
    }

    /// <inheritdoc/>
    public bool GetParameter(int action, int param, int[] vparam, int flags)
    {
        return SystemParametersInfo(action, param, vparam, flags);
    }

    [LibraryImport(NativeDlls.User32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SwapMouseButtonNative(int fSwap);

    /// <inheritdoc/>
    public bool SwapMouseButton(bool swap)
    {
        return SwapMouseButtonNative(swap ? 1 : 0);
    }
}
