// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System;
using System.Collections.Generic;
using System.IO;
using System.Security;
using System.Text.Json;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Configuration for a registry toggle action: reads a bool parameter and writes a registry value.
/// Supports any value type (DWord, String, etc.) via <see cref="ValueKind"/>.
/// </summary>
/// <param name="KeyPath">The registry subkey path.</param>
/// <param name="ValueName">The name of the registry value.</param>
/// <param name="ParameterName">The JSON parameter name to read the bool from.</param>
/// <param name="OnValue">Value written when the parameter is true (default 1).</param>
/// <param name="OffValue">Value written when the parameter is false (default 0).</param>
/// <param name="ValueKind">The registry data type (default DWord).</param>
/// <param name="UseLocalMachine">If true, writes to HKLM instead of HKCU (default false).</param>
/// <param name="DisplayName">Human-readable name for log messages.</param>
/// <param name="BroadcastSetting">If set, broadcasts WM_SETTINGCHANGE with this string after writing.</param>
/// <param name="NotifyShell">If true, calls SHChangeNotify to refresh Explorer views after writing (default false).</param>
internal record RegistryToggleConfig(
    string KeyPath,
    string ValueName,
    string ParameterName,
    object OnValue,
    object OffValue,
    RegistryValueKind ValueKind = RegistryValueKind.DWord,
    bool UseLocalMachine = false,
    string? DisplayName = null,
    string? BroadcastSetting = null,
    bool NotifyShell = false);

/// <summary>
/// Configuration for a registry map action: reads a string parameter and maps it to a registry value.
/// </summary>
/// <param name="KeyPath">The registry subkey path.</param>
/// <param name="ValueName">The name of the registry value.</param>
/// <param name="ParameterName">The JSON parameter name to read.</param>
/// <param name="ValueMap">Maps parameter values to registry values (string keys, object values).</param>
/// <param name="DefaultValue">Value used when the parameter doesn't match any key in the map.</param>
/// <param name="ValueKind">The registry data type (default DWord).</param>
/// <param name="DisplayName">Human-readable name for log messages.</param>
/// <param name="NotifyShell">If true, calls SHChangeNotify to refresh Explorer views after writing (default false).</param>
internal record RegistryMapConfig(
    string KeyPath,
    string ValueName,
    string ParameterName,
    Dictionary<string, object> ValueMap,
    object DefaultValue,
    RegistryValueKind ValueKind = RegistryValueKind.DWord,
    string? DisplayName = null,
    bool NotifyShell = false);

/// <summary>
/// Configuration for an action that opens a Windows Settings page.
/// </summary>
/// <param name="SettingsUri">The ms-settings: URI to open.</param>
/// <param name="DisplayName">Human-readable name for the log message.</param>
internal record OpenSettingsConfig(
    string SettingsUri,
    string? DisplayName = null);

/// <summary>
/// Base class for settings handlers that extends <see cref="ActionHandlerBase"/> with
/// registry-specific action patterns. Subclasses register actions via
/// <see cref="AddRegistryToggleAction"/>, <see cref="AddRegistryMapAction"/>,
/// <see cref="AddOpenSettingsAction"/>, and <see cref="ActionHandlerBase.AddAction"/>
/// in their constructor.
/// </summary>
internal abstract class SettingsHandlerBase : ActionHandlerBase
{
    protected readonly IRegistryService Registry;
    private readonly IProcessService? _process;

    protected SettingsHandlerBase(IRegistryService registry, IProcessService? process = null)
    {
        Registry = registry;
        _process = process;
    }

    /// <summary>
    /// Registers a registry toggle action. Throws if the action name is already registered.
    /// </summary>
    protected void AddRegistryToggleAction(string actionName, RegistryToggleConfig config)
    {
        AddAction(actionName, parameters => ExecuteRegistryToggle(actionName, parameters, config));
    }

    /// <summary>
    /// Registers a registry map action. Throws if the action name is already registered.
    /// The value map is stored with case-insensitive keys to match original behavior.
    /// </summary>
    protected void AddRegistryMapAction(string actionName, RegistryMapConfig config)
    {
        // Ensure case-insensitive lookup for map keys (e.g., "Deny" matches "deny").
        if (config.ValueMap.Comparer != StringComparer.OrdinalIgnoreCase)
        {
            config = config with
            {
                ValueMap = new Dictionary<string, object>(config.ValueMap, StringComparer.OrdinalIgnoreCase)
            };
        }

        AddAction(actionName, parameters => ExecuteRegistryMap(actionName, parameters, config));
    }

    /// <summary>
    /// Registers an open-settings action. Throws if the action name is already registered
    /// or if no <see cref="IProcessService"/> was provided to the constructor.
    /// </summary>
    protected void AddOpenSettingsAction(string actionName, OpenSettingsConfig config)
    {
        if (_process is null)
        {
            throw new InvalidOperationException(
                $"Cannot register open-settings action '{actionName}' without an IProcessService.");
        }

        AddAction(actionName, _ => ExecuteOpenSettings(config));
    }

    /// <summary>
    /// Reads a bool parameter and writes the corresponding on/off value to the registry.
    /// </summary>
    private ActionResult ExecuteRegistryToggle(string key, JsonElement parameters, RegistryToggleConfig config)
    {
        string displayName = config.DisplayName ?? key;
        bool enable = parameters.GetBoolOrDefault(config.ParameterName, true);
        object value = enable ? config.OnValue : config.OffValue;

        try
        {
            if (config.UseLocalMachine)
            {
                Registry.SetValueLocalMachine(config.KeyPath, config.ValueName, value, config.ValueKind);
            }
            else
            {
                Registry.SetValue(config.KeyPath, config.ValueName, value, config.ValueKind);
            }

            Registry.BroadcastSettingChange(config.BroadcastSetting);
            if (config.NotifyShell)
            {
                Registry.NotifyShellChange();
            }
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or SecurityException or IOException)
        {
            return ActionResult.Fail($"Failed to set {displayName}: {ex.Message}");
        }

        return ActionResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    /// <summary>
    /// Reads a string parameter, maps it to a registry value, and writes the result.
    /// </summary>
    private ActionResult ExecuteRegistryMap(string key, JsonElement parameters, RegistryMapConfig config)
    {
        string displayName = config.DisplayName ?? key;
        string paramValue = parameters.GetStringOrDefault(config.ParameterName, "");
        object regValue = config.ValueMap.TryGetValue(paramValue, out var mapped) ? mapped : config.DefaultValue;

        try
        {
            Registry.SetValue(config.KeyPath, config.ValueName, regValue, config.ValueKind);
            Registry.BroadcastSettingChange();
            if (config.NotifyShell)
            {
                Registry.NotifyShellChange();
            }
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or SecurityException or IOException)
        {
            return ActionResult.Fail($"Failed to set {displayName}: {ex.Message}");
        }

        return ActionResult.Ok($"{displayName} set to {paramValue}");
    }

    /// <summary>
    /// Launches the configured ms-settings: URI.
    /// </summary>
    private ActionResult ExecuteOpenSettings(OpenSettingsConfig config)
    {
        string displayName = config.DisplayName ?? config.SettingsUri;

        try
        {
            _process!.StartShellExecute(config.SettingsUri);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
        {
            return ActionResult.Fail($"Failed to open {displayName}: {ex.Message}");
        }

        return ActionResult.Ok($"Opened {displayName}");
    }
}
