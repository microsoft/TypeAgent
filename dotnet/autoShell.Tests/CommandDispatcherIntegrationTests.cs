// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Logging;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

/// <summary>
/// Integration tests that exercise the full <see cref="CommandDispatcher.Create"/> → <see cref="CommandDispatcher.Dispatch"/> → handler → service pipeline
/// using mock services. These verify that <see cref="CommandDispatcher"/> wiring is correct.
/// </summary>
public class CommandDispatcherIntegrationTests
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
    private readonly CommandDispatcher _dispatcher;

    public CommandDispatcherIntegrationTests()
    {
        _dispatcher = CommandDispatcher.Create(
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
    /// Verifies that a Volume command dispatched through <see cref="CommandDispatcher.Create"/> reaches the audio service.
    /// </summary>
    [Fact]
    public void Dispatch_Volume_ReachesAudioService()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        Dispatch("""{"Volume": "75"}""");

        _audioMock.Verify(a => a.SetVolume(75), Times.Once);
    }

    /// <summary>
    /// Verifies that a Mute command dispatched through <see cref="CommandDispatcher.Create"/> reaches the audio service.
    /// </summary>
    [Fact]
    public void Dispatch_Mute_ReachesAudioService()
    {
        Dispatch("""{"Mute": "true"}""");

        _audioMock.Verify(a => a.SetMute(true), Times.Once);
    }

    /// <summary>
    /// Verifies that a LaunchProgram command dispatched through <see cref="CommandDispatcher.Create"/> reaches the process service.
    /// </summary>
    [Fact]
    public void Dispatch_LaunchProgram_ReachesProcessService()
    {
        _appRegistryMock.Setup(a => a.ResolveProcessName("notepad")).Returns("notepad");
        _processMock.Setup(p => p.GetProcessesByName("notepad")).Returns([]);
        _appRegistryMock.Setup(a => a.GetExecutablePath("notepad")).Returns("notepad.exe");

        Dispatch("""{"LaunchProgram": "notepad"}""");

        _processMock.Verify(p => p.Start(It.IsAny<System.Diagnostics.ProcessStartInfo>()), Times.Once);
    }

    /// <summary>
    /// Verifies that a SetWallpaper command dispatched through <see cref="CommandDispatcher.Create"/> reaches the system parameters service.
    /// </summary>
    [Fact]
    public void Dispatch_SetWallpaper_ReachesSystemParamsService()
    {
        Dispatch("""{"SetWallpaper": "C:\\wallpaper.jpg"}""");

        _systemParamsMock.Verify(s => s.SetParameter(0x0014, 0, @"C:\wallpaper.jpg", 3), Times.Once);
    }

    /// <summary>
    /// Verifies that a ConnectWifi command dispatched through <see cref="CommandDispatcher.Create"/> reaches the network service.
    /// </summary>
    [Fact]
    public void Dispatch_ConnectWifi_ReachesNetworkService()
    {
        Dispatch("""{"ConnectWifi": "{\"ssid\": \"MyNetwork\", \"password\": \"pass123\"}"}""");

        _networkMock.Verify(n => n.ConnectToWifi(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }

    /// <summary>
    /// Verifies that a NextDesktop command dispatched through <see cref="CommandDispatcher.Create"/> reaches the virtual desktop service.
    /// </summary>
    [Fact]
    public void Dispatch_NextDesktop_ReachesVirtualDesktopService()
    {
        Dispatch("""{"NextDesktop": ""}""");

        _virtualDesktopMock.Verify(v => v.NextDesktop(), Times.Once);
    }

    /// <summary>
    /// Verifies that a SetThemeMode command dispatched through <see cref="CommandDispatcher.Create"/> reaches the registry service.
    /// </summary>
    [Fact]
    public void Dispatch_SetThemeMode_ReachesRegistryService()
    {
        Dispatch("""{"SetThemeMode": "dark"}""");

        _registryMock.Verify(r => r.SetValue(
            It.IsAny<string>(), "AppsUseLightTheme", 0, It.IsAny<Microsoft.Win32.RegistryValueKind>()), Times.Once);
    }

    /// <summary>
    /// Verifies that an unknown command does not throw and logs a debug message.
    /// </summary>
    [Fact]
    public void Dispatch_UnknownCommand_DoesNotThrow()
    {
        var ex = Record.Exception(() => Dispatch("""{"NonExistentCommand": "value"}"""));

        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that multiple commands in a single JSON object are all dispatched.
    /// </summary>
    [Fact]
    public void Dispatch_MultipleCommands_AllReachServices()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        Dispatch("""{"Volume": "80", "Mute": "false"}""");

        _audioMock.Verify(a => a.SetVolume(80), Times.Once);
        _audioMock.Verify(a => a.SetMute(false), Times.Once);
    }

    /// <summary>
    /// Verifies that quit stops processing and returns true.
    /// </summary>
    [Fact]
    public void Dispatch_Quit_ReturnsTrue()
    {
        bool result = _dispatcher.Dispatch(JObject.Parse("""{"quit": ""}"""));

        Assert.True(result);
    }

    private void Dispatch(string json)
    {
        _dispatcher.Dispatch(JObject.Parse(json));
    }
}
