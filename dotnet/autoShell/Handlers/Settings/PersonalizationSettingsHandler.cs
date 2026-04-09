// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;
using autoShell.Services;
using Microsoft.Win32;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "ApplyColorToTitleBar":
                return HandleApplyColorToTitleBar(parameters);

            case "EnableTransparency":
                return HandleEnableTransparency(parameters);

            case "HighContrastTheme":
                _process.StartShellExecute("ms-settings:easeofaccess-highcontrast");
                return CommandResult.Ok("Opened high contrast settings");

            case "SystemThemeMode":
                return HandleSystemThemeMode(parameters);

            default:
                return CommandResult.Fail($"Unknown personalization command: {key}");
        }
    }

    private CommandResult HandleApplyColorToTitleBar(JsonElement parameters)
    {
        bool enable = parameters.GetBoolOrDefault("enableColor", true);
        _registry.SetValue(
            @"Software\Microsoft\Windows\DWM",
            "ColorPrevalence",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"Title bar color {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleEnableTransparency(JsonElement parameters)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        _registry.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"Transparency {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleSystemThemeMode(JsonElement parameters)
    {
        string mode = parameters.GetStringOrDefault("mode", "dark");
        int value = mode.Equals("light", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

        const string PersonalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        // Set apps theme (AppsUseLightTheme: 0 = dark, 1 = light)
        _registry.SetValue(PersonalizePath, "AppsUseLightTheme", value, RegistryValueKind.DWord);
        // Set system theme — taskbar, Start menu, etc.
        _registry.SetValue(PersonalizePath, "SystemUsesLightTheme", value, RegistryValueKind.DWord);
        _registry.BroadcastSettingChange("ImmersiveColorSet");
        return CommandResult.Ok($"System theme set to {mode}");
    }
}
