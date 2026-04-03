// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class NetworkCommandHandlerTests
{
    private readonly Mock<INetworkService> _networkMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly NetworkCommandHandler _handler;

    public NetworkCommandHandlerTests()
    {
        _handler = new NetworkCommandHandler(_networkMock.Object, _loggerMock.Object);
    }

    // --- ConnectWifi ---

    /// <summary>
    /// Verifies that ConnectWifi with an SSID and password calls the network service with both values.
    /// </summary>
    [Fact]
    public void ConnectWifi_WithSsidAndPassword_CallsService()
    {
        var json = JToken.Parse("""{"ssid":"TestNetwork","password":"pass123"}""");
        _handler.Handle("ConnectWifi", json.ToString(), json);

        _networkMock.Verify(n => n.ConnectToWifi("TestNetwork", "pass123"), Times.Once);
    }

    /// <summary>
    /// Verifies that ConnectWifi without a password calls the service with an empty password string.
    /// </summary>
    [Fact]
    public void ConnectWifi_WithoutPassword_CallsServiceWithEmptyPassword()
    {
        var json = JToken.Parse("""{"ssid":"OpenNetwork"}""");
        _handler.Handle("ConnectWifi", json.ToString(), json);

        _networkMock.Verify(n => n.ConnectToWifi("OpenNetwork", ""), Times.Once);
    }

    // --- DisconnectWifi ---

    /// <summary>
    /// Verifies that DisconnectWifi invokes the network service disconnect method.
    /// </summary>
    [Fact]
    public void DisconnectWifi_CallsService()
    {
        var json = JToken.Parse("{}");
        _handler.Handle("DisconnectWifi", json.ToString(), json);

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

        var json = JToken.Parse("{}");
        _handler.Handle("ListWifiNetworks", json.ToString(), json);

        _networkMock.Verify(n => n.ListWifiNetworks(), Times.Once);
    }

    // --- ToggleAirplaneMode ---

    /// <summary>
    /// Verifies that valid boolean values are forwarded to SetAirplaneMode.
    /// </summary>
    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void ToggleAirplaneMode_ValidBool_CallsService(string input, bool expected)
    {
        var json = JToken.Parse(input);
        _handler.Handle("ToggleAirplaneMode", input, json);

        _networkMock.Verify(n => n.SetAirplaneMode(expected), Times.Once);
    }

    // --- BluetoothToggle ---

    /// <summary>
    /// Verifies that the unimplemented BluetoothToggle command does not call any service methods.
    /// </summary>
    [Fact]
    public void BluetoothToggle_NotImplemented_DoesNotCallService()
    {
        _handler.Handle("BluetoothToggle", "true", JToken.FromObject("true"));

        _networkMock.VerifyNoOtherCalls();
    }

    // --- EnableWifi ---

    /// <summary>
    /// Verifies that the unimplemented EnableWifi command does not call any service methods.
    /// </summary>
    [Fact]
    public void EnableWifi_NotImplemented_DoesNotCallService()
    {
        _handler.Handle("EnableWifi", "true", JToken.FromObject("true"));

        _networkMock.VerifyNoOtherCalls();
    }

    // --- EnableMeteredConnections ---

    /// <summary>
    /// Verifies that the unimplemented EnableMeteredConnections command does not call any service methods.
    /// </summary>
    [Fact]
    public void EnableMeteredConnections_NotImplemented_DoesNotCallService()
    {
        _handler.Handle("EnableMeteredConnections", "true", JToken.FromObject("true"));

        _networkMock.VerifyNoOtherCalls();
    }
}
