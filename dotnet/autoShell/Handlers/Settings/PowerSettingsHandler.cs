// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles power settings: battery saver threshold, power mode on battery, and power mode plugged in.
/// </summary>
internal class PowerSettingsHandler : SettingsHandlerBase
{
    /// <summary>
    /// Registers registered open-settings actions for power mode on battery and plugged in.
    /// Battery saver threshold requires numeric clamping and is handled as a custom action.
    /// </summary>
    public PowerSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {

        AddOpenSettingsAction("SetPowerModeOnBattery", new OpenSettingsConfig("ms-settings:powersleep", "power settings"));
        AddOpenSettingsAction("SetPowerModePluggedIn", new OpenSettingsConfig("ms-settings:powersleep", "power settings"));
    }

    private static readonly string[] SpecializedActions = ["BatterySaverActivationLevel"];

    /// <inheritdoc/>
    public override IEnumerable<string> SupportedCommands =>
        SpecializedActions.Concat(RegisteredActions);

    /// <inheritdoc/>
    protected override CommandResult HandleSpecialized(string key, JsonElement parameters)
    {
        return key switch
        {
            "BatterySaverActivationLevel" => HandleBatterySaverThreshold(parameters),
            _ => base.HandleSpecialized(key, parameters),
        };
    }

    private CommandResult HandleBatterySaverThreshold(JsonElement parameters)
    {
        int threshold = parameters.GetNullableInt("thresholdValue") ?? 20;
        threshold = Math.Clamp(threshold, 0, 100);
        Registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver",
            "ActivationThreshold",
            threshold,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"Battery saver threshold set to {threshold}%");
    }
}
