// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles personalization settings: title bar color, transparency, high contrast, and theme mode.
/// </summary>
internal class PersonalizationSettingsHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ApplyColorToTitleBar",
        "EnableTransparency",
        "HighContrastTheme",
        "SystemThemeMode",
    ];

    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public PersonalizationSettingsHandler(IRegistryService registry, IProcessService process)
    {
        _registry = registry;
        _process = process;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        try
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
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
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

        const string personalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registry.SetValue(personalizePath, "AppsUseLightTheme", value, RegistryValueKind.DWord);
        _registry.SetValue(personalizePath, "SystemUsesLightTheme", value, RegistryValueKind.DWord);
    }
}
