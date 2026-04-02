// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles miscellaneous system settings: time/region, focus assist, gaming, and multi-monitor.
/// </summary>
internal class SystemSettingsHandler : ICommandHandler
{
    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public SystemSettingsHandler(IRegistryService registry, IProcessService process)
    {
        _registry = registry;
        _process = process;
    }

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

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
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

    private void HandleAutomaticDSTAdjustment(string jsonParams)
    {
        var param = JObject.Parse(jsonParams);
        bool enable = param.Value<bool?>("enable") ?? true;

        _registry.SetValueLocalMachine(
            @"SYSTEM\CurrentControlSet\Control\TimeZoneInformation",
            "DynamicDaylightTimeDisabled",
            enable ? 0 : 1,
            Microsoft.Win32.RegistryValueKind.DWord);

        Debug.WriteLine($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
    }
}
