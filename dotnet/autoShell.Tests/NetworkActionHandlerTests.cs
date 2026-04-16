// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class NetworkActionHandlerTests
{
    private readonly Mock<INetworkService> _networkMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly NetworkActionHandler _handler;

    public NetworkActionHandlerTests()
    {
        _handler = new NetworkActionHandler(_networkMock.Object, new Mock<IProcessService>().Object, _loggerMock.Object);
    }

    // --- ConnectWifi ---

    /// <summary>
    /// Verifies that ConnectWifi with an SSID and password calls the network service with both values.
    /// </summary>
    [Fact]
    public void ConnectWifi_WithSsidAndPassword_CallsService()
    {
        var json = JsonDocument.Parse("""{"ssid":"TestNetwork","password":"pass123"}""").RootElement;
        _handler.Handle("ConnectWifi", json);

        _networkMock.Verify(n => n.ConnectToWifi("TestNetwork", "pass123"), Times.Once);
    }

    /// <summary>
    /// Verifies that ConnectWifi without a password calls the service with an empty password string.
    /// </summary>
    [Fact]
    public void ConnectWifi_WithoutPassword_CallsServiceWithEmptyPassword()
    {
        var json = JsonDocument.Parse("""{"ssid":"OpenNetwork"}""").RootElement;
        _handler.Handle("ConnectWifi", json);

        _networkMock.Verify(n => n.ConnectToWifi("OpenNetwork", ""), Times.Once);
    }

    /// <summary>
    /// Verifies that ConnectWifi without an ssid returns a failure.
    /// The schema defines ssid as required, so the LLM always sends it.
    /// When missing, the typed parameter defaults to an empty string which is rejected.
    /// </summary>
    [Fact]
    public void ConnectWifi_WithoutSsid_ReturnsFailure()
    {
        var json = JsonDocument.Parse("""{"password":"pass123"}""").RootElement;
        var result = _handler.Handle("ConnectWifi", json);

        Assert.False(result.Success);
        _networkMock.Verify(n => n.ConnectToWifi(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    // --- DisconnectWifi ---

    /// <summary>
    /// Verifies that DisconnectWifi invokes the network service disconnect method.
    /// </summary>
    [Fact]
    public void DisconnectWifi_CallsService()
    {
        var json = JsonDocument.Parse("{}").RootElement;
        _handler.Handle("DisconnectWifi", json);

        _networkMock.Verify(n => n.DisconnectFromWifi(), Times.Once);
    }

    // --- ListWifiNetworks ---

    /// <summary>
    /// Verifies that ListWifiNetworks calls the network service and retrieves the result.
    /// </summary>
    [Fact]
    public void ListWifiNetworks_CallsServiceAndWritesResult()
    {
        _networkMock.Setup(n => n.ListWifiNetworks()).Returns("[]");

        var json = JsonDocument.Parse("{}").RootElement;
        _handler.Handle("ListWifiNetworks", json);

        _networkMock.Verify(n => n.ListWifiNetworks(), Times.Once);
    }

    // --- ToggleAirplaneMode ---

    /// <summary>
    /// Verifies that valid boolean values are forwarded to <see cref="INetworkService.SetAirplaneMode"/>.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ToggleAirplaneMode_ValidBool_CallsService(bool expected)
    {
        var json = JsonDocument.Parse($$"""{"enable":{{expected.ToString().ToLowerInvariant()}}}""").RootElement;
        _handler.Handle("ToggleAirplaneMode", json);

        _networkMock.Verify(n => n.SetAirplaneMode(expected), Times.Once);
    }

    // --- BluetoothToggle ---

    /// <summary>
    /// Verifies that BluetoothToggle calls <see cref="INetworkService.ToggleBluetooth"/> with the parsed enable value.
    /// </summary>
    [Fact]
    public void BluetoothToggle_Enable_CallsToggleBluetooth()
    {
        var json = JsonDocument.Parse("""{"enableBluetooth":true}""").RootElement;
        _handler.Handle("BluetoothToggle", json);

        _networkMock.Verify(n => n.ToggleBluetooth(true), Times.Once);
    }

    /// <summary>
    /// Verifies that BluetoothToggle defaults to true when the parameter is missing.
    /// </summary>
    [Fact]
    public void BluetoothToggle_DefaultsToTrue()
    {
        var json = JsonDocument.Parse("{}").RootElement;
        _handler.Handle("BluetoothToggle", json);

        _networkMock.Verify(n => n.ToggleBluetooth(true), Times.Once);
    }

    // --- EnableWifi ---

    /// <summary>
    /// Verifies that EnableWifi calls the network service with the parsed enable value.
    /// </summary>
    [Fact]
    public void EnableWifi_Enable_CallsService()
    {
        var json = JsonDocument.Parse("""{"enable":true}""").RootElement;
        _handler.Handle("EnableWifi", json);

        _networkMock.Verify(n => n.EnableWifi(true), Times.Once);
    }

    /// <summary>
    /// Verifies that EnableWifi with enable=false disables wifi.
    /// </summary>
    [Fact]
    public void EnableWifi_Disable_CallsService()
    {
        var json = JsonDocument.Parse("""{"enable":false}""").RootElement;
        _handler.Handle("EnableWifi", json);

        _networkMock.Verify(n => n.EnableWifi(false), Times.Once);
    }
}
