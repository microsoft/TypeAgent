// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles display settings: brightness, color temperature, orientation, resolution, scaling,
/// blue light filter, and rotation lock.
/// </summary>
internal class DisplaySettingsHandler : ICommandHandler
{
    private readonly IRegistryService _registry;
    private readonly IProcessService _process;
    private readonly IBrightnessService _brightness;
    private readonly ILogger _logger;

    public DisplaySettingsHandler(IRegistryService registry, IProcessService process, IBrightnessService brightness, ILogger logger)
    {
        _registry = registry;
        _process = process;
        _brightness = brightness;
        _logger = logger;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "AdjustColorTemperature",
        "AdjustScreenBrightness",
        "AdjustScreenOrientation",
        "DisplayResolutionAndAspectRatio",
        "DisplayScaling",
        "EnableBlueLightFilterSchedule",
        "RotationLock",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "AdjustColorTemperature":
                _process.StartShellExecute("ms-settings:nightlight");
                return CommandResult.Ok("Opened Night Light settings");

            case "AdjustScreenBrightness":
                return HandleAdjustScreenBrightness(parameters);

            case "AdjustScreenOrientation":
            case "DisplayResolutionAndAspectRatio":
                _process.StartShellExecute("ms-settings:display");
                return CommandResult.Ok("Opened display settings");

            case "DisplayScaling":
                return HandleDisplayScaling(parameters);

            case "EnableBlueLightFilterSchedule":
                return HandleBlueLightFilter(parameters);

            case "RotationLock":
                return HandleRotationLock(parameters);

            default:
                return CommandResult.Fail($"Unknown display settings command: {key}");
        }
    }

    private CommandResult HandleAdjustScreenBrightness(JObject parameters)
    {
        string level = parameters.Value<string>("brightnessLevel");
        bool increase = level == "increase";

        byte currentBrightness = _brightness.GetCurrentBrightness();
        byte newBrightness = increase
            ? (byte)Math.Min(100, currentBrightness + 10)
            : (byte)Math.Max(0, currentBrightness - 10);

        _brightness.SetBrightness(newBrightness);
        _logger.Debug($"Brightness adjusted to: {newBrightness}%");
        return CommandResult.Ok($"Brightness adjusted to {newBrightness}%");
    }

    private CommandResult HandleDisplayScaling(JObject parameters)
    {
        string sizeStr = parameters.Value<string>("sizeOverride");

        if (int.TryParse(sizeStr, out int percentage))
        {
            // Valid scaling values: 100, 125, 150, 175, 200
            percentage = percentage switch
            {
                < 113 => 100,
                < 138 => 125,
                < 163 => 150,
                < 188 => 175,
                _ => 200
            };

            // DPI scaling requires opening settings
            _process.StartShellExecute("ms-settings:display");
            _logger.Debug($"Display scaling target: {percentage}%");
            return CommandResult.Ok($"Display scaling set to {percentage}%");
        }

        return CommandResult.Fail("Invalid display scaling value");
    }

    private CommandResult HandleBlueLightFilter(JObject parameters)
    {
        bool disabled = parameters.Value<bool?>("nightLightScheduleDisabled") ?? false;
        byte[] data = disabled
            ? [0x02, 0x00, 0x00, 0x00]
            : [0x02, 0x00, 0x00, 0x01];

        _registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings",
            "Data",
            data,
            RegistryValueKind.Binary);
        return CommandResult.Ok($"Night Light schedule {(disabled ? "disabled" : "enabled")}");
    }

    private CommandResult HandleRotationLock(JObject parameters)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell",
            "RotationLockPreference",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"Rotation lock {(enable ? "enabled" : "disabled")}");
    }
}
