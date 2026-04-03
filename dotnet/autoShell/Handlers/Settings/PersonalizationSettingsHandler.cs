// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles personalization settings: title bar color, transparency, high contrast, and theme mode.
/// </summary>
internal class PersonalizationSettingsHandler : ICommandHandler
{
    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public PersonalizationSettingsHandler(IRegistryService registry, IProcessService process)
    {
        _registry = registry;
        _process = process;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ApplyColorToTitleBar",
        "EnableTransparency",
        "HighContrastTheme",
        "SystemThemeMode",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        var param = JObject.Parse(value);

        switch (key)
        {
            case "ApplyColorToTitleBar":
                HandleApplyColorToTitleBar(param);
                break;

            case "EnableTransparency":
                HandleEnableTransparency(param);
                break;

            case "HighContrastTheme":
                _process.StartShellExecute("ms-settings:easeofaccess-highcontrast");
                break;

            case "SystemThemeMode":
                HandleSystemThemeMode(param);
                break;
        }
    }

    private void HandleApplyColorToTitleBar(JObject param)
    {
        bool enable = param.Value<bool?>("enableColor") ?? true;
        _registry.SetValue(
            @"Software\Microsoft\Windows\DWM",
            "ColorPrevalence",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
    }

    private void HandleEnableTransparency(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
    }

    private void HandleSystemThemeMode(JObject param)
    {
        string mode = param.Value<string>("mode") ?? "dark";
        int value = mode.Equals("light", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

        const string PersonalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        // Set apps theme (AppsUseLightTheme: 0 = dark, 1 = light)
        _registry.SetValue(PersonalizePath, "AppsUseLightTheme", value, RegistryValueKind.DWord);
        // Set system theme — taskbar, Start menu, etc.
        _registry.SetValue(PersonalizePath, "SystemUsesLightTheme", value, RegistryValueKind.DWord);
        _registry.BroadcastSettingChange("ImmersiveColorSet");
    }
}
