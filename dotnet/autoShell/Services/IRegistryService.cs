// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts Windows Registry operations for testability.
/// </summary>
internal interface IRegistryService
{
    /// <summary>
    /// Gets a value from the registry under HKEY_CURRENT_USER.
    /// </summary>
    /// <param name="keyPath">The registry subkey path.</param>
    /// <param name="valueName">The name of the value to retrieve.</param>
    /// <param name="defaultValue">The value to return if the key or value does not exist.</param>
    object GetValue(string keyPath, string valueName, object defaultValue = null);

    /// <summary>
    /// Sets a value in the registry under HKEY_CURRENT_USER.
    /// </summary>
    /// <param name="keyPath">The registry subkey path (created if it does not exist).</param>
    /// <param name="valueName">The name of the value to set.</param>
    /// <param name="value">The data to store.</param>
    /// <param name="valueKind">The registry data type.</param>
    void SetValue(string keyPath, string valueName, object value, Microsoft.Win32.RegistryValueKind valueKind);

    /// <summary>
    /// Sets a value in the registry under HKEY_LOCAL_MACHINE.
    /// </summary>
    /// <param name="keyPath">The registry subkey path (created if it does not exist).</param>
    /// <param name="valueName">The name of the value to set.</param>
    /// <param name="value">The data to store.</param>
    /// <param name="valueKind">The registry data type.</param>
    void SetValueLocalMachine(string keyPath, string valueName, object value, Microsoft.Win32.RegistryValueKind valueKind);

    /// <summary>
    /// Broadcasts a WM_SETTINGCHANGE message to notify the system of a setting change.
    /// </summary>
    /// <param name="setting">The setting name to broadcast (e.g., "ImmersiveColorSet"), or null for a generic notification.</param>
    void BroadcastSettingChange(string setting = null);
}
