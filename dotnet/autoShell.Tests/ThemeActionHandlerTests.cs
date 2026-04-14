// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Services;
using Microsoft.Win32;
using Moq;

namespace autoShell.Tests;

public class ThemeActionHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly ThemeActionHandler _handler;

    public ThemeActionHandlerTests()
    {
        _handler = new ThemeActionHandler(
            _registryMock.Object, _processMock.Object, _systemParamsMock.Object);
    }

    /// <summary>
    /// Verifies that SetWallpaper calls SystemParametersService with the wallpaper file path.
    /// </summary>
    [Fact]
    public void SetWallpaper_CallsSetParameter()
    {
        _handler.Handle("SetWallpaper", JsonDocument.Parse("""{"filePath":"C:\\wallpaper.jpg"}""").RootElement);

        _systemParamsMock.Verify(s => s.SetParameter(
            0x0014, 0, @"C:\wallpaper.jpg", 3), Times.Once);
    }

    /// <summary>
    /// Verifies that setting theme mode to dark writes 0 for both app and system light-theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_Dark_WritesRegistryValues()
    {
        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"dark"}""").RootElement);

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
        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"light"}""").RootElement);

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
        _handler.Handle("ApplyTheme", JsonDocument.Parse("""{"filePath":"nonexistent_theme_xyz_12345"}""").RootElement);

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that the ListThemes command completes without throwing an exception.
    /// </summary>
    [Fact]
    public void ListThemes_ReturnsWithoutError()
    {
        var ex = Record.Exception(() => _handler.Handle("ListThemes", JsonDocument.Parse("{}").RootElement));

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

        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"toggle"}""").RootElement);

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
        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"true"}""").RootElement);

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that the string "false" sets dark mode in the theme registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_BoolFalse_SetsDarkMode()
    {
        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"false"}""").RootElement);

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that an unrecognized theme mode value does not write any registry keys.
    /// </summary>
    [Fact]
    public void SetThemeMode_InvalidValue_DoesNothing()
    {
        _handler.Handle("SetThemeMode", JsonDocument.Parse("""{"mode":"invalidvalue"}""").RootElement);

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
        _handler.Handle("ApplyTheme", JsonDocument.Parse("""{"filePath":"previous"}""").RootElement);

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }
}
