// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class VirtualDesktopActionHandlerTests
{
    private readonly Mock<IAppRegistry> _appRegistryMock = new();
    private readonly Mock<IWindowService> _windowMock = new();
    private readonly Mock<IVirtualDesktopService> _virtualDesktopMock = new();
    private readonly VirtualDesktopActionHandler _handler;

    public VirtualDesktopActionHandlerTests()
    {
        _handler = new VirtualDesktopActionHandler(_appRegistryMock.Object, _windowMock.Object, _virtualDesktopMock.Object, new Mock<ILogger>().Object);
    }

    // --- CreateDesktop ---

    /// <summary>
    /// Verifies that CreateDesktop forwards the JSON desktop names to the virtual desktop service.
    /// </summary>
    [Fact]
    public void CreateDesktop_CallsServiceWithJsonValue()
    {
        var json = JsonDocument.Parse("""{"names":["Work","Personal"]}""").RootElement;
        _handler.Handle("CreateDesktop", json);

        _virtualDesktopMock.Verify(v => v.CreateDesktops(It.IsAny<string>()), Times.Once);
    }

    // --- NextDesktop ---

    /// <summary>
    /// Verifies that NextDesktop invokes the service to switch to the next virtual desktop.
    /// </summary>
    [Fact]
    public void NextDesktop_CallsService()
    {
        _handler.Handle("NextDesktop", JsonDocument.Parse("{}").RootElement);

        _virtualDesktopMock.Verify(v => v.NextDesktop(), Times.Once);
    }

    // --- PreviousDesktop ---

    /// <summary>
    /// Verifies that PreviousDesktop invokes the service to switch to the previous virtual desktop.
    /// </summary>
    [Fact]
    public void PreviousDesktop_CallsService()
    {
        _handler.Handle("PreviousDesktop", JsonDocument.Parse("{}").RootElement);

        _virtualDesktopMock.Verify(v => v.PreviousDesktop(), Times.Once);
    }

    // --- SwitchDesktop ---

    /// <summary>
    /// Verifies that SwitchDesktop with a numeric index forwards it to the service.
    /// </summary>
    [Fact]
    public void SwitchDesktop_ByIndex_CallsService()
    {
        _handler.Handle("SwitchDesktop", JsonDocument.Parse("""{"desktopId":2}""").RootElement);

        _virtualDesktopMock.Verify(v => v.SwitchDesktop("2"), Times.Once);
    }

    /// <summary>
    /// Verifies that SwitchDesktop with an invalid (non-numeric) desktopId returns a failure.
    /// The schema defines desktopId as a number, so a string value fails deserialization.
    /// </summary>
    [Fact]
    public void SwitchDesktop_ByName_ReturnsFailure()
    {
        var result = _handler.Handle("SwitchDesktop", JsonDocument.Parse("""{"desktopId":"Work"}""").RootElement);

        Assert.False(result.Success);
        _virtualDesktopMock.Verify(v => v.SwitchDesktop(It.IsAny<string>()), Times.Never);
    }

    // --- MoveWindowToDesktop ---

    /// <summary>
    /// Verifies that MoveWindowToDesktop resolves the process name and looks up its window handle.
    /// Note: the actual MoveWindowToDesktop service call cannot be verified because
    /// <see cref="IWindowService.FindProcessWindowHandle"/> returns <see cref="IntPtr.Zero"/> by default from the mock.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_ResolvesProcessNameAndLooksUpWindowHandle()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(IntPtr.Zero);

        var json = JsonDocument.Parse("""{"name":"Notepad","desktopId":2}""").RootElement;
        _handler.Handle("MoveWindowToDesktop", json);

        _appRegistryMock.Verify(a => a.ResolveProcessName("Notepad"), Times.Once);
        _windowMock.Verify(w => w.FindProcessWindowHandle("notepad"), Times.Once);
    }

    // --- PinWindow ---

    /// <summary>
    /// Verifies that PinWindow resolves the process name and looks up its window handle.
    /// </summary>
    [Fact]
    public void PinWindow_ResolvesProcessNameAndLooksUpWindowHandle()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(IntPtr.Zero);

        _handler.Handle("PinWindow", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _appRegistryMock.Verify(a => a.ResolveProcessName("Notepad"), Times.Once);
        _windowMock.Verify(w => w.FindProcessWindowHandle("notepad"), Times.Once);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop without a process field does not call the service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_MissingProcess_DoesNotCallService()
    {
        var json = JsonDocument.Parse("""{"desktopId":"2"}""").RootElement;
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop without a desktop field does not call the service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_MissingDesktop_DoesNotCallService()
    {
        var json = JsonDocument.Parse("""{"name":"Notepad"}""").RootElement;
        _handler.Handle("MoveWindowToDesktop", json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(It.IsAny<IntPtr>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop with no matching window handle does not call the move service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_NoWindowHandle_DoesNotCallService()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(IntPtr.Zero);

        var json = JsonDocument.Parse("""{"name":"Notepad","desktopId":"2"}""").RootElement;
        _handler.Handle("MoveWindowToDesktop", json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(It.IsAny<IntPtr>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop calls the service when a valid window handle is found.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_ValidHandle_CallsService()
    {
        var handle = new IntPtr(12345);
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(handle);

        var json = JsonDocument.Parse("""{"name":"Notepad","desktopId":2}""").RootElement;
        _handler.Handle("MoveWindowToDesktop", json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(handle, "2"), Times.Once);
    }

    /// <summary>
    /// Verifies that PinWindow with no matching window handle does not call the pin service.
    /// </summary>
    [Fact]
    public void PinWindow_NoWindowHandle_DoesNotCallPinWindow()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(IntPtr.Zero);

        _handler.Handle("PinWindow", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _virtualDesktopMock.Verify(v => v.PinWindow(It.IsAny<IntPtr>()), Times.Never);
    }

    /// <summary>
    /// Verifies that PinWindow calls the service when a valid window handle is found.
    /// </summary>
    [Fact]
    public void PinWindow_ValidHandle_CallsService()
    {
        var handle = new IntPtr(12345);
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _windowMock.Setup(w => w.FindProcessWindowHandle("notepad")).Returns(handle);

        _handler.Handle("PinWindow", JsonDocument.Parse("""{"name":"Notepad"}""").RootElement);

        _virtualDesktopMock.Verify(v => v.PinWindow(handle), Times.Once);
    }
}
