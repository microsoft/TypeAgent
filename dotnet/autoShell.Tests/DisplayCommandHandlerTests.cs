// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class DisplayCommandHandlerTests
{
    private readonly Mock<IDisplayService> _displayMock = new();
    private readonly DisplayCommandHandler _handler;

    public DisplayCommandHandlerTests()
    {
        _handler = new DisplayCommandHandler(_displayMock.Object);
    }

    [Fact]
    public void SupportedCommands_ContainsExpectedCommands()
    {
        var commands = _handler.SupportedCommands.ToList();
        Assert.Contains("ListResolutions", commands);
        Assert.Contains("SetScreenResolution", commands);
        Assert.Contains("SetTextSize", commands);
        Assert.Equal(3, commands.Count);
    }

    // --- ListResolutions ---

    [Fact]
    public void ListResolutions_CallsService()
    {
        _displayMock.Setup(d => d.ListResolutions()).Returns("[{\"Width\":1920}]");

        Handle("ListResolutions", "");

        _displayMock.Verify(d => d.ListResolutions(), Times.Once);
    }

    // --- SetScreenResolution ---

    [Fact]
    public void SetScreenResolution_StringFormat_CallsServiceWithParsedValues()
    {
        _displayMock.Setup(d => d.SetResolution(1920, 1080, null)).Returns("ok");

        Handle("SetScreenResolution", "1920x1080");

        _displayMock.Verify(d => d.SetResolution(1920, 1080, null), Times.Once);
    }

    [Fact]
    public void SetScreenResolution_WithRefreshRate_CallsServiceWithRefresh()
    {
        _displayMock.Setup(d => d.SetResolution(1920, 1080, (uint)60)).Returns("ok");

        Handle("SetScreenResolution", "1920x1080@60");

        _displayMock.Verify(d => d.SetResolution(1920, 1080, (uint)60), Times.Once);
    }

    [Fact]
    public void SetScreenResolution_ObjectFormat_CallsServiceWithValues()
    {
        _displayMock.Setup(d => d.SetResolution(2560, 1440, null)).Returns("ok");

        var rawValue = JObject.FromObject(new { width = 2560, height = 1440 });
        _handler.Handle("SetScreenResolution", "", rawValue);

        _displayMock.Verify(d => d.SetResolution(2560, 1440, null), Times.Once);
    }

    [Fact]
    public void SetScreenResolution_InvalidFormat_DoesNotCallService()
    {
        Handle("SetScreenResolution", "invalid");

        _displayMock.Verify(d => d.SetResolution(It.IsAny<uint>(), It.IsAny<uint>(), It.IsAny<uint?>()), Times.Never);
    }

    // --- SetTextSize ---

    [Fact]
    public void SetTextSize_ValidPercent_CallsService()
    {
        Handle("SetTextSize", "150");

        _displayMock.Verify(d => d.SetTextSize(150), Times.Once);
    }

    [Fact]
    public void SetTextSize_InvalidInput_DoesNotCallService()
    {
        Handle("SetTextSize", "abc");

        _displayMock.Verify(d => d.SetTextSize(It.IsAny<int>()), Times.Never);
    }

    // --- Unknown key ---

    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        Handle("UnknownDisplayCmd", "value");

        _displayMock.VerifyNoOtherCalls();
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
