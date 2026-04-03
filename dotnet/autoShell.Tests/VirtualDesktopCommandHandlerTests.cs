// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using autoShell.Handlers;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class VirtualDesktopCommandHandlerTests
{
    private readonly Mock<IAppRegistry> _appRegistryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IVirtualDesktopService> _virtualDesktopMock = new();
    private readonly VirtualDesktopCommandHandler _handler;

    public VirtualDesktopCommandHandlerTests()
    {
        _handler = new VirtualDesktopCommandHandler(_appRegistryMock.Object, _processMock.Object, _virtualDesktopMock.Object, new Moq.Mock<autoShell.Logging.ILogger>().Object);
    }

    // --- CreateDesktop ---

    /// <summary>
    /// Verifies that CreateDesktop forwards the JSON desktop names to the virtual desktop service.
    /// </summary>
    [Fact]
    public void CreateDesktop_CallsServiceWithJsonValue()
    {
        var json = JToken.Parse("""["Work","Personal"]""");
        _handler.Handle("CreateDesktop", json.ToString(), json);

        _virtualDesktopMock.Verify(v => v.CreateDesktops(It.IsAny<string>()), Times.Once);
    }

    // --- NextDesktop ---

    /// <summary>
    /// Verifies that NextDesktop invokes the service to switch to the next virtual desktop.
    /// </summary>
    [Fact]
    public void NextDesktop_CallsService()
    {
        _handler.Handle("NextDesktop", "", JToken.FromObject(""));

        _virtualDesktopMock.Verify(v => v.NextDesktop(), Times.Once);
    }

    // --- PreviousDesktop ---

    /// <summary>
    /// Verifies that PreviousDesktop invokes the service to switch to the previous virtual desktop.
    /// </summary>
    [Fact]
    public void PreviousDesktop_CallsService()
    {
        _handler.Handle("PreviousDesktop", "", JToken.FromObject(""));

        _virtualDesktopMock.Verify(v => v.PreviousDesktop(), Times.Once);
    }

    // --- SwitchDesktop ---

    /// <summary>
    /// Verifies that SwitchDesktop with a numeric index forwards it to the service.
    /// </summary>
    [Fact]
    public void SwitchDesktop_ByIndex_CallsService()
    {
        _handler.Handle("SwitchDesktop", "2", JToken.FromObject("2"));

        _virtualDesktopMock.Verify(v => v.SwitchDesktop("2"), Times.Once);
    }

    /// <summary>
    /// Verifies that SwitchDesktop with a desktop name forwards it to the service.
    /// </summary>
    [Fact]
    public void SwitchDesktop_ByName_CallsService()
    {
        _handler.Handle("SwitchDesktop", "Work", JToken.FromObject("Work"));

        _virtualDesktopMock.Verify(v => v.SwitchDesktop("Work"), Times.Once);
    }

    // --- MoveWindowToDesktop ---

    /// <summary>
    /// Verifies that MoveWindowToDesktop resolves the process name and looks up its running processes.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_WithValidProcess_CallsService()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        var mockProcess = new Mock<Process>();
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        var json = JToken.Parse("""{"process":"Notepad","desktop":"2"}""");
        _handler.Handle("MoveWindowToDesktop", json.ToString(), json);

        _appRegistryMock.Verify(a => a.ResolveProcessName("Notepad"), Times.Once);
        _processMock.Verify(p => p.GetProcessesByName("notepad"), Times.Once);
    }

    // --- PinWindow ---

    /// <summary>
    /// Verifies that PinWindow resolves the process name and looks up its running processes.
    /// </summary>
    [Fact]
    public void PinWindow_ResolvesProcessName()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        _handler.Handle("PinWindow", "Notepad", JToken.FromObject("Notepad"));

        _appRegistryMock.Verify(a => a.ResolveProcessName("Notepad"), Times.Once);
        _processMock.Verify(p => p.GetProcessesByName("notepad"), Times.Once);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop without a process field does not call the service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_MissingProcess_DoesNotCallService()
    {
        var json = JToken.Parse("""{"desktop":"2"}""");
        _handler.Handle("MoveWindowToDesktop", json.ToString(), json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(It.IsAny<IntPtr>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop without a desktop field does not call the service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_MissingDesktop_DoesNotCallService()
    {
        var json = JToken.Parse("""{"process":"Notepad"}""");
        _handler.Handle("MoveWindowToDesktop", json.ToString(), json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(It.IsAny<IntPtr>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that MoveWindowToDesktop with no matching window handle does not call the move service.
    /// </summary>
    [Fact]
    public void MoveWindowToDesktop_NoWindowHandle_DoesNotCallService()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        var json = JToken.Parse("""{"process":"Notepad","desktop":"2"}""");
        _handler.Handle("MoveWindowToDesktop", json.ToString(), json);

        _virtualDesktopMock.Verify(v => v.MoveWindowToDesktop(It.IsAny<IntPtr>(), It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that PinWindow with no matching window handle does not call the pin service.
    /// </summary>
    [Fact]
    public void PinWindow_NoWindowHandle_DoesNotCallPinWindow()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("Notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        _handler.Handle("PinWindow", "Notepad", JToken.FromObject("Notepad"));

        _virtualDesktopMock.Verify(v => v.PinWindow(It.IsAny<IntPtr>()), Times.Never);
    }
}
