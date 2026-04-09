// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles taskbar settings: auto-hide, alignment, task view, widgets, badges, multi-monitor, clock.
/// </summary>
internal partial class TaskbarSettingsHandler : ICommandHandler
{
    #region P/Invoke
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    private const string StuckRects3 = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3";

    [LibraryImport(NativeDlls.User32, EntryPoint = "SendNotifyMessageW")]
    private static partial IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    #endregion P/Invoke

    private readonly IRegistryService _registry;

    public TaskbarSettingsHandler(IRegistryService registry)
    {
        _registry = registry;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "AutoHideTaskbar",
        "DisplaySecondsInSystrayClock",
        "DisplayTaskbarOnAllMonitors",
        "ShowBadgesOnTaskbar",
        "TaskbarAlignment",
        "TaskViewVisibility",
        "ToggleWidgetsButtonVisibility",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JsonElement parameters)
    {
        CommandResult result = key switch
        {
            "AutoHideTaskbar" => HandleAutoHideTaskbar(parameters),
            "DisplaySecondsInSystrayClock" => SetToggle(parameters, "enable", "ShowSecondsInSystemClock", "Seconds in system clock"),
            "DisplayTaskbarOnAllMonitors" => SetToggle(parameters, "enable", "MMTaskbarEnabled", "Taskbar on all monitors"),
            "ShowBadgesOnTaskbar" => SetToggle(parameters, "enableBadging", "TaskbarBadges", "Taskbar badges"),
            "TaskbarAlignment" => HandleTaskbarAlignment(parameters),
            "TaskViewVisibility" => SetToggle(parameters, "visibility", "ShowTaskViewButton", "Task View button"),
            "ToggleWidgetsButtonVisibility" => SetToggle(parameters, "visibility", "TaskbarDa", "Widgets button", trueValue: "show"),
            _ => CommandResult.Fail($"Unknown taskbar command: {key}"),
        };

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

    private CommandResult HandleAutoHideTaskbar(JsonElement parameters)
    {
        bool hide = parameters.GetBoolOrDefault("hideWhenNotUsing");

        // Auto-hide uses a binary blob in a different registry path
        if (_registry.GetValue(StuckRects3, "Settings", null) is byte[] settings && settings.Length >= 9)
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

            _registry.SetValue(StuckRects3, "Settings", settings, RegistryValueKind.Binary);
        }

        return CommandResult.Ok($"Taskbar auto-hide {(hide ? "enabled" : "disabled")}");
    }

    private CommandResult HandleTaskbarAlignment(JsonElement parameters)
    {
        string alignment = parameters.GetStringOrDefault("alignment", "center");
        // 0 = left, 1 = center
        bool useCenter = alignment.Equals("center", StringComparison.OrdinalIgnoreCase);
        _registry.SetValue(ExplorerAdvanced, "TaskbarAl", useCenter ? 1 : 0, RegistryValueKind.DWord);
        return CommandResult.Ok($"Taskbar aligned to {alignment}");
    }

    /// <summary>
    /// Sets a DWord toggle in Explorer\Advanced.
    /// For bool JSON values, true=1 false=0.
    /// For string JSON values, compares against <paramref name="trueValue"/>.
    /// </summary>
    private CommandResult SetToggle(JsonElement parameters, string jsonProperty, string registryValue, string settingName, string trueValue = null)
    {
        int regValue;
        if (trueValue != null)
        {
            string val = parameters.GetStringOrDefault(jsonProperty, "");
            regValue = val.Equals(trueValue, StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        }
        else
        {
            regValue = parameters.GetBoolOrDefault(jsonProperty, true) ? 1 : 0;
        }

        _registry.SetValue(ExplorerAdvanced, registryValue, regValue, RegistryValueKind.DWord);
        return CommandResult.Ok($"{settingName} {(regValue == 1 ? "enabled" : "disabled")}");
    }
}
