// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "AutomaticDSTAdjustment":
                return HandleAutomaticDSTAdjustment(parameters);

            case "AutomaticTimeSettingAction":
                _process.StartShellExecute("ms-settings:dateandtime");
                return CommandResult.Ok("Opened date and time settings");

            case "EnableGameMode":
                _process.StartShellExecute("ms-settings:gaming-gamemode");
                return CommandResult.Ok("Opened Game Mode settings");

            case "EnableQuietHours":
                _process.StartShellExecute("ms-settings:quiethours");
                return CommandResult.Ok("Opened Focus Assist settings");

            case "MinimizeWindowsOnMonitorDisconnectAction":
            case "RememberWindowLocations":
                _process.StartShellExecute("ms-settings:display");
                return CommandResult.Ok("Opened display settings");

            default:
                return CommandResult.Fail($"Unknown system settings command: {key}");
        }
    }

    private CommandResult HandleAutomaticDSTAdjustment(JsonElement parameters)
    {

        bool enable = parameters.GetBoolOrDefault("enable", true);

        _registry.SetValueLocalMachine(
            @"SYSTEM\CurrentControlSet\Control\TimeZoneInformation",
            "DynamicDaylightTimeDisabled",
            enable ? 0 : 1,
            Microsoft.Win32.RegistryValueKind.DWord);

        _logger.Debug($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
        return CommandResult.Ok($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
    }
}
