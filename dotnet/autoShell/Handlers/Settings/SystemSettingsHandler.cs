// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles miscellaneous system settings: time/region, focus assist, gaming, and multi-monitor.
/// </summary>
internal class SystemSettingsHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "AutomaticDSTAdjustment",
        "AutomaticTimeSettingAction",
        "EnableGameMode",
        "EnableQuietHours",
        "MinimizeWindowsOnMonitorDisconnectAction",
        "RememberWindowLocations",
    ];

    private readonly IProcessService _process;

    public SystemSettingsHandler(IProcessService process)
    {
        this._process = process;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        try
        {
            switch (key)
            {
                case "AutomaticDSTAdjustment":
                    HandleAutomaticDSTAdjustment(value);
                    break;

                case "AutomaticTimeSettingAction":
                    this._process.StartShellExecute("ms-settings:dateandtime");
                    break;

                case "EnableGameMode":
                    this._process.StartShellExecute("ms-settings:gaming-gamemode");
                    break;

                case "EnableQuietHours":
                    this._process.StartShellExecute("ms-settings:quiethours");
                    break;

                case "MinimizeWindowsOnMonitorDisconnectAction":
                case "RememberWindowLocations":
                    this._process.StartShellExecute("ms-settings:display");
                    break;
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    private static void HandleAutomaticDSTAdjustment(string jsonParams)
    {
        var param = JObject.Parse(jsonParams);
        bool enable = param.Value<bool?>("enable") ?? true;

        using var key = Registry.LocalMachine.CreateSubKey(@"SYSTEM\CurrentControlSet\Control\TimeZoneInformation");
        key?.SetValue("DynamicDaylightTimeDisabled", enable ? 0 : 1, RegistryValueKind.DWord);

        Debug.WriteLine($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
    }
}
