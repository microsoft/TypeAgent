// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers.Generated;
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
        AddAction<BluetoothToggleParams>("BluetoothToggle", HandleBluetoothToggle);
        AddAction<ConnectWifiParams>("ConnectWifi", HandleConnectWifi);
        AddAction<DisconnectWifiParams>("DisconnectWifi", HandleDisconnectWifi);
        AddAction<EnableMeteredConnectionsParams>("EnableMeteredConnections", HandleEnableMeteredConnections);
        AddAction<EnableWifiParams>("EnableWifi", HandleEnableWifi);
        AddAction("ListWifiNetworks", HandleListWifiNetworks);
        AddAction<ToggleAirplaneModeParams>("ToggleAirplaneMode", HandleToggleAirplaneMode);
    }

    private ActionResult HandleBluetoothToggle(BluetoothToggleParams p)
    {
        bool enableBt = p.EnableBluetooth ?? true;
        _network.ToggleBluetooth(enableBt);
        return ActionResult.Ok($"Bluetooth {(enableBt ? "enabled" : "disabled")}");
    }

    private ActionResult HandleConnectWifi(ConnectWifiParams p)
    {
        string ssid = p.Ssid;
        if (string.IsNullOrWhiteSpace(ssid))
        {
            return ActionResult.Fail("WiFi SSID is required");
        }
        string password = p.Password ?? "";
        _network.ConnectToWifi(ssid, password);
        return ActionResult.Ok($"Connecting to WiFi network '{ssid}'");
    }

    private ActionResult HandleDisconnectWifi(DisconnectWifiParams p)
    {
        _network.DisconnectFromWifi();
        return ActionResult.Ok("Disconnected from WiFi");
    }

    private ActionResult HandleEnableMeteredConnections(EnableMeteredConnectionsParams p)
    {
        _process.StartShellExecute("ms-settings:network-status");
        return ActionResult.Ok("Opened network status settings");
    }

    private ActionResult HandleEnableWifi(EnableWifiParams p)
    {
        bool enableWifi = p.Enable;
        _network.EnableWifi(enableWifi);
        return ActionResult.Ok($"WiFi {(enableWifi ? "enabled" : "disabled")}");
    }

    private ActionResult HandleListWifiNetworks(JsonElement parameters)
    {
        string networks = _network.ListWifiNetworks();
        using var doc = JsonDocument.Parse(networks);
        return ActionResult.Ok("Listed WiFi networks", doc.RootElement.Clone());
    }

    private ActionResult HandleToggleAirplaneMode(ToggleAirplaneModeParams p)
    {
        bool airplaneMode = p.Enable;
        _network.SetAirplaneMode(airplaneMode);
        return ActionResult.Ok($"Airplane mode {(airplaneMode ? "enabled" : "disabled")}");
    }
}
