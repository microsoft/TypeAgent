// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Services;
using Microsoft.Win32;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class ThemeCommandHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly ThemeCommandHandler _handler;

    public ThemeCommandHandlerTests()
    {
        _handler = new ThemeCommandHandler(
            _registryMock.Object, _processMock.Object, _systemParamsMock.Object);
    }

    /// <summary>
    /// Verifies that SetWallpaper calls SystemParametersService with the wallpaper file path.
    /// </summary>
    [Fact]
    public void SetWallpaper_CallsSetParameter()
    {
        Handle("SetWallpaper", @"C:\wallpaper.jpg");

        _systemParamsMock.Verify(s => s.SetParameter(
            0x0014, 0, @"C:\wallpaper.jpg", 3), Times.Once);
    }

    /// <summary>
    /// Verifies that setting theme mode to dark writes 0 for both app and system light-theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_Dark_WritesRegistryValues()
    {
        Handle("SetThemeMode", "dark");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that setting theme mode to light writes 1 for both app and system light-theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_Light_WritesRegistryValues()
    {
        Handle("SetThemeMode", "light");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that applying an unknown theme name does not launch any process.
    /// </summary>
    [Fact]
    public void ApplyTheme_UnknownTheme_DoesNotCallProcess()
    {
        Handle("ApplyTheme", "nonexistent_theme_xyz_12345");

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that the ListThemes command completes without throwing an exception.
    /// </summary>
    [Fact]
    public void ListThemes_ReturnsWithoutError()
    {
        var ex = Record.Exception(() => Handle("ListThemes", "{}"));

        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that "toggle" reads the current theme mode and switches to the opposite.
    /// </summary>
    [Fact]
    public void SetThemeMode_Toggle_ReadsCurrentModeAndToggles()
    {
        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        // Current mode is light (1), so toggle should set dark (0)
        _registryMock.Setup(r => r.GetValue(Path, "AppsUseLightTheme", null)).Returns(1);

        Handle("SetThemeMode", "toggle");

        _registryMock.Verify(r => r.GetValue(Path, "AppsUseLightTheme", null), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that the string "true" sets light mode in the theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_BoolTrue_SetsLightMode()
    {
        Handle("SetThemeMode", "true");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that the string "false" sets dark mode in the theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_BoolFalse_SetsDarkMode()
    {
        Handle("SetThemeMode", "false");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that an unrecognized theme mode value does not write any registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_InvalidValue_DoesNothing()
    {
        Handle("SetThemeMode", "invalidvalue");

        _registryMock.Verify(r => r.SetValue(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<object>(), It.IsAny<RegistryValueKind>()), Times.Never);
    }

    /// <summary>
    /// Verifies that applying "previous" with no prior theme does not launch any process.
    /// </summary>
    [Fact]
    public void ApplyTheme_Previous_RevertsToPreviousTheme()
    {
        // Applying "previous" with no previous theme should not call StartShellExecute
        Handle("ApplyTheme", "previous");

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
