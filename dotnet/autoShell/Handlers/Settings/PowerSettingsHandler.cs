// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles power settings: battery saver threshold and power mode (on battery / plugged in).
/// </summary>
internal class PowerSettingsHandler : ICommandHandler
{
    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public PowerSettingsHandler(IRegistryService registry, IProcessService process)
    {
        _registry = registry;
        _process = process;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "BatterySaverActivationLevel",
        "SetPowerModeOnBattery",
        "SetPowerModePluggedIn",
    ];

    /// <inheritdoc/>
    public void Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "BatterySaverActivationLevel":
                HandleBatterySaverThreshold(parameters);
                break;

            case "SetPowerModeOnBattery":
            case "SetPowerModePluggedIn":
                _process.StartShellExecute("ms-settings:powersleep");
                break;
        }
    }

    private void HandleBatterySaverThreshold(JObject parameters)
    {
        int threshold = parameters.Value<int?>("thresholdValue") ?? 20;
        threshold = Math.Clamp(threshold, 0, 100);
        _registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver",
            "ActivationThreshold",
            threshold,
            RegistryValueKind.DWord);
    }
}
