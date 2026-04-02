// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using autoShell.Services;
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

    [LibraryImport("user32.dll")]
    private static partial IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    #endregion P/Invoke

    private readonly IRegistryService _registry;

    public TaskbarSettingsHandler(IRegistryService registry)
    {
        this._registry = registry;
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
        try
        {
            var param = JObject.Parse(value);

            switch (key)
            {
                case "AutoHideTaskbar":
                    this.HandleAutoHideTaskbar(param);
                    break;
                case "DisplaySecondsInSystrayClock":
                    this.SetToggle(param, "enable", "ShowSecondsInSystemClock");
                    break;
                case "DisplayTaskbarOnAllMonitors":
                    this.SetToggle(param, "enable", "MMTaskbarEnabled");
                    break;
                case "ShowBadgesOnTaskbar":
                    this.SetToggle(param, "enableBadging", "TaskbarBadges");
                    break;
                case "TaskbarAlignment":
                    this.HandleTaskbarAlignment(param);
                    break;
                case "TaskViewVisibility":
                    this.SetToggle(param, "visibility", "ShowTaskViewButton");
                    break;
                case "ToggleWidgetsButtonVisibility":
                    this.SetToggle(param, "visibility", "TaskbarDa", trueValue: "show");
                    break;
            }

            SendNotifyMessage((IntPtr)0xffff, 0x001A, IntPtr.Zero, IntPtr.Zero);
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    private void HandleAutoHideTaskbar(JObject param)
    {
        bool hide = param.Value<bool>("hideWhenNotUsing");

        // Auto-hide uses a binary blob in a different registry path
        if (this._registry.GetValue(StuckRects3, "Settings", null) is byte[] settings && settings.Length >= 9)
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

            this._registry.SetValue(StuckRects3, "Settings", settings, RegistryValueKind.Binary);
        }
    }

    private void HandleTaskbarAlignment(JObject param)
    {
        string alignment = param.Value<string>("alignment") ?? "center";
        bool useCenter = alignment.Equals("center", StringComparison.OrdinalIgnoreCase);
        this._registry.SetValue(ExplorerAdvanced, "TaskbarAl", useCenter ? 1 : 0, RegistryValueKind.DWord);
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

        this._registry.SetValue(ExplorerAdvanced, registryValue, regValue, RegistryValueKind.DWord);
    }
}
