// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles network commands: BluetoothToggle, ConnectWifi, DisconnectWifi,
/// EnableMeteredConnections, EnableWifi, ListWifiNetworks, and ToggleAirplaneMode.
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
    public CommandResult Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "BluetoothToggle":
                bool enableBt = parameters.Value<bool?>("enableBluetooth") ?? true;
                _network.ToggleBluetooth(enableBt);
                return CommandResult.Ok($"Bluetooth {(enableBt ? "enabled" : "disabled")}");

            case "EnableMeteredConnections":
                _process.StartShellExecute("ms-settings:network-status");
                return CommandResult.Ok("Opened metered connections settings");

            case "EnableWifi":
                bool enableWifi = parameters.Value<bool?>("enable") ?? true;
                _network.EnableWifi(enableWifi);
                return CommandResult.Ok($"WiFi {(enableWifi ? "enabled" : "disabled")}");

            case "ConnectWifi":
                string ssid = parameters.Value<string>("ssid");
                string password = parameters["password"] is not null ? parameters.Value<string>("password") : "";
                _network.ConnectToWifi(ssid, password);
                return CommandResult.Ok($"Connecting to WiFi network '{ssid}'");

            case "DisconnectWifi":
                _network.DisconnectFromWifi();
                return CommandResult.Ok("Disconnected from WiFi");

            case "ListWifiNetworks":
                string networks = _network.ListWifiNetworks();
                return CommandResult.Ok("Listed WiFi networks", JToken.Parse(networks));

            case "ToggleAirplaneMode":
            {
                bool airplaneMode = parameters.Value<bool?>("enable") ?? false;
                _network.SetAirplaneMode(airplaneMode);
                return CommandResult.Ok($"Airplane mode {(airplaneMode ? "enabled" : "disabled")}");
            }

            default:
                return CommandResult.Fail($"Unknown network command: {key}");
        }
    }
}
