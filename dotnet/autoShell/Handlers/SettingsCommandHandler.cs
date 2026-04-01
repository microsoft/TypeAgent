// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles all Windows Settings actions (50+ registry/SystemParametersInfo-based toggles).
/// Groups: Network, Display, Personalization, Taskbar, Mouse, Touchpad, Privacy, Power,
/// Gaming, Accessibility, File Explorer, Time/Region, Focus Assist, Multi-Monitor.
/// </summary>
internal class SettingsCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        // Accessibility
        "EnableFilterKeysAction",
        "EnableMagnifier",
        "EnableNarratorAction",
        "EnableStickyKeys",
        "MonoAudioToggle",
        // Display
        "AdjustScreenBrightness",
        "AdjustScreenOrientation",
        "AdjustColorTemperature",
        "DisplayResolutionAndAspectRatio",
        "DisplayScaling",
        "EnableBlueLightFilterSchedule",
        "RotationLock",
        // File Explorer
        "ShowFileExtensions",
        "ShowHiddenAndSystemFiles",
        // Focus Assist
        "EnableQuietHours",
        // Gaming
        "EnableGameMode",
        // Mouse
        "AdjustMousePointerSize",
        "EnhancePointerPrecision",
        "MouseCursorSpeed",
        "MousePointerCustomization",
        "MouseWheelScrollLines",
        "SetPrimaryMouseButton",
        // Multi-Monitor
        "MinimizeWindowsOnMonitorDisconnectAction",
        "RememberWindowLocations",
        // Personalization
        "ApplyColorToTitleBar",
        "EnableTransparency",
        "HighContrastTheme",
        "SystemThemeMode",
        // Power
        "BatterySaverActivationLevel",
        "SetPowerModeOnBattery",
        "SetPowerModePluggedIn",
        // Privacy
        "ManageCameraAccess",
        "ManageLocationAccess",
        "ManageMicrophoneAccess",
        // Taskbar
        "AutoHideTaskbar",
        "DisplaySecondsInSystrayClock",
        "DisplayTaskbarOnAllMonitors",
        "ShowBadgesOnTaskbar",
        "TaskbarAlignment",
        "TaskViewVisibility",
        "ToggleWidgetsButtonVisibility",
        // Time & Region
        "AutomaticDSTAdjustment",
        "AutomaticTimeSettingAction",
        // Touchpad
        "EnableTouchPad",
        "TouchpadCursorSpeed",
    ];

    private readonly IRegistryService _registry;
    private readonly ISystemParametersService _systemParams;
    private readonly IProcessService _process;

    public SettingsCommandHandler(
        IRegistryService registry,
        ISystemParametersService systemParams,
        IProcessService process)
    {
        _registry = registry;
        _systemParams = systemParams;
        _process = process;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        // Delegate to the existing static handlers in AutoShell_Settings.cs
        // This preserves all existing behavior during Phase 1
        AutoShell.HandleSettingsCommand(key, value);
    }
}
