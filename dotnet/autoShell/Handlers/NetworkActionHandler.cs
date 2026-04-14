// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles network commands: BluetoothToggle, ConnectWifi, DisconnectWifi,
/// EnableWifi, ListWifiNetworks, ToggleAirplaneMode, and EnableMeteredConnections.
/// </summary>
internal class NetworkActionHandler : ActionHandlerBase
{
    private readonly INetworkService _network;
    private readonly IProcessService _process;
    private readonly ILogger _logger;

    public NetworkActionHandler(INetworkService network, IProcessService process, ILogger logger)
    {
        _network = network;
        _process = process;
        _logger = logger;
        AddAction("BluetoothToggle", HandleBluetoothToggle);
        AddAction("ConnectWifi", HandleConnectWifi);
        AddAction("DisconnectWifi", HandleDisconnectWifi);
        AddAction("EnableMeteredConnections", HandleEnableMeteredConnections);
        AddAction("EnableWifi", HandleEnableWifi);
        AddAction("ListWifiNetworks", HandleListWifiNetworks);
        AddAction("ToggleAirplaneMode", HandleToggleAirplaneMode);
    }

    private ActionResult HandleBluetoothToggle(JsonElement parameters)
    {
        bool enableBt = parameters.GetBoolOrDefault("enableBluetooth", true);
        _network.ToggleBluetooth(enableBt);
        return ActionResult.Ok($"Bluetooth {(enableBt ? "enabled" : "disabled")}");
    }

    private ActionResult HandleConnectWifi(JsonElement parameters)
    {
        string ssid = parameters.GetStringOrDefault("ssid");
        string password = parameters.GetStringOrDefault("password", "");
        _network.ConnectToWifi(ssid, password);
        return ActionResult.Ok($"Connecting to WiFi network '{ssid}'");
    }

    private ActionResult HandleDisconnectWifi(JsonElement parameters)
    {
        _network.DisconnectFromWifi();
        return ActionResult.Ok("Disconnected from WiFi");
    }

    private ActionResult HandleEnableMeteredConnections(JsonElement parameters)
    {
        _process.StartShellExecute("ms-settings:network-status");
        return ActionResult.Ok("Opened network status settings");
    }

    private ActionResult HandleEnableWifi(JsonElement parameters)
    {
        bool enableWifi = parameters.GetBoolOrDefault("enable", true);
        _network.EnableWifi(enableWifi);
        return ActionResult.Ok($"WiFi {(enableWifi ? "enabled" : "disabled")}");
    }

    private ActionResult HandleListWifiNetworks(JsonElement parameters)
    {
        string networks = _network.ListWifiNetworks();
        return ActionResult.Ok("Listed WiFi networks", JsonDocument.Parse(networks).RootElement.Clone());
    }

    private ActionResult HandleToggleAirplaneMode(JsonElement parameters)
    {
        bool airplaneMode = parameters.GetBoolOrDefault("enable");
        _network.SetAirplaneMode(airplaneMode);
        return ActionResult.Ok($"Airplane mode {(airplaneMode ? "enabled" : "disabled")}");
    }
}
