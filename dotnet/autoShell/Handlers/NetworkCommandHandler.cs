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
    private readonly ILogger _logger;

    public NetworkCommandHandler(INetworkService network, ILogger logger)
    {
        _network = network;
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
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "BluetoothToggle":
            case "EnableMeteredConnections":
            case "EnableWifi":
                // Not yet implemented — requires additional infrastructure
                _logger.Debug($"Command not yet implemented: {key}");
                break;

            case "ConnectWifi":
                var netInfo = JObject.Parse(value);
                string ssid = netInfo.Value<string>("ssid");
                string password = netInfo["password"] is not null ? netInfo.Value<string>("password") : "";
                _network.ConnectToWifi(ssid, password);
                break;

            case "DisconnectWifi":
                _network.DisconnectFromWifi();
                break;

            case "ListWifiNetworks":
                Console.WriteLine(_network.ListWifiNetworks());
                break;

            case "ToggleAirplaneMode":
                _network.SetAirplaneMode(bool.Parse(value));
                break;
        }
    }
}
