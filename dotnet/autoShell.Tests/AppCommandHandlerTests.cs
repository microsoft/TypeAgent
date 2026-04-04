// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class AppCommandHandlerTests
{
    private readonly Mock<IAppRegistry> _appRegistryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IWindowService> _windowMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly AppCommandHandler _handler;

    public AppCommandHandlerTests()
    {
        _handler = new AppCommandHandler(_appRegistryMock.Object, _processMock.Object, _windowMock.Object, _loggerMock.Object);
    }

    /// <summary>
    /// Verifies that launching a non-running app starts it using its executable path.
    /// </summary>
    [Fact]
    public void LaunchProgram_AppNotRunning_StartsViaPath()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("chrome")).Returns("chrome");
        _processMock.Setup(p => p.GetProcessesByName("chrome")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("chrome")).Returns("chrome.exe");

        Handle("LaunchProgram", "chrome");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "chrome.exe" && psi.UseShellExecute == true)), Times.Once);
    }

    /// <summary>
    /// Verifies that launching an app with a configured working directory env var sets the working directory.
    /// </summary>
    [Fact]
    public void LaunchProgram_WithWorkingDir_SetsWorkingDirectory()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("github copilot")).Returns("github copilot");
        _processMock.Setup(p => p.GetProcessesByName("github copilot")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("github copilot")).Returns("copilot.exe");
        _appRegistryMock.Setup(a => a.GetWorkingDirectoryEnvVar("github copilot")).Returns("GITHUB_COPILOT_ROOT_DIR");

        Handle("LaunchProgram", "github copilot");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.WorkingDirectory != "")), Times.Once);
    }

    /// <summary>
    /// Verifies that launching an app with configured arguments passes them to the process start info.
    /// </summary>
    [Fact]
    public void LaunchProgram_WithArguments_SetsArguments()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("github copilot")).Returns("github copilot");
        _processMock.Setup(p => p.GetProcessesByName("github copilot")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("github copilot")).Returns("copilot.exe");
        _appRegistryMock.Setup(a => a.GetArguments("github copilot")).Returns("--allow-all-tools");

        Handle("LaunchProgram", "github copilot");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.Arguments == "--allow-all-tools")), Times.Once);
    }

    /// <summary>
    /// Verifies that when no executable path is available, the app is launched via its AppUserModelId through explorer.exe.
    /// </summary>
    [Fact]
    public void LaunchProgram_NoPath_UsesAppUserModelId()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("calculator")).Returns("calculator");
        _processMock.Setup(p => p.GetProcessesByName("calculator")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("calculator")).Returns((string)null!);
        _appRegistryMock.Setup(a => a.GetAppUserModelId("calculator")).Returns("Microsoft.WindowsCalculator");

        Handle("LaunchProgram", "calculator");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "explorer.exe")), Times.Once);
    }

    /// <summary>
    /// Verifies that closing a program resolves its process name and looks up running processes.
    /// Note: the actual <see cref="System.Diagnostics.Process.CloseMainWindow"/> call path cannot be unit-tested because
    /// <see cref="System.Diagnostics.Process.MainWindowHandle"/> is not virtual and cannot be mocked.
    /// </summary>
    [Fact]
    public void CloseProgram_ResolvesProcessNameAndLooksUpProcesses()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        // Return a real (albeit useless in test) empty array to avoid null ref;
        // We cannot easily mock Process objects, so we verify the lookup was attempted.
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        Handle("CloseProgram", "notepad");

        _processMock.Verify(p => p.GetProcessesByName("notepad"), Times.Once);
    }

    /// <summary>
    /// Verifies that closing a program that is not running does not throw an exception.
    /// </summary>
    [Fact]
    public void CloseProgram_NotRunning_DoesNothing()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        var ex = Record.Exception(() => Handle("CloseProgram", "notepad"));

        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that the ListAppNames command invokes <see cref="IAppRegistry.GetAllAppNames"/> on the app registry.
    /// </summary>
    [Fact]
    public void ListAppNames_CallsGetAllAppNames()
    {
        _appRegistryMock.Setup(a => a.GetAllAppNames()).Returns(["notepad", "chrome"]);

        Handle("ListAppNames", "");

        _appRegistryMock.Verify(a => a.GetAllAppNames(), Times.Once);
    }

    /// <summary>
    /// Verifies that launching an already-running app raises its window instead of starting a new process.
    /// </summary>
    [Fact]
    public void LaunchProgram_AlreadyRunning_RaisesWindow()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([Process.GetCurrentProcess()]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("notepad")).Returns("notepad.exe");

        Handle("LaunchProgram", "notepad");

        _windowMock.Verify(w => w.RaiseWindow("notepad", "notepad.exe"), Times.Once);
        _processMock.Verify(p => p.Start(It.IsAny<ProcessStartInfo>()), Times.Never);
    }

    /// <summary>
    /// Verifies that a <see cref="System.ComponentModel.Win32Exception"/> on first launch attempt triggers a fallback retry using the friendly name.
    /// </summary>
    [Fact]
    public void LaunchProgram_Win32Exception_FallsBackToFriendlyName()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("myapp")).Returns("myapp");
        _processMock.Setup(p => p.GetProcessesByName("myapp")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("myapp")).Returns("myapp.exe");
        _processMock.SetupSequence(p => p.Start(It.IsAny<ProcessStartInfo>()))
            .Throws(new System.ComponentModel.Win32Exception("not found"))
            .Returns(Process.GetCurrentProcess());

        Handle("LaunchProgram", "myapp");

        _processMock.Verify(p => p.Start(It.IsAny<ProcessStartInfo>()), Times.Exactly(2));
    }

    /// <summary>
    /// Verifies that launching an app with no path and no AppUserModelId does not start any process.
    /// </summary>
    [Fact]
    public void LaunchProgram_NoPathNoAppModelId_DoesNothing()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("unknown")).Returns("unknown");
        _processMock.Setup(p => p.GetProcessesByName("unknown")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("unknown")).Returns((string)null!);
        _appRegistryMock.Setup(a => a.GetAppUserModelId("unknown")).Returns((string)null!);

        Handle("LaunchProgram", "unknown");

        _processMock.Verify(p => p.Start(It.IsAny<ProcessStartInfo>()), Times.Never);
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
