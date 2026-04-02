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

    [Fact]
    public void SetWallpaper_CallsSetParameter()
    {
        Handle("SetWallpaper", @"C:\wallpaper.jpg");

        _systemParamsMock.Verify(s => s.SetParameter(
            0x0014, 0, @"C:\wallpaper.jpg", 3), Times.Once);
    }

    [Fact]
    public void SetThemeMode_Dark_WritesRegistryValues()
    {
        Handle("SetThemeMode", "dark");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void SetThemeMode_Light_WritesRegistryValues()
    {
        Handle("SetThemeMode", "light");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ApplyTheme_UnknownTheme_DoesNotCallProcess()
    {
        Handle("ApplyTheme", "nonexistent_theme_xyz_12345");

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public void ListThemes_ReturnsWithoutError()
    {
        var ex = Record.Exception(() => Handle("ListThemes", "{}"));

        Assert.Null(ex);
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
