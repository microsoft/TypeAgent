// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of ISystemParametersService using Win32 P/Invoke.
/// </summary>
internal partial class WindowsSystemParametersService : ISystemParametersService
{
    private const int SPIF_UPDATEINIFILE = 0x01;
    private const int SPIF_SENDCHANGE = 0x02;

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SystemParametersInfo(int uiAction, int uiParam, IntPtr pvParam, int fWinIni);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SystemParametersInfo(int uiAction, int uiParam, int[] pvParam, int fWinIni);

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
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
    public bool GetParameter(int action, int param, int[] vparam, int flags)
    {
        return SystemParametersInfo(action, param, vparam, flags);
    }
}
