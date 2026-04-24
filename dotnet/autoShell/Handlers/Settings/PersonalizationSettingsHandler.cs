// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using autoShell.Handlers.Generated;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles personalization settings: theme mode, title bar color, transparency, and high contrast.
/// </summary>
internal class PersonalizationSettingsHandler : SettingsHandlerBase
{
    /// <summary>
    /// Registers registered actions for title bar color, transparency, and high contrast.
    /// System theme mode requires dual registry writes plus a broadcast and is handled as a specialized action.
    /// </summary>
    public PersonalizationSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {

        AddRegistryToggleAction("ApplyColorToTitleBar", new RegistryToggleConfig(
            @"Software\Microsoft\Windows\DWM", "ColorPrevalence", "enableColor", 1, 0,
            BroadcastSetting: "ImmersiveColorSet"));
        AddRegistryToggleAction("EnableTransparency", new RegistryToggleConfig(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", "enable", 1, 0,
            BroadcastSetting: "ImmersiveColorSet"));
        AddOpenSettingsAction("HighContrastTheme", new OpenSettingsConfig(
            "ms-settings:easeofaccess-highcontrast", "high contrast settings"));
        AddAction<SystemThemeModeParams>("SystemThemeMode", HandleSystemThemeMode);
    }

    private ActionResult HandleSystemThemeMode(SystemThemeModeParams p)
    {
        string mode = p.Mode;
        if (string.IsNullOrEmpty(mode))
        {
            mode = "dark";
        }

        int value = mode.Equals("light", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

        const string PersonalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        // Set apps theme (AppsUseLightTheme: 0 = dark, 1 = light)
        Registry.SetValue(PersonalizePath, "AppsUseLightTheme", value, RegistryValueKind.DWord);
        // Set system theme — taskbar, Start menu, etc.
        Registry.SetValue(PersonalizePath, "SystemUsesLightTheme", value, RegistryValueKind.DWord);
        Registry.BroadcastSettingChange("ImmersiveColorSet");
        return ActionResult.Ok($"System theme set to {mode}");
    }
}
