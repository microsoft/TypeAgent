// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Services;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles system settings: DST adjustment, time settings, game mode, quiet hours,
/// and display-related system options.
/// </summary>
internal class SystemSettingsHandler : SettingsHandlerBase
{
    /// <summary>
    /// Registers registered actions for all system settings: DST adjustment, time settings,
    /// game mode, quiet hours, and display-related system options. No custom logic needed.
    /// </summary>
    public SystemSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {
        AddRegistryToggleAction("AutomaticDSTAdjustment", new RegistryToggleConfig(
            @"SYSTEM\CurrentControlSet\Control\TimeZoneInformation", "DynamicDaylightTimeDisabled", "enable",
            OnValue: 0, OffValue: 1, UseLocalMachine: true));
        AddOpenSettingsAction("AutomaticTimeSettingAction", new OpenSettingsConfig("ms-settings:dateandtime", "date and time settings"));
        AddOpenSettingsAction("EnableGameMode", new OpenSettingsConfig("ms-settings:gaming-gamemode", "Game Mode settings"));
        AddOpenSettingsAction("EnableQuietHours", new OpenSettingsConfig("ms-settings:quiethours", "Focus Assist settings"));
        AddOpenSettingsAction("MinimizeWindowsOnMonitorDisconnectAction", new OpenSettingsConfig("ms-settings:display", "display settings"));
        AddOpenSettingsAction("RememberWindowLocations", new OpenSettingsConfig("ms-settings:display", "display settings"));
    }
}
