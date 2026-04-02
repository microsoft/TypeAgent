// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Microsoft.Win32;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of IRegistryService using Windows Registry.
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
}
