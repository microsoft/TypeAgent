// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using autoShell.Handlers.Generated;
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
    /// Battery saver threshold requires numeric clamping and is handled as a specialized action.
    /// </summary>
    public PowerSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {

        AddOpenSettingsAction("SetPowerModeOnBattery", new OpenSettingsConfig("ms-settings:powersleep", "power settings"));
        AddOpenSettingsAction("SetPowerModePluggedIn", new OpenSettingsConfig("ms-settings:powersleep", "power settings"));
        AddAction<BatterySaverActivationLevelParams>("BatterySaverActivationLevel", HandleBatterySaverThreshold);
    }

    private ActionResult HandleBatterySaverThreshold(BatterySaverActivationLevelParams p)
    {
        int threshold = p.ThresholdValue > 0 ? p.ThresholdValue : 20;
        threshold = Math.Clamp(threshold, 0, 100);
        Registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver",
            "ActivationThreshold",
            threshold,
            RegistryValueKind.DWord);
        return ActionResult.Ok($"Battery saver threshold set to {threshold}%");
    }
}
