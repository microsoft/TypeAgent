// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles network commands: toggleAirplaneMode, listWifiNetworks, connectWifi, disconnectWifi,
/// bluetoothToggle, enableWifi, enableMeteredConnections.
/// </summary>
internal class NetworkCommandHandler : ICommandHandler
{
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
            case "ToggleAirplaneMode":
                AutoShell.SetAirplaneMode(bool.Parse(value));
                break;

            case "ListWifiNetworks":
                AutoShell.ListWifiNetworks();
                break;

            case "ConnectWifi":
                var netInfo = JObject.Parse(value);
                string ssid = netInfo.Value<string>("ssid");
                string password = netInfo["password"] is not null ? netInfo.Value<string>("password") : "";
                AutoShell.ConnectToWifi(ssid, password);
                break;

            case "DisconnectWifi":
                AutoShell.DisconnectFromWifi();
                break;

            case "BluetoothToggle":
            case "EnableWifi":
            case "EnableMeteredConnections":
                // Not yet implemented — requires additional infrastructure
                Debug.WriteLine($"Command not yet implemented: {key}");
                break;
        }
    }
}
