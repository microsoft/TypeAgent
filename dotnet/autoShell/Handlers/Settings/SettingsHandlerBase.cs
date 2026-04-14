// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;
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
internal record RegistryToggleConfig(
    string KeyPath,
    string ValueName,
    string ParameterName,
    object OnValue,
    object OffValue,
    RegistryValueKind ValueKind = RegistryValueKind.DWord,
    bool UseLocalMachine = false,
    string? DisplayName = null);

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
internal record RegistryMapConfig(
    string KeyPath,
    string ValueName,
    string ParameterName,
    Dictionary<string, object> ValueMap,
    object DefaultValue,
    RegistryValueKind ValueKind = RegistryValueKind.DWord,
    string? DisplayName = null);

/// <summary>
/// Configuration for an action that opens a Windows Settings page.
/// </summary>
/// <param name="SettingsUri">The ms-settings: URI to open.</param>
/// <param name="DisplayName">Human-readable name for the log message.</param>
internal record OpenSettingsConfig(
    string SettingsUri,
    string? DisplayName = null);

/// <summary>
/// Base class for settings handlers that support both registered and specialized actions.
/// Subclasses register actions via <see cref="AddRegistryToggleAction"/>, <see cref="AddRegistryMapAction"/>, and
/// <see cref="AddOpenSettingsAction"/> in their constructor, and override <see cref="HandleSpecialized"/>
/// for actions requiring custom logic.
/// </summary>
internal abstract class SettingsHandlerBase : ICommandHandler
{
    protected readonly IRegistryService Registry;
    private readonly IProcessService? _process;

    private readonly Dictionary<string, RegistryToggleConfig> _registryToggles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, RegistryMapConfig> _registryMaps = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, OpenSettingsConfig> _openSettings = new(StringComparer.OrdinalIgnoreCase);

    protected SettingsHandlerBase(IRegistryService registry, IProcessService? process = null)
    {
        Registry = registry;
        _process = process;
    }

    /// <summary>
    /// Action names registered via the Add methods. Subclasses should combine this with any specialized actions.
    /// </summary>
    protected IEnumerable<string> RegisteredActions =>
        _registryToggles.Keys.Concat(_registryMaps.Keys).Concat(_openSettings.Keys);

    /// <inheritdoc/>
    public abstract IEnumerable<string> SupportedCommands { get; }

    /// <summary>
    /// Registers a registry toggle action.
    /// </summary>
    protected void AddRegistryToggleAction(string actionName, RegistryToggleConfig config)
    {
        _registryToggles[actionName] = config;
    }

    /// <summary>
    /// Registers a registry map action.
    /// </summary>
    protected void AddRegistryMapAction(string actionName, RegistryMapConfig config)
    {
        _registryMaps[actionName] = config;
    }

    /// <summary>
    /// Registers an open-settings action.
    /// </summary>
    protected void AddOpenSettingsAction(string actionName, OpenSettingsConfig config)
    {
        _openSettings[actionName] = config;
    }

    /// <inheritdoc/>
    public virtual CommandResult Handle(string key, JsonElement parameters)
    {
        if (_registryToggles.TryGetValue(key, out var toggle))
        {
            return HandleRegistryToggleAction(key, parameters, toggle);
        }

        return _registryMaps.TryGetValue(key, out var map)
            ? HandleRegistryMapAction(key, parameters, map)
            : _openSettings.TryGetValue(key, out var settings) ? HandleOpenSettingsAction(settings) : HandleSpecialized(key, parameters);
    }

    /// <summary>
    /// Override to handle actions that don't fit registered patterns.
    /// Default implementation returns a failure result.
    /// </summary>
    protected virtual CommandResult HandleSpecialized(string key, JsonElement parameters)
    {
        return CommandResult.Fail($"Unknown command: {key}");
    }

    /// <summary>
    /// Handles a registry toggle action by reading a bool parameter and writing the
    /// corresponding on/off value to the registry.
    /// </summary>
    private CommandResult HandleRegistryToggleAction(string key, JsonElement parameters, RegistryToggleConfig config)
    {
        bool enable = parameters.GetBoolOrDefault(config.ParameterName, true);
        object value = enable ? config.OnValue : config.OffValue;

        if (config.UseLocalMachine)
        {
            Registry.SetValueLocalMachine(config.KeyPath, config.ValueName, value, config.ValueKind);
        }
        else
        {
            Registry.SetValue(config.KeyPath, config.ValueName, value, config.ValueKind);
        }

        string displayName = config.DisplayName ?? key;
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    /// <summary>
    /// Handles a registry map action by reading a string parameter, mapping it to a
    /// registry value via the configured value map, and writing the result.
    /// </summary>
    private CommandResult HandleRegistryMapAction(string key, JsonElement parameters, RegistryMapConfig config)
    {
        string paramValue = parameters.GetStringOrDefault(config.ParameterName, "");

        // Case-insensitive lookup to match original behavior (e.g., "Deny" == "deny").
        object regValue = config.DefaultValue;
        foreach (var kvp in config.ValueMap)
        {
            if (string.Equals(kvp.Key, paramValue, StringComparison.OrdinalIgnoreCase))
            {
                regValue = kvp.Value;
                break;
            }
        }

        Registry.SetValue(config.KeyPath, config.ValueName, regValue, config.ValueKind);

        string displayName = config.DisplayName ?? key;
        return CommandResult.Ok($"{displayName} set to {paramValue}");
    }

    /// <summary>
    /// Handles an open-settings action by launching the configured ms-settings: URI.
    /// </summary>
    private CommandResult HandleOpenSettingsAction(OpenSettingsConfig config)
    {
        _process!.StartShellExecute(config.SettingsUri);
        string displayName = config.DisplayName ?? config.SettingsUri;
        return CommandResult.Ok($"Opened {displayName}");
    }
}
