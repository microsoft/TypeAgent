// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class WindowActionHandlerTests
{
    private readonly Mock<IAppRegistry> _mockAppRegistry = new();
    private readonly Mock<IWindowService> _mockWindow = new();
    private readonly WindowActionHandler _handler;

    public WindowActionHandlerTests()
    {
        _handler = new WindowActionHandler(_mockAppRegistry.Object, _mockWindow.Object);
    }
    // --- Maximize ---

    /// <summary>
    /// Verifies that Maximize resolves the process name and calls <see cref="IWindowService.MaximizeWindow"/>.
    /// </summary>
    [Fact]
    public void Maximize_ResolvesAndMaximizes()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");

        _handler.Handle("Maximize", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _mockWindow.Verify(w => w.MaximizeWindow("notepad"), Times.Once);
    }

    // --- Minimize ---

    /// <summary>
    /// Verifies that Minimize resolves the process name and calls <see cref="IWindowService.MinimizeWindow"/>.
    /// </summary>
    [Fact]
    public void Minimize_ResolvesAndMinimizes()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");

        _handler.Handle("Minimize", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _mockWindow.Verify(w => w.MinimizeWindow("notepad"), Times.Once);
    }

    // --- SwitchTo ---

    /// <summary>
    /// Verifies that SwitchTo resolves the process name and raises its window.
    /// </summary>
    [Fact]
    public void SwitchTo_ResolvesAndRaisesWindow()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _mockAppRegistry.Setup(a => a.GetExecutablePath("Notepad")).Returns("C:\\Windows\\notepad.exe");

        _handler.Handle("SwitchTo", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _mockWindow.Verify(w => w.RaiseWindow("notepad", "C:\\Windows\\notepad.exe"), Times.Once);
    }

    // --- Tile ---

    /// <summary>
    /// Verifies that Tile resolves both app names and tiles their windows side by side.
    /// </summary>
    [Fact]
    public void Tile_ResolvesBothAndTiles()
    {
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _mockAppRegistry.Setup(a => a.ResolveProcessName("Calculator")).Returns("calc");

        _handler.Handle("Tile", JsonDocument.Parse("""{"leftWindow":"Notepad","rightWindow":"Calculator"}""").RootElement);

        _mockWindow.Verify(w => w.TileWindows("notepad", "calc"), Times.Once);
    }

    /// <summary>
    /// Verifies that Tile with only one app name does not call the tiling service.
    /// </summary>
    [Fact]
    public void Tile_SingleApp_DoesNotCallService()
    {
        _handler.Handle("Tile", JsonDocument.Parse("""{"leftWindow":"Notepad"}""").RootElement);

        _mockWindow.Verify(w => w.TileWindows(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that Tile with only rightWindow (missing leftWindow) does not invoke the service.
    /// </summary>
    [Fact]
    public void Tile_OnlyRightWindow_DoesNotCallService()
    {
        _handler.Handle("Tile", JsonDocument.Parse("""{"rightWindow":"Notepad"}""").RootElement);

        _mockWindow.Verify(w => w.TileWindows(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    // --- Unknown key ---

    /// <summary>
    /// Verifies that an unknown command key does not invoke any window or registry service methods.
    /// </summary>
    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        _handler.Handle("UnknownWindowCmd", JsonDocument.Parse("""{"name":"value"}""").RootElement);

        _mockAppRegistry.VerifyNoOtherCalls();
        _mockWindow.VerifyNoOtherCalls();
    }
}
