// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts WiFi and airplane-mode operations for testability.
/// </summary>
internal interface INetworkService
{
    /// <summary>
    /// Connects to a WiFi network by SSID and optional password.
    /// </summary>
    void ConnectToWifi(string ssid, string password);

    /// <summary>
    /// Disconnects from the currently connected WiFi network.
    /// </summary>
    void DisconnectFromWifi();

    /// <summary>
    /// Enables or disables the Wi-Fi network interface.
    /// </summary>
    void EnableWifi(bool enable);

    /// <summary>
    /// Lists available WiFi networks as a JSON string.
    /// </summary>
    string ListWifiNetworks();

    /// <summary>
    /// Sets the airplane mode state.
    /// </summary>
    void SetAirplaneMode(bool enable);

    /// <summary>
    /// Toggles Bluetooth radio on or off.
    /// </summary>
    void ToggleBluetooth(bool enable);
}
