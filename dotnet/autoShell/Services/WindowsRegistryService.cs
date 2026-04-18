// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;
using autoShell.Services.Interop;
using Microsoft.Win32;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IRegistryService"/> using Windows Registry.
/// </summary>
internal class WindowsRegistryService : IRegistryService
{
    /// <inheritdoc/>
    public object GetValue(string keyPath, string valueName, object defaultValue = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(keyPath);
        return key?.GetValue(valueName, defaultValue) ?? defaultValue;
    }

    /// <inheritdoc/>
    public void SetValue(string keyPath, string valueName, object value, RegistryValueKind valueKind)
    {
        using var key = Registry.CurrentUser.CreateSubKey(keyPath);
        key?.SetValue(valueName, value, valueKind);
    }

    /// <inheritdoc/>
    public void SetValueLocalMachine(string keyPath, string valueName, object value, RegistryValueKind valueKind)
    {
        using var key = Registry.LocalMachine.CreateSubKey(keyPath);
        key?.SetValue(valueName, value, valueKind);
    }

    /// <inheritdoc/>
    public void BroadcastSettingChange(string setting = null)
    {
        const int HWND_BROADCAST = 0xffff;
        const uint WM_SETTINGCHANGE = 0x001A;
        const uint SMTO_ABORTIFHUNG = 0x0002;
        SendMessageTimeout(
            (IntPtr)HWND_BROADCAST,
            WM_SETTINGCHANGE,
            IntPtr.Zero,
            setting,
            SMTO_ABORTIFHUNG,
            1000,
            out _);
    }

    /// <inheritdoc/>
    public void NotifyShellChange()
    {
        const int SHCNE_ASSOCCHANGED = 0x08000000;
        const int SHCNF_IDLIST = 0x0000;
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
    }

    /// <inheritdoc/>
    public void SetTaskbarAutoHideState(bool autoHide)
    {
        const int ABM_SETSTATE = 0x0000000A;
        const int ABS_AUTOHIDE = 0x0001;
        const int ABS_ALWAYSONTOP = 0x0002;

        IntPtr taskbarHwnd = FindWindow("Shell_TrayWnd", null);
        if (taskbarHwnd != IntPtr.Zero)
        {
            var abd = new APPBARDATA
            {
                cbSize = Marshal.SizeOf<APPBARDATA>(),
                hWnd = taskbarHwnd,
                lParam = (IntPtr)(autoHide ? (ABS_AUTOHIDE | ABS_ALWAYSONTOP) : ABS_ALWAYSONTOP)
            };
            SHAppBarMessage(ABM_SETSTATE, ref abd);
        }
    }

    [DllImport(NativeDlls.User32, CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd, uint Msg, IntPtr wParam, string lParam,
        uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

    [DllImport(NativeDlls.Shell32, CharSet = CharSet.Auto)]
    private static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

    [DllImport(NativeDlls.User32, CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport(NativeDlls.Shell32)]
    private static extern IntPtr SHAppBarMessage(int dwMessage, ref APPBARDATA pData);

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public int left, top, right, bottom;
        public IntPtr lParam;
    }
}
