// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System;
using System.Runtime.InteropServices;
using autoShell.Services.Interop;
using static autoShell.Services.Interop.SpiConstants;

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

    /// <inheritdoc/>
    public bool SetFilterKeys(bool enable)
    {
        const int FKF_FILTERKEYSON = 0x00000001;

        int cbSize = Marshal.SizeOf<FilterKeysNative>();
        var fk = new FilterKeysNative { cbSize = cbSize };
        IntPtr ptr = Marshal.AllocHGlobal(cbSize);
        try
        {
            Marshal.StructureToPtr(fk, ptr, false);
            if (!SystemParametersInfo(SPI_GETFILTERKEYS, cbSize, ptr, 0))
            {
                return false;
            }

            fk = Marshal.PtrToStructure<FilterKeysNative>(ptr);

            if (enable)
            {
                fk.dwFlags |= FKF_FILTERKEYSON;
            }
            else
            {
                fk.dwFlags &= ~FKF_FILTERKEYSON;
            }

            Marshal.StructureToPtr(fk, ptr, false);
            return SystemParametersInfo(SPI_SETFILTERKEYS, cbSize, ptr, SPIF_UPDATEINIFILE_SENDCHANGE);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    /// <inheritdoc/>
    public bool SetStickyKeys(bool enable)
    {
        const int SKF_STICKYKEYSON = 0x00000001;

        int cbSize = Marshal.SizeOf<StickyKeysNative>();
        var sk = new StickyKeysNative { cbSize = cbSize };
        IntPtr ptr = Marshal.AllocHGlobal(cbSize);
        try
        {
            Marshal.StructureToPtr(sk, ptr, false);
            if (!SystemParametersInfo(SPI_GETSTICKYKEYS, cbSize, ptr, 0))
            {
                return false;
            }

            sk = Marshal.PtrToStructure<StickyKeysNative>(ptr);

            if (enable)
            {
                sk.dwFlags |= SKF_STICKYKEYSON;
            }
            else
            {
                sk.dwFlags &= ~SKF_STICKYKEYSON;
            }

            Marshal.StructureToPtr(sk, ptr, false);
            return SystemParametersInfo(SPI_SETSTICKYKEYS, cbSize, ptr, SPIF_UPDATEINIFILE_SENDCHANGE);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;

    [LibraryImport(NativeDlls.Kernel32, EntryPoint = "LoadLibraryExW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    private static partial IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);

    [LibraryImport(NativeDlls.Kernel32, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool FreeLibrary(IntPtr hModule);

    [LibraryImport(NativeDlls.User32, EntryPoint = "LoadStringW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int LoadStringNative(IntPtr hInstance, uint uID, [Out] char[] lpBuffer, int nBufferMax);

    /// <inheritdoc/>
    public string? LoadStringResource(string dllPath, int resourceId)
    {
        IntPtr hModule = LoadLibraryEx(dllPath, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (hModule == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            char[] buffer = new char[256];
            int result = LoadStringNative(hModule, (uint)Math.Abs(resourceId), buffer, buffer.Length);
            return result > 0 ? new string(buffer, 0, result) : null;
        }
        finally
        {
            FreeLibrary(hModule);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FilterKeysNative
    {
        public int cbSize;
        public int dwFlags;
        public int iWaitMSec;
        public int iDelayMSec;
        public int iRepeatMSec;
        public int iBounceMSec;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StickyKeysNative
    {
        public int cbSize;
        public int dwFlags;
    }
}
