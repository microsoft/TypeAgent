// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Logging;
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
    private readonly ILogger _logger;

    public SystemSettingsHandler(IRegistryService registry, IProcessService process, ILogger logger)
    {
        _registry = registry;
        _process = process;
        _logger = logger;
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
                _process.StartShellExecute("ms-settings:dateandtime");
                break;

            case "EnableGameMode":
                _process.StartShellExecute("ms-settings:gaming-gamemode");
                break;

            case "EnableQuietHours":
                _process.StartShellExecute("ms-settings:quiethours");
                break;

            case "MinimizeWindowsOnMonitorDisconnectAction":
            case "RememberWindowLocations":
                _process.StartShellExecute("ms-settings:display");
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

        _logger.Debug($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
    }
}
