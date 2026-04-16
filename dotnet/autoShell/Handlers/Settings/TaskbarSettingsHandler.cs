// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Handlers.Generated;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles taskbar settings: auto-hide, clock seconds, multi-monitor, badges, task view,
/// alignment, and widgets visibility.
/// </summary>
internal class TaskbarSettingsHandler : SettingsHandlerBase
{
    private const string StuckRects3 = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3";
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

    /// <summary>
    /// Registers registered actions for clock seconds, multi-monitor taskbar, badges, task view,
    /// alignment, and widgets visibility. Auto-hide requires binary blob manipulation and is handled
    /// as a specialized action.
    /// </summary>
    public TaskbarSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {

        AddRegistryToggleAction("DisplaySecondsInSystrayClock", new RegistryToggleConfig(ExplorerAdvanced, "ShowSecondsInSystemClock", "enable", 1, 0, NotifyShell: true));
        AddRegistryToggleAction("DisplayTaskbarOnAllMonitors", new RegistryToggleConfig(ExplorerAdvanced, "MMTaskbarEnabled", "enable", 1, 0, NotifyShell: true));
        AddRegistryToggleAction("ShowBadgesOnTaskbar", new RegistryToggleConfig(ExplorerAdvanced, "TaskbarBadges", "enableBadging", 1, 0, NotifyShell: true));
        AddRegistryToggleAction("TaskViewVisibility", new RegistryToggleConfig(ExplorerAdvanced, "ShowTaskViewButton", "visibility", 1, 0, NotifyShell: true));
        AddRegistryMapAction("TaskbarAlignment", new RegistryMapConfig(ExplorerAdvanced, "TaskbarAl", "alignment",
            new Dictionary<string, object> { ["left"] = 0, ["center"] = 1 }, DefaultValue: 1, NotifyShell: true));
        AddRegistryMapAction("ToggleWidgetsButtonVisibility", new RegistryMapConfig(ExplorerAdvanced, "TaskbarDa", "visibility",
            new Dictionary<string, object> { ["show"] = 1 }, DefaultValue: 0, NotifyShell: true));
        AddAction<AutoHideTaskbarParams>("AutoHideTaskbar", HandleAutoHideTaskbar);
    }

    private ActionResult HandleAutoHideTaskbar(AutoHideTaskbarParams p)
    {
        bool hide = p.HideWhenNotUsing;

        // Auto-hide uses a binary blob in a different registry path
        if (Registry.GetValue(StuckRects3, "Settings", null) is byte[] settings && settings.Length >= 9)
        {
            // Bit 0 of byte 8 controls auto-hide
            if (hide)
            {
                settings[8] |= 0x01;
            }
            else
            {
                settings[8] &= 0xFE;
            }

            Registry.SetValue(StuckRects3, "Settings", settings, RegistryValueKind.Binary);
            Registry.SetTaskbarAutoHideState(hide);

            return ActionResult.Ok($"Taskbar auto-hide {(hide ? "enabled" : "disabled")}");
        }

        return ActionResult.Fail("StuckRects3 registry blob not found or invalid");
    }
}
