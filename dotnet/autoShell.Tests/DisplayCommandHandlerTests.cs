// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class DisplayCommandHandlerTests
{
    private readonly Mock<IDisplayService> _displayMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly DisplayCommandHandler _handler;

    public DisplayCommandHandlerTests()
    {
        _handler = new DisplayCommandHandler(_displayMock.Object, _loggerMock.Object);
    }
    // --- ListResolutions ---

    /// <summary>
    /// Verifies that the ListResolutions command calls the display service to list available resolutions.
    /// </summary>
    [Fact]
    public void ListResolutions_CallsService()
    {
        _displayMock.Setup(d => d.ListResolutions()).Returns("[{\"Width\":1920}]");

        _handler.Handle("ListResolutions", new JObject());

        _displayMock.Verify(d => d.ListResolutions(), Times.Once);
    }

    // --- SetScreenResolution ---

    /// <summary>
    /// Verifies that a "WIDTHxHEIGHT" string is parsed and forwarded to the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_StringFormat_CallsServiceWithParsedValues()
    {
        _displayMock.Setup(d => d.SetResolution(1920, 1080, null)).Returns("ok");

        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 1920u, ["height"] = 1080u });

        _displayMock.Verify(d => d.SetResolution(1920, 1080, null), Times.Once);
    }

    /// <summary>
    /// Verifies that a "WIDTHxHEIGHT@RATE" string includes the refresh rate in the service call.
    /// </summary>
    [Fact]
    public void SetScreenResolution_WithRefreshRate_CallsServiceWithRefresh()
    {
        _displayMock.Setup(d => d.SetResolution(1920, 1080, (uint)60)).Returns("ok");

        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 1920u, ["height"] = 1080u, ["refreshRate"] = 60u });

        _displayMock.Verify(d => d.SetResolution(1920, 1080, (uint)60), Times.Once);
    }

    /// <summary>
    /// Verifies that a JSON object with width and height properties is forwarded to the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_ObjectFormat_CallsServiceWithValues()
    {
        _displayMock.Setup(d => d.SetResolution(2560, 1440, null)).Returns("ok");

        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 2560u, ["height"] = 1440u });

        _displayMock.Verify(d => d.SetResolution(2560, 1440, null), Times.Once);
    }

    /// <summary>
    /// Verifies that zero-valued dimensions do not invoke the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_ZeroDimensions_DoesNotCallService()
    {
        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 0u, ["height"] = 0u });

        _displayMock.Verify(d => d.SetResolution(It.IsAny<uint>(), It.IsAny<uint>(), It.IsAny<uint?>()), Times.Never);
    }

    /// <summary>
    /// Verifies that missing dimensions do not invoke the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_MissingDimensions_DoesNotCallService()
    {
        _handler.Handle("SetScreenResolution", new JObject());

        _displayMock.Verify(d => d.SetResolution(It.IsAny<uint>(), It.IsAny<uint>(), It.IsAny<uint?>()), Times.Never);
    }

    /// <summary>
    /// Verifies that providing only width (no height) does not invoke the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_WidthOnly_DoesNotCallService()
    {
        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 1920u });

        _displayMock.Verify(d => d.SetResolution(It.IsAny<uint>(), It.IsAny<uint>(), It.IsAny<uint?>()), Times.Never);
    }

    /// <summary>
    /// Verifies that providing only height (no width) does not invoke the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_HeightOnly_DoesNotCallService()
    {
        _handler.Handle("SetScreenResolution", new JObject { ["height"] = 1080u });

        _displayMock.Verify(d => d.SetResolution(It.IsAny<uint>(), It.IsAny<uint>(), It.IsAny<uint?>()), Times.Never);
    }

    // --- SetTextSize ---

    /// <summary>
    /// Verifies that a valid integer text size percentage is forwarded to the display service.
    /// </summary>
    [Fact]
    public void SetTextSize_ValidPercent_CallsService()
    {
        _handler.Handle("SetTextSize", new JObject { ["size"] = 150 });

        _displayMock.Verify(d => d.SetTextSize(150), Times.Once);
    }

    /// <summary>
    /// Verifies that non-numeric text size input does not invoke the display service.
    /// </summary>
    [Fact]
    public void SetTextSize_InvalidInput_DoesNotCallService()
    {
        _handler.Handle("SetTextSize", new JObject { ["size"] = "abc" });

        _displayMock.Verify(d => d.SetTextSize(It.IsAny<int>()), Times.Never);
    }

    // --- Unknown key ---

    /// <summary>
    /// Verifies that an unknown command key does not invoke any display service methods.
    /// </summary>
    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        _handler.Handle("UnknownDisplayCmd", new JObject());

        _displayMock.VerifyNoOtherCalls();
    }

    /// <summary>
    /// Verifies that a JSON object with width, height, and refreshRate is forwarded to the display service.
    /// </summary>
    [Fact]
    public void SetScreenResolution_ObjectFormatWithRefreshRate_CallsServiceWithRefresh()
    {
        _displayMock.Setup(d => d.SetResolution(2560, 1440, (uint)144)).Returns("ok");

        _handler.Handle("SetScreenResolution", new JObject { ["width"] = 2560u, ["height"] = 1440u, ["refreshRate"] = 144u });

        _displayMock.Verify(d => d.SetResolution(2560, 1440, (uint)144), Times.Once);
    }
}
