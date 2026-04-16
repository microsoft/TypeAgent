// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using autoShell.Handlers.Generated;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles taskbar settings: auto-hide, clock seconds, multi-monitor, badges, task view,
/// alignment, and widgets visibility.
/// </summary>
internal partial class TaskbarSettingsHandler : SettingsHandlerBase
{
    #region P/Invoke
    private const string StuckRects3 = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3";
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

    [LibraryImport(NativeDlls.User32, EntryPoint = "SendNotifyMessageW")]
    private static partial IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    #endregion P/Invoke

    /// <summary>
    /// Registers registered actions for clock seconds, multi-monitor taskbar, badges, task view,
    /// alignment, and widgets visibility. Auto-hide requires binary blob manipulation and is handled
    /// as a specialized action.
    /// </summary>
    public TaskbarSettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {

        AddRegistryToggleAction("DisplaySecondsInSystrayClock", new RegistryToggleConfig(ExplorerAdvanced, "ShowSecondsInSystemClock", "enable", 1, 0));
        AddRegistryToggleAction("DisplayTaskbarOnAllMonitors", new RegistryToggleConfig(ExplorerAdvanced, "MMTaskbarEnabled", "enable", 1, 0));
        AddRegistryToggleAction("ShowBadgesOnTaskbar", new RegistryToggleConfig(ExplorerAdvanced, "TaskbarBadges", "enableBadging", 1, 0));
        AddRegistryToggleAction("TaskViewVisibility", new RegistryToggleConfig(ExplorerAdvanced, "ShowTaskViewButton", "visibility", 1, 0));
        AddRegistryMapAction("TaskbarAlignment", new RegistryMapConfig(ExplorerAdvanced, "TaskbarAl", "alignment",
            new Dictionary<string, object> { ["left"] = 0, ["center"] = 1 }, DefaultValue: 1));
        AddRegistryMapAction("ToggleWidgetsButtonVisibility", new RegistryMapConfig(ExplorerAdvanced, "TaskbarDa", "visibility",
            new Dictionary<string, object> { ["show"] = 1 }, DefaultValue: 0));
        AddAction<AutoHideTaskbarParams>("AutoHideTaskbar", HandleAutoHideTaskbar);
    }

    /// <inheritdoc/>
    public override ActionResult Handle(string key, System.Text.Json.JsonElement parameters)
    {
        var result = base.Handle(key, parameters);
        NotifySettingsChange();
        return result;
    }

    private static void NotifySettingsChange()
    {
        try
        {
            SendNotifyMessage((IntPtr)0xffff, 0x001A, IntPtr.Zero, IntPtr.Zero);
        }
        catch (EntryPointNotFoundException)
        {
            // P/Invoke may not be available in all environments
        }
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
            return ActionResult.Ok($"Taskbar auto-hide {(hide ? "enabled" : "disabled")}");
        }

        return ActionResult.Fail("StuckRects3 registry blob not found or invalid");
    }
}
