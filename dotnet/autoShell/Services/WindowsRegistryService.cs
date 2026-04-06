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

    [DllImport(NativeDlls.User32, CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd, uint Msg, IntPtr wParam, string lParam,
        uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
