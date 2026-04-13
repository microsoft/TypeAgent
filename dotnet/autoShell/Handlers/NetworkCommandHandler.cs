// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles network commands: BluetoothToggle, ConnectWifi, DisconnectWifi,
/// EnableWifi, ListWifiNetworks, ToggleAirplaneMode, and EnableMeteredConnections.
/// </summary>
internal class NetworkCommandHandler : ICommandHandler
{
    private readonly INetworkService _network;
    private readonly IProcessService _process;
    private readonly ILogger _logger;

    public NetworkCommandHandler(INetworkService network, IProcessService process, ILogger logger)
    {
        _network = network;
        _process = process;
        _logger = logger;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "BluetoothToggle",
        "ConnectWifi",
        "DisconnectWifi",
        "EnableMeteredConnections",
        "EnableWifi",
        "ListWifiNetworks",
        "ToggleAirplaneMode",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "BluetoothToggle":
                bool enableBt = parameters.GetBoolOrDefault("enableBluetooth", true);
                _network.ToggleBluetooth(enableBt);
                return CommandResult.Ok($"Bluetooth {(enableBt ? "enabled" : "disabled")}");

            case "ConnectWifi":
                string ssid = parameters.GetStringOrDefault("ssid");
                string password = parameters.GetStringOrDefault("password", "");
                _network.ConnectToWifi(ssid, password);
                return CommandResult.Ok($"Connecting to WiFi network '{ssid}'");

            case "DisconnectWifi":
                _network.DisconnectFromWifi();
                return CommandResult.Ok("Disconnected from WiFi");

            case "EnableMeteredConnections":
                _process.StartShellExecute("ms-settings:network-status");
                return CommandResult.Ok("Opened network status settings");

            case "EnableWifi":
                bool enableWifi = parameters.GetBoolOrDefault("enable", true);
                _network.EnableWifi(enableWifi);
                return CommandResult.Ok($"WiFi {(enableWifi ? "enabled" : "disabled")}");

            case "ListWifiNetworks":
                string networks = _network.ListWifiNetworks();
                return CommandResult.Ok("Listed WiFi networks", JsonDocument.Parse(networks).RootElement.Clone());

            case "ToggleAirplaneMode":
            {
                bool airplaneMode = parameters.GetBoolOrDefault("enable");
                _network.SetAirplaneMode(airplaneMode);
                return CommandResult.Ok($"Airplane mode {(airplaneMode ? "enabled" : "disabled")}");
            }

            default:
                return CommandResult.Fail($"Unknown network command: {key}");
        }
    }
}
