// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles display settings: brightness, color temperature, orientation, resolution, scaling,
/// blue light filter, and rotation lock.
/// </summary>
internal class DisplaySettingsHandler : SettingsHandlerBase
{
    private readonly IProcessService _process;
    private readonly IBrightnessService _brightness;
    private readonly ILogger _logger;

    /// <summary>
    /// Registers registered actions for color temperature, screen orientation, display resolution,
    /// and rotation lock. Brightness, scaling, and blue light filter require custom logic.
    /// </summary>
    public DisplaySettingsHandler(IRegistryService registry, IProcessService process, IBrightnessService brightness, ILogger logger)
        : base(registry, process)
    {
        _process = process;
        _brightness = brightness;
        _logger = logger;

        AddOpenSettingsAction("AdjustColorTemperature", new OpenSettingsConfig("ms-settings:nightlight", "night light settings"));
        AddOpenSettingsAction("AdjustScreenOrientation", new OpenSettingsConfig("ms-settings:display", "display settings"));
        AddOpenSettingsAction("DisplayResolutionAndAspectRatio", new OpenSettingsConfig("ms-settings:display", "display settings"));
        AddRegistryToggleAction("RotationLock", new RegistryToggleConfig(
            @"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell", "RotationLockPreference", "enable", 1, 0));
        AddAction<AdjustScreenBrightnessParams>("AdjustScreenBrightness", HandleAdjustScreenBrightness);
        AddAction<DisplayScalingParams>("DisplayScaling", HandleDisplayScaling);
        AddAction<EnableBlueLightFilterScheduleParams>("EnableBlueLightFilterSchedule", HandleBlueLightFilter);
    }

    private ActionResult HandleAdjustScreenBrightness(AdjustScreenBrightnessParams p)
    {
        string level = p.BrightnessLevel;
        bool increase = level == "increase";

        byte currentBrightness = _brightness.GetCurrentBrightness();
        byte newBrightness = increase
            ? (byte)Math.Min(100, currentBrightness + 10)
            : (byte)Math.Max(0, currentBrightness - 10);

        _brightness.SetBrightness(newBrightness);
        _logger.Debug($"Brightness adjusted to: {newBrightness}%");
        return ActionResult.Ok($"Brightness adjusted to {newBrightness}%");
    }

    private ActionResult HandleDisplayScaling(DisplayScalingParams p)
    {
        string sizeStr = p.SizeOverride;

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
            return ActionResult.Ok($"Display scaling set to {percentage}%");
        }

        return ActionResult.Fail("Invalid display scaling value");
    }

    private ActionResult HandleBlueLightFilter(EnableBlueLightFilterScheduleParams p)
    {
        bool disabled = p.NightLightScheduleDisabled;
        byte[] data = disabled
            ? [0x02, 0x00, 0x00, 0x00]
            : [0x02, 0x00, 0x00, 0x01];

        Registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings",
            "Data",
            data,
            RegistryValueKind.Binary);
        return ActionResult.Ok($"Night Light schedule {(disabled ? "disabled" : "enabled")}");
    }

}
