// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
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

    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public DisplaySettingsHandler(IRegistryService registry, IProcessService process)
    {
        this._registry = registry;
        this._process = process;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        try
        {
            var param = JObject.Parse(value);

            switch (key)
            {
                case "AdjustScreenBrightness":
                    this.HandleAdjustScreenBrightness(param);
                    break;

                case "DisplayScaling":
                    this.HandleDisplayScaling(param);
                    break;

                case "AdjustColorTemperature":
                    this._process.StartShellExecute("ms-settings:nightlight");
                    break;

                case "AdjustScreenOrientation":
                case "DisplayResolutionAndAspectRatio":
                    this._process.StartShellExecute("ms-settings:display");
                    break;

                case "EnableBlueLightFilterSchedule":
                    this.HandleBlueLightFilter(param);
                    break;

                case "RotationLock":
                    this.HandleRotationLock(param);
                    break;
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    private void HandleAdjustScreenBrightness(JObject param)
    {
        string level = param.Value<string>("brightnessLevel");
        bool increase = level == "increase";

        byte currentBrightness = GetCurrentBrightness();
        byte newBrightness = increase
            ? (byte)Math.Min(100, currentBrightness + 10)
            : (byte)Math.Max(0, currentBrightness - 10);

        SetBrightness(newBrightness);
        Debug.WriteLine($"Brightness adjusted to: {newBrightness}%");
    }

    private void HandleDisplayScaling(JObject param)
    {
        string sizeStr = param.Value<string>("sizeOverride");

        if (int.TryParse(sizeStr, out int percentage))
        {
            percentage = percentage switch
            {
                < 113 => 100,
                < 138 => 125,
                < 163 => 150,
                < 188 => 175,
                _ => 200
            };

            // DPI scaling requires opening settings
            this._process.StartShellExecute("ms-settings:display");
            Debug.WriteLine($"Display scaling target: {percentage}%");
        }
    }

    private static byte GetCurrentBrightness()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\SettingSync\Settings\SystemSettings\Brightness");
            if (key != null)
            {
                object value = key.GetValue("Data");
                if (value is byte[] data && data.Length > 0)
                {
                    return data[0];
                }
            }
        }
        catch { }
        return 50;
    }

    private static void SetBrightness(byte brightness)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                "root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
            using var objectCollection = searcher.Get();
            foreach (System.Management.ManagementObject obj in objectCollection.Cast<System.Management.ManagementObject>())
            {
                obj.InvokeMethod("WmiSetBrightness", [1, brightness]);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to set brightness: {ex.Message}");
        }
    }

    private void HandleBlueLightFilter(JObject param)
    {
        bool disabled = param.Value<bool?>("nightLightScheduleDisabled") ?? false;
        byte[] data = disabled
            ? [0x02, 0x00, 0x00, 0x00]
            : [0x02, 0x00, 0x00, 0x01];

        this._registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings",
            "Data",
            data,
            RegistryValueKind.Binary);
    }

    private void HandleRotationLock(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        this._registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell",
            "RotationLockPreference",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
    }
}
