// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class WindowCommandHandlerTests
{
    private readonly Mock<IAppRegistry> _mockAppRegistry = new();
    private readonly Mock<IWindowService> _mockWindow = new();
    private readonly WindowCommandHandler _handler;

    public WindowCommandHandlerTests()
    {
        _handler = new WindowCommandHandler(_mockAppRegistry.Object, _mockWindow.Object);
    }

    [Fact]
    public void SupportedCommands_ContainsExpectedCommands()
    {
        var commands = _handler.SupportedCommands.ToList();
        Assert.Contains("Maximize", commands);
        Assert.Contains("Minimize", commands);
        Assert.Contains("SwitchTo", commands);
        Assert.Contains("Tile", commands);
        Assert.Equal(4, commands.Count);
    }

    // --- Maximize ---

    [Fact]
    public void Maximize_ResolvesAndMaximizes()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");

        Handle("Maximize", "Notepad");

        _mockWindow.Verify(w => w.MaximizeWindow("notepad"), Times.Once);
    }

    // --- Minimize ---

    [Fact]
    public void Minimize_ResolvesAndMinimizes()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");

        Handle("Minimize", "Notepad");

        _mockWindow.Verify(w => w.MinimizeWindow("notepad"), Times.Once);
    }

    // --- SwitchTo ---

    [Fact]
    public void SwitchTo_ResolvesAndRaisesWindow()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _mockAppRegistry.Setup(a => a.GetExecutablePath("Notepad")).Returns("C:\\Windows\\notepad.exe");

        Handle("SwitchTo", "Notepad");

        _mockWindow.Verify(w => w.RaiseWindow("notepad", "C:\\Windows\\notepad.exe"), Times.Once);
    }

    // --- Tile ---

    [Fact]
    public void Tile_ResolvesBothAndTiles()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Calculator")).Returns("calc");

        Handle("Tile", "Notepad,Calculator");

        _mockWindow.Verify(w => w.TileWindows("notepad", "calc"), Times.Once);
    }

    [Fact]
    public void Tile_SingleApp_DoesNotCallService()
    {
        Handle("Tile", "Notepad");

        _mockWindow.Verify(w => w.TileWindows(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    // --- Unknown key ---

    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        Handle("UnknownWindowCmd", "value");

        _mockAppRegistry.VerifyNoOtherCalls();
        _mockWindow.VerifyNoOtherCalls();
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
