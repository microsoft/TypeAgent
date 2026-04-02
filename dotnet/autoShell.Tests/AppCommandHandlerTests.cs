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

    // --- LaunchProgram ---

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

    [Fact]
    public void CloseProgram_RunningProcess_CallsGetProcessesByName()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        // Return a real (albeit useless in test) empty array to avoid null ref;
        // We cannot easily mock Process objects, so we verify the lookup was attempted.
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        Handle("CloseProgram", "notepad");

        _processMock.Verify(p => p.GetProcessesByName("notepad"), Times.Once);
    }

    [Fact]
    public void CloseProgram_NotRunning_DoesNothing()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);

        var ex = Record.Exception(() => Handle("CloseProgram", "notepad"));

        Assert.Null(ex);
    }

    [Fact]
    public void ListAppNames_CallsGetAllAppNames()
    {
        _appRegistryMock.Setup(a => a.GetAllAppNames()).Returns(["notepad", "chrome"]);

        Handle("ListAppNames", "");

        _appRegistryMock.Verify(a => a.GetAllAppNames(), Times.Once);
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
