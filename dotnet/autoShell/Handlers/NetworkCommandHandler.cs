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
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "BluetoothToggle":
                var btParam = JObject.Parse(value);
                bool enableBt = btParam.Value<bool?>("enableBluetooth") ?? true;
                _network.ToggleBluetooth(enableBt);
                break;

            case "EnableMeteredConnections":
                _process.StartShellExecute("ms-settings:network-status");
                break;

            case "EnableWifi":
                var wifiParam = JObject.Parse(value);
                bool enableWifi = wifiParam.Value<bool?>("enable") ?? true;
                _network.EnableWifi(enableWifi);
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
                if (bool.TryParse(value, out bool airplaneMode))
                {
                    _network.SetAirplaneMode(airplaneMode);
                }
                else
                {
                    _logger.Warning($"ToggleAirplaneMode: invalid boolean value '{value}'");
                }
                break;
        }
    }
}
