// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

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
    public void Handle(string key, string value, JToken rawValue)
    {
        var param = JObject.Parse(value);

        switch (key)
        {
            case "AutoHideTaskbar":
                HandleAutoHideTaskbar(param);
                break;
            case "DisplaySecondsInSystrayClock":
                SetToggle(param, "enable", "ShowSecondsInSystemClock");
                break;
            case "DisplayTaskbarOnAllMonitors":
                SetToggle(param, "enable", "MMTaskbarEnabled");
                break;
            case "ShowBadgesOnTaskbar":
                SetToggle(param, "enableBadging", "TaskbarBadges");
                break;
            case "TaskbarAlignment":
                HandleTaskbarAlignment(param);
                break;
            case "TaskViewVisibility":
                SetToggle(param, "visibility", "ShowTaskViewButton");
                break;
            case "ToggleWidgetsButtonVisibility":
                SetToggle(param, "visibility", "TaskbarDa", trueValue: "show");
                break;
        }

        NotifySettingsChange();
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

    private void HandleAutoHideTaskbar(JObject param)
    {
        bool hide = param.Value<bool>("hideWhenNotUsing");

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
    }

    private void HandleTaskbarAlignment(JObject param)
    {
        string alignment = param.Value<string>("alignment") ?? "center";
        // 0 = left, 1 = center
        bool useCenter = alignment.Equals("center", StringComparison.OrdinalIgnoreCase);
        _registry.SetValue(ExplorerAdvanced, "TaskbarAl", useCenter ? 1 : 0, RegistryValueKind.DWord);
    }

    /// <summary>
    /// Sets a DWord toggle in Explorer\Advanced.
    /// For bool JSON values, true=1 false=0.
    /// For string JSON values, compares against <paramref name="trueValue"/>.
    /// </summary>
    private void SetToggle(JObject param, string jsonProperty, string registryValue, string trueValue = null)
    {
        int regValue;
        if (trueValue != null)
        {
            string val = param.Value<string>(jsonProperty) ?? "";
            regValue = val.Equals(trueValue, StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        }
        else
        {
            regValue = (param.Value<bool?>(jsonProperty) ?? true) ? 1 : 0;
        }

        _registry.SetValue(ExplorerAdvanced, registryValue, regValue, RegistryValueKind.DWord);
    }
}
