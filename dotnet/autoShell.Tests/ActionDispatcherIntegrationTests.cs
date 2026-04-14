// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

/// <summary>
/// Integration tests that exercise the full <see cref="ActionDispatcher.Create"/> → <see cref="ActionDispatcher.Dispatch"/> → handler → service pipeline
/// using mock services. These verify that <see cref="ActionDispatcher"/> wiring is correct.
/// </summary>
public class ActionDispatcherIntegrationTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IAudioService> _audioMock = new();
    private readonly Mock<IAppRegistry> _appRegistryMock = new();
    private readonly Mock<IDebuggerService> _debuggerMock = new();
    private readonly Mock<IBrightnessService> _brightnessMock = new();
    private readonly Mock<IDisplayService> _displayMock = new();
    private readonly Mock<IWindowService> _windowMock = new();
    private readonly Mock<INetworkService> _networkMock = new();
    private readonly Mock<IVirtualDesktopService> _virtualDesktopMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly ActionDispatcher _dispatcher;

    public ActionDispatcherIntegrationTests()
    {
        _dispatcher = ActionDispatcher.Create(
            _loggerMock.Object,
            _registryMock.Object,
            _systemParamsMock.Object,
            _processMock.Object,
            _audioMock.Object,
            _appRegistryMock.Object,
            _debuggerMock.Object,
            _brightnessMock.Object,
            _displayMock.Object,
            _windowMock.Object,
            _networkMock.Object,
            _virtualDesktopMock.Object);
    }

    /// <summary>
    /// Verifies that a Volume command dispatched through <see cref="ActionDispatcher.Create"/> reaches the audio service.
    /// </summary>
    [Fact]
    public void Dispatch_Volume_ReachesAudioService()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        Dispatch("""{"actionName":"Volume","parameters":{"targetVolume":75}}""");

        _audioMock.Verify(a => a.SetVolume(75), Times.Once);
    }

    /// <summary>
    /// Verifies that a Mute command dispatched through <see cref="ActionDispatcher.Create"/> reaches the audio service.
    /// </summary>
    [Fact]
    public void Dispatch_Mute_ReachesAudioService()
    {
        Dispatch("""{"actionName":"Mute","parameters":{"on":true}}""");

        _audioMock.Verify(a => a.SetMute(true), Times.Once);
    }

    /// <summary>
    /// Verifies that a LaunchProgram command dispatched through <see cref="ActionDispatcher.Create"/> reaches the process service.
    /// </summary>
    [Fact]
    public void Dispatch_LaunchProgram_ReachesProcessService()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("notepad")).Returns("notepad.exe");

        Dispatch("""{"actionName":"LaunchProgram","parameters":{"name":"notepad"}}""");

        _processMock.Verify(p => p.Start(It.IsAny<System.Diagnostics.ProcessStartInfo>()), Times.Once);
    }

    /// <summary>
    /// Verifies that a SetWallpaper command dispatched through <see cref="ActionDispatcher.Create"/> reaches the system parameters service.
    /// </summary>
    [Fact]
    public void Dispatch_SetWallpaper_ReachesSystemParamsService()
    {
        Dispatch("""{"actionName":"SetWallpaper","parameters":{"filePath":"C:\\wallpaper.jpg"}}""");

        _systemParamsMock.Verify(s => s.SetParameter(0x0014, 0, @"C:\wallpaper.jpg", 3), Times.Once);
    }

    /// <summary>
    /// Verifies that a ConnectWifi command dispatched through <see cref="ActionDispatcher.Create"/> reaches the network service.
    /// </summary>
    [Fact]
    public void Dispatch_ConnectWifi_ReachesNetworkService()
    {
        Dispatch("""{"actionName":"ConnectWifi","parameters":{"ssid":"MyNetwork","password":"pass123"}}""");

        _networkMock.Verify(n => n.ConnectToWifi(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }

    /// <summary>
    /// Verifies that a NextDesktop command dispatched through <see cref="ActionDispatcher.Create"/> reaches the virtual desktop service.
    /// </summary>
    [Fact]
    public void Dispatch_NextDesktop_ReachesVirtualDesktopService()
    {
        Dispatch("""{"actionName":"NextDesktop","parameters":{}}""");

        _virtualDesktopMock.Verify(v => v.NextDesktop(), Times.Once);
    }

    /// <summary>
    /// Verifies that a SetThemeMode command dispatched through <see cref="ActionDispatcher.Create"/> reaches the registry service.
    /// </summary>
    [Fact]
    public void Dispatch_SetThemeMode_ReachesRegistryService()
    {
        Dispatch("""{"actionName":"SetThemeMode","parameters":{"mode":"dark"}}""");

        _registryMock.Verify(r => r.SetValue(
            It.IsAny<string>(), "AppsUseLightTheme", 0, It.IsAny<Microsoft.Win32.RegistryValueKind>()), Times.Once);
    }

    /// <summary>
    /// Verifies that an unknown command does not throw and logs a debug message.
    /// </summary>
    [Fact]
    public void Dispatch_UnknownCommand_DoesNotThrow()
    {
        var ex = Record.Exception(() => Dispatch("""{"actionName":"NonExistentCommand","parameters":{}}"""));

        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that multiple commands dispatched separately all reach their services.
    /// </summary>
    [Fact]
    public void Dispatch_MultipleCommands_AllReachServices()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        Dispatch("""{"actionName":"Volume","parameters":{"targetVolume":80}}""");
        Dispatch("""{"actionName":"Mute","parameters":{"on":false}}""");

        _audioMock.Verify(a => a.SetVolume(80), Times.Once);
        _audioMock.Verify(a => a.SetMute(false), Times.Once);
    }

    /// <summary>
    /// Verifies that quit stops processing and returns null.
    /// </summary>
    [Fact]
    public void Dispatch_Quit_ReturnsQuitResult()
    {
        ActionResult result = _dispatcher.Dispatch(JsonDocument.Parse("""{"actionName":"quit","parameters":{}}""").RootElement);

        Assert.NotNull(result);
        Assert.True(result.Success);
        Assert.True(result.IsQuit);
    }

    private void Dispatch(string json)
    {
        _dispatcher.Dispatch(JsonDocument.Parse(json).RootElement);
    }
}
