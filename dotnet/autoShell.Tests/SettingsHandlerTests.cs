// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text.Json;
using autoShell.Handlers.Settings;
using autoShell.Logging;
using autoShell.Services;
using Microsoft.Win32;
using Moq;
using static autoShell.Services.Interop.SpiConstants;

namespace autoShell.Tests;

#region PersonalizationSettingsHandler

public class PersonalizationSettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly PersonalizationSettingsHandler _handler;

    public PersonalizationSettingsHandlerTests()
    {
        _handler = new PersonalizationSettingsHandler(_registryMock.Object, _processMock.Object);
    }

    /// <summary>
    /// Verifies that enabling title bar color sets DWM ColorPrevalence to 1.
    /// </summary>
    [Fact]
    public void ApplyColorToTitleBar_Enable_SetsColorPrevalence1()
    {
        Handle("ApplyColorToTitleBar", """{"enableColor":true}""");

        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\DWM", "ColorPrevalence", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling title bar color sets DWM ColorPrevalence to 0.
    /// </summary>
    [Fact]
    public void ApplyColorToTitleBar_Disable_SetsColorPrevalence0()
    {
        Handle("ApplyColorToTitleBar", """{"enableColor":false}""");

        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\DWM", "ColorPrevalence", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling transparency sets EnableTransparency to 1.
    /// </summary>
    [Fact]
    public void EnableTransparency_Enable_SetsTransparency1()
    {
        Handle("EnableTransparency", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling transparency sets EnableTransparency to 0.
    /// </summary>
    [Fact]
    public void EnableTransparency_Disable_SetsTransparency0()
    {
        Handle("EnableTransparency", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that light system theme mode sets both app and system light-theme registry keys to 1.
    /// </summary>
    [Fact]
    public void SystemThemeMode_Light_SetsBothKeys()
    {
        Handle("SystemThemeMode", """{"mode":"light"}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that dark system theme mode sets both app and system light-theme registry keys to 0.
    /// </summary>
    [Fact]
    public void SystemThemeMode_Dark_SetsBothKeys()
    {
        Handle("SystemThemeMode", """{"mode":"dark"}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that the high contrast theme action opens the high contrast settings page.
    /// </summary>
    [Fact]
    public void HighContrastTheme_OpensSettings()
    {
        Handle("HighContrastTheme", "{}");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-highcontrast"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region PrivacySettingsHandler

public class PrivacySettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly PrivacySettingsHandler _handler;

    public PrivacySettingsHandlerTests()
    {
        _handler = new PrivacySettingsHandler(_registryMock.Object);
    }

    /// <summary>
    /// Verifies that denying camera access writes "Deny" to the webcam consent store.
    /// </summary>
    [Fact]
    public void ManageCameraAccess_Deny_WritesDeny()
    {
        Handle("ManageCameraAccess", """{"accessSetting":"deny"}""");
        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
            "Value", "Deny", RegistryValueKind.String), Times.Once);
    }

    /// <summary>
    /// Verifies that denying camera access is case-insensitive (e.g., "Deny" matches "deny").
    /// </summary>
    [Fact]
    public void ManageCameraAccess_DenyMixedCase_WritesDeny()
    {
        Handle("ManageCameraAccess", """{"accessSetting":"Deny"}""");
        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
            "Value", "Deny", RegistryValueKind.String), Times.Once);
    }

    /// <summary>
    /// Verifies that allowing camera access writes "Allow" to the webcam consent store.
    /// </summary>
    [Fact]
    public void ManageCameraAccess_Allow_WritesAllow()
    {
        Handle("ManageCameraAccess", """{"accessSetting":"allow"}""");
        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
            "Value", "Allow", RegistryValueKind.String), Times.Once);
    }

    /// <summary>
    /// Verifies that denying microphone access writes "Deny" to the microphone consent store.
    /// </summary>
    [Fact]
    public void ManageMicrophoneAccess_Deny_WritesDeny()
    {
        Handle("ManageMicrophoneAccess", """{"accessSetting":"deny"}""");
        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
            "Value", "Deny", RegistryValueKind.String), Times.Once);
    }

    /// <summary>
    /// Verifies that allowing location access writes "Allow" to the location consent store.
    /// </summary>
    [Fact]
    public void ManageLocationAccess_Allow_WritesAllow()
    {
        Handle("ManageLocationAccess", """{"accessSetting":"allow"}""");
        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location",
            "Value", "Allow", RegistryValueKind.String), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region FileExplorerSettingsHandler

public class FileExplorerSettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly FileExplorerSettingsHandler _handler;

    public FileExplorerSettingsHandlerTests()
    {
        _handler = new FileExplorerSettingsHandler(_registryMock.Object);
    }

    /// <summary>
    /// Verifies that enabling file extensions sets HideFileExt to 0 (inverted toggle).
    /// </summary>
    [Fact]
    public void ShowFileExtensions_Enable_SetsHideFileExt0()
    {
        Handle("ShowFileExtensions", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            "HideFileExt", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling file extensions sets HideFileExt to 1 (inverted toggle).
    /// </summary>
    [Fact]
    public void ShowFileExtensions_Disable_SetsHideFileExt1()
    {
        Handle("ShowFileExtensions", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            "HideFileExt", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling hidden files sets Hidden to 1 and ShowSuperHidden to 1.
    /// </summary>
    [Fact]
    public void ShowHiddenAndSystemFiles_Enable_SetsBothKeys()
    {
        Handle("ShowHiddenAndSystemFiles", """{"enable":true}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
        _registryMock.Verify(r => r.SetValue(Path, "Hidden", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "ShowSuperHidden", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling hidden files sets Hidden to 2 and ShowSuperHidden to 0.
    /// </summary>
    [Fact]
    public void ShowHiddenAndSystemFiles_Disable_SetsBothKeys()
    {
        Handle("ShowHiddenAndSystemFiles", """{"enable":false}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
        _registryMock.Verify(r => r.SetValue(Path, "Hidden", 2, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "ShowSuperHidden", 0, RegistryValueKind.DWord), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region PowerSettingsHandler

public class PowerSettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly PowerSettingsHandler _handler;

    public PowerSettingsHandlerTests()
    {
        _handler = new PowerSettingsHandler(_registryMock.Object, _processMock.Object);
    }

    /// <summary>
    /// Verifies that the battery saver activation level writes the threshold value to the registry.
    /// </summary>
    [Fact]
    public void BatterySaverActivationLevel_SetsThreshold()
    {
        Handle("BatterySaverActivationLevel", """{"thresholdValue":30}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver",
            "ActivationThreshold", 30, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that SetPowerModeOnBattery opens the power and sleep settings page.
    /// </summary>
    [Fact]
    public void SetPowerModeOnBattery_OpensSettings()
    {
        Handle("SetPowerModeOnBattery", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:powersleep"), Times.Once);
    }

    /// <summary>
    /// Verifies that SetPowerModePluggedIn opens the power and sleep settings page.
    /// </summary>
    [Fact]
    public void SetPowerModePluggedIn_OpensSettings()
    {
        Handle("SetPowerModePluggedIn", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:powersleep"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region AccessibilitySettingsHandler

public class AccessibilitySettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly AccessibilitySettingsHandler _handler;

    public AccessibilitySettingsHandlerTests()
    {
        _handler = new AccessibilitySettingsHandler(_registryMock.Object, _processMock.Object, _systemParamsMock.Object);
    }

    /// <summary>
    /// Verifies that enabling sticky keys calls SystemParametersInfo(SPI_SETSTICKYKEYS).
    /// </summary>
    [Fact]
    public void EnableStickyKeys_Enable_CallsSetStickyKeys()
    {
        Handle("EnableStickyKeys", """{"enable":true}""");

        _systemParamsMock.Verify(s => s.SetStickyKeys(true), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling sticky keys calls SystemParametersInfo(SPI_SETSTICKYKEYS).
    /// </summary>
    [Fact]
    public void EnableStickyKeys_Disable_CallsSetStickyKeys()
    {
        Handle("EnableStickyKeys", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.SetStickyKeys(false), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling filter keys calls SystemParametersInfo(SPI_SETFILTERKEYS).
    /// </summary>
    [Fact]
    public void EnableFilterKeysAction_Enable_CallsSetFilterKeys()
    {
        Handle("EnableFilterKeysAction", """{"enable":true}""");

        _systemParamsMock.Verify(s => s.SetFilterKeys(true), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling filter keys calls SystemParametersInfo(SPI_SETFILTERKEYS).
    /// </summary>
    [Fact]
    public void EnableFilterKeysAction_Disable_CallsSetFilterKeys()
    {
        Handle("EnableFilterKeysAction", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.SetFilterKeys(false), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling mono audio sets the AccessibilityMonoMixState registry value to 1.
    /// </summary>
    [Fact]
    public void MonoAudioToggle_Enable_SetsMonoMix1()
    {
        Handle("MonoAudioToggle", """{"enable":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Multimedia\Audio", "AccessibilityMonoMixState", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling the magnifier starts the magnify.exe process.
    /// </summary>
    [Fact]
    public void EnableMagnifier_Enable_StartsProcess()
    {
        Handle("EnableMagnifier", """{"enable":true}""");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "magnify.exe")), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling narrator starts the narrator.exe process.
    /// </summary>
    [Fact]
    public void EnableNarratorAction_Enable_StartsNarrator()
    {
        Handle("EnableNarratorAction", """{"enable":true}""");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "narrator.exe")), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling narrator attempts to find and stop the Narrator process by name.
    /// </summary>
    [Fact]
    public void EnableNarratorAction_Disable_CallsGetProcessesByName()
    {
        _processMock.Setup(p => p.GetProcessesByName("Narrator")).Returns([]);

        Handle("EnableNarratorAction", """{"enable":false}""");

        _processMock.Verify(p => p.GetProcessesByName("Narrator"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region MouseSettingsHandler

public class MouseSettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly MouseSettingsHandler _handler;

    public MouseSettingsHandlerTests()
    {
        _handler = new MouseSettingsHandler(
            _registryMock.Object,
            _processMock.Object,
            _systemParamsMock.Object,
            new Mock<ILogger>().Object);
    }

    /// <summary>
    /// Verifies that mouse cursor speed is set via SystemParametersService with the specified speed level.
    /// </summary>
    [Fact]
    public void MouseCursorSpeed_SetsSpeed()
    {
        Handle("MouseCursorSpeed", """{"speedLevel":10}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSESPEED, 0, 10, SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that mouse wheel scroll lines are set via SystemParametersService.
    /// </summary>
    [Fact]
    public void MouseWheelScrollLines_SetsLines()
    {
        Handle("MouseWheelScrollLines", """{"scrollLines":5}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETWHEELSCROLLLINES, 5, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling enhanced pointer precision updates the mouse speed array with value 1.
    /// </summary>
    [Fact]
    public void EnhancePointerPrecision_Enable()
    {
        Handle("EnhancePointerPrecision", """{"enable":true}""");

        _systemParamsMock.Verify(s => s.GetParameter(SPI_GETMOUSE, 0, It.IsAny<int[]>(), 0), Times.Once);
        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSE, 0, It.Is<int[]>(a => a[2] == 1), SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling enhanced pointer precision updates the mouse speed array with value 0.
    /// </summary>
    [Fact]
    public void EnhancePointerPrecision_Disable()
    {
        Handle("EnhancePointerPrecision", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.GetParameter(SPI_GETMOUSE, 0, It.IsAny<int[]>(), 0), Times.Once);
        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSE, 0, It.Is<int[]>(a => a[2] == 0), SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustMousePointerSize opens the ease of access mouse settings page.
    /// </summary>
    [Fact]
    public void AdjustMousePointerSize_OpensMouseSettings()
    {
        Handle("AdjustMousePointerSize", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-mouse"), Times.Once);
    }

    /// <summary>
    /// Verifies that EnableTouchPad opens the touchpad settings page.
    /// </summary>
    [Fact]
    public void EnableTouchPad_OpensTouchpadSettings()
    {
        Handle("EnableTouchPad", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:devices-touchpad"), Times.Once);
    }

    /// <summary>
    /// Verifies that MousePointerCustomization opens the ease of access mouse settings page.
    /// </summary>
    [Fact]
    public void MousePointerCustomization_OpensMouseSettings()
    {
        Handle("MousePointerCustomization", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-mouse"), Times.Once);
    }

    /// <summary>
    /// Verifies that TouchpadCursorSpeed opens the touchpad settings page.
    /// </summary>
    [Fact]
    public void TouchpadCursorSpeed_OpensTouchpadSettings()
    {
        Handle("TouchpadCursorSpeed", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:devices-touchpad"), Times.Once);
    }

    /// <summary>
    /// Verifies that setting the primary mouse button to right swaps the mouse buttons.
    /// </summary>
    [Fact]
    public void SetPrimaryMouseButton_Right_SwapsButtons()
    {
        Handle("SetPrimaryMouseButton", """{"primaryButton":"right"}""");

        _systemParamsMock.Verify(s => s.SwapMouseButton(true), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling cursor trail sets the trail length to the specified value.
    /// </summary>
    [Fact]
    public void CursorTrail_Enable_SetsTrailLength()
    {
        Handle("CursorTrail", """{"enable":true,"length":7}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSETRAILS, 7, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling cursor trail sets the trail value to zero.
    /// </summary>
    [Fact]
    public void CursorTrail_Disable_SetsTrailValueZero()
    {
        Handle("CursorTrail", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSETRAILS, 0, IntPtr.Zero, It.IsAny<int>()), Times.Once);
    }

    /// <summary>
    /// Verifies that cursor trail length is clamped to the minimum of 2 when a lower value is provided.
    /// </summary>
    [Fact]
    public void CursorTrail_LengthClampsToMin2()
    {
        Handle("CursorTrail", """{"enable":true,"length":0}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSETRAILS, 2, IntPtr.Zero, It.IsAny<int>()), Times.Once);
    }

    /// <summary>
    /// Verifies that cursor trail length is clamped to the maximum of 12 when a higher value is provided.
    /// </summary>
    [Fact]
    public void CursorTrail_LengthClampsToMax12()
    {
        Handle("CursorTrail", """{"enable":true,"length":99}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            SPI_SETMOUSETRAILS, 12, IntPtr.Zero, It.IsAny<int>()), Times.Once);
    }

    /// <summary>
    /// Verifies that setting the primary mouse button to left does not swap the mouse buttons.
    /// </summary>
    [Fact]
    public void SetPrimaryMouseButton_Left_DoesNotSwap()
    {
        Handle("SetPrimaryMouseButton", """{"primaryButton":"left"}""");

        _systemParamsMock.Verify(s => s.SwapMouseButton(false), Times.Once);
    }

    /// <summary>
    /// Verifies that ToggleMouseSonar enable calls SystemParametersInfo with SPI_SETMOUSESONAR and value 1.
    /// </summary>
    [Fact]
    public void ToggleMouseSonar_Enable_SetsSonar1()
    {
        Handle("ToggleMouseSonar", """{"enable":true}""");

        _systemParamsMock.Verify(s => s.SetParameter(SPI_SETMOUSESONAR, 0, (IntPtr)1, SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    /// <summary>
    /// Verifies that ToggleMouseSonar disable calls SystemParametersInfo with SPI_SETMOUSESONAR and value 0.
    /// </summary>
    [Fact]
    public void ToggleMouseSonar_Disable_SetsSonar0()
    {
        Handle("ToggleMouseSonar", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.SetParameter(SPI_SETMOUSESONAR, 0, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region TaskbarSettingsHandler

public class TaskbarSettingsHandlerTests
{
    private const string StuckRects3 = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3";

    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly TaskbarSettingsHandler _handler;

    public TaskbarSettingsHandlerTests()
    {
        _handler = new TaskbarSettingsHandler(_registryMock.Object, new Mock<IProcessService>().Object);
    }

    /// <summary>
    /// Verifies that enabling taskbar auto-hide sets the auto-hide bit in the StuckRects3 binary settings.
    /// </summary>
    [Fact]
    public void AutoHideTaskbar_Enable_SetsAutoHideBit()
    {
        byte[] settings = new byte[9];
        _registryMock.Setup(r => r.GetValue(StuckRects3, "Settings", null)).Returns(settings);

        Handle("AutoHideTaskbar", """{"hideWhenNotUsing":true}""");

        _registryMock.Verify(r => r.SetValue(StuckRects3, "Settings",
            It.Is<byte[]>(b => (b[8] & 0x01) == 0x01), RegistryValueKind.Binary), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling taskbar auto-hide clears the auto-hide bit in the StuckRects3 binary settings.
    /// </summary>
    [Fact]
    public void AutoHideTaskbar_Disable_ClearsAutoHideBit()
    {
        byte[] settings = new byte[9];
        settings[8] = 0x01; // start with auto-hide on
        _registryMock.Setup(r => r.GetValue(StuckRects3, "Settings", null)).Returns(settings);

        Handle("AutoHideTaskbar", """{"hideWhenNotUsing":false}""");

        _registryMock.Verify(r => r.SetValue(StuckRects3, "Settings",
            It.Is<byte[]>(b => (b[8] & 0x01) == 0x00), RegistryValueKind.Binary), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling seconds in the system tray clock sets ShowSecondsInSystemClock to 1.
    /// </summary>
    [Fact]
    public void DisplaySecondsInSystrayClock_Enable_SetsShowSeconds1()
    {
        Handle("DisplaySecondsInSystrayClock", """{"enable":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "ShowSecondsInSystemClock", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling seconds in the system tray clock sets ShowSecondsInSystemClock to 0.
    /// </summary>
    [Fact]
    public void DisplaySecondsInSystrayClock_Disable_SetsShowSeconds0()
    {
        Handle("DisplaySecondsInSystrayClock", """{"enable":false}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "ShowSecondsInSystemClock", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling taskbar on all monitors sets MMTaskbarEnabled to 1.
    /// </summary>
    [Fact]
    public void DisplayTaskbarOnAllMonitors_Enable_SetsMMTaskbar1()
    {
        Handle("DisplayTaskbarOnAllMonitors", """{"enable":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "MMTaskbarEnabled", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling taskbar on all monitors sets MMTaskbarEnabled to 0.
    /// </summary>
    [Fact]
    public void DisplayTaskbarOnAllMonitors_Disable_SetsMMTaskbar0()
    {
        Handle("DisplayTaskbarOnAllMonitors", """{"enable":false}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "MMTaskbarEnabled", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling badges on the taskbar sets TaskbarBadges to 1.
    /// </summary>
    [Fact]
    public void ShowBadgesOnTaskbar_Enable_SetsBadges1()
    {
        Handle("ShowBadgesOnTaskbar", """{"enableBadging":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarBadges", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling badges on the taskbar sets TaskbarBadges to 0.
    /// </summary>
    [Fact]
    public void ShowBadgesOnTaskbar_Disable_SetsBadges0()
    {
        Handle("ShowBadgesOnTaskbar", """{"enableBadging":false}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarBadges", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that setting taskbar alignment to center sets TaskbarAl to 1.
    /// </summary>
    [Fact]
    public void TaskbarAlignment_Center_SetsTaskbarAl1()
    {
        Handle("TaskbarAlignment", """{"alignment":"center"}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAl", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that setting taskbar alignment to left sets TaskbarAl to 0.
    /// </summary>
    [Fact]
    public void TaskbarAlignment_Left_SetsTaskbarAl0()
    {
        Handle("TaskbarAlignment", """{"alignment":"left"}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAl", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that showing the Task View button sets ShowTaskViewButton to 1.
    /// </summary>
    [Fact]
    public void TaskViewVisibility_Show_SetsButton1()
    {
        Handle("TaskViewVisibility", """{"visibility":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "ShowTaskViewButton", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that hiding the Task View button sets ShowTaskViewButton to 0.
    /// </summary>
    [Fact]
    public void TaskViewVisibility_Hide_SetsButton0()
    {
        Handle("TaskViewVisibility", """{"visibility":false}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "ShowTaskViewButton", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that showing the widgets button sets TaskbarDa to 1.
    /// </summary>
    [Fact]
    public void ToggleWidgetsButtonVisibility_Show_SetsTaskbarDa1()
    {
        Handle("ToggleWidgetsButtonVisibility", """{"visibility":"show"}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarDa", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that hiding the widgets button sets TaskbarDa to 0.
    /// </summary>
    [Fact]
    public void ToggleWidgetsButtonVisibility_Hide_SetsTaskbarDa0()
    {
        Handle("ToggleWidgetsButtonVisibility", """{"visibility":"hide"}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarDa", 0, RegistryValueKind.DWord), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region DisplaySettingsHandler

public class DisplaySettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IBrightnessService> _brightnessMock = new();
    private readonly DisplaySettingsHandler _handler;

    public DisplaySettingsHandlerTests()
    {
        _handler = new DisplaySettingsHandler(_registryMock.Object, _processMock.Object, _brightnessMock.Object, new Mock<ILogger>().Object);
    }

    /// <summary>
    /// Verifies that AdjustColorTemperature opens the night light settings page.
    /// </summary>
    [Fact]
    public void AdjustColorTemperature_OpensNightLightSettings()
    {
        Handle("AdjustColorTemperature", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:nightlight"), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustScreenOrientation opens the display settings page.
    /// </summary>
    [Fact]
    public void AdjustScreenOrientation_OpensDisplaySettings()
    {
        Handle("AdjustScreenOrientation", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that DisplayResolutionAndAspectRatio opens the display settings page.
    /// </summary>
    [Fact]
    public void DisplayResolutionAndAspectRatio_OpensDisplaySettings()
    {
        Handle("DisplayResolutionAndAspectRatio", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that DisplayScaling with a valid percentage opens the display settings page.
    /// </summary>
    [Fact]
    public void DisplayScaling_WithPercentage_OpensDisplaySettings()
    {
        Handle("DisplayScaling", """{"sizeOverride":"150"}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling the blue light filter schedule writes the enable byte pattern to the registry.
    /// </summary>
    [Fact]
    public void EnableBlueLightFilterSchedule_Enable_WritesEnableBytes()
    {
        Handle("EnableBlueLightFilterSchedule", """{"nightLightScheduleDisabled":false}""");

        _registryMock.Verify(r => r.SetValue(
            It.Is<string>(s => s.Contains("bluelightreduction")),
            "Data",
            It.Is<byte[]>(b => b.Length == 4 && b[3] == 0x01),
            RegistryValueKind.Binary), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling the blue light filter schedule writes the disable byte pattern to the registry.
    /// </summary>
    [Fact]
    public void EnableBlueLightFilterSchedule_Disable_WritesDisableBytes()
    {
        Handle("EnableBlueLightFilterSchedule", """{"nightLightScheduleDisabled":true}""");

        _registryMock.Verify(r => r.SetValue(
            It.Is<string>(s => s.Contains("bluelightreduction")),
            "Data",
            It.Is<byte[]>(b => b.Length == 4 && b[3] == 0x00),
            RegistryValueKind.Binary), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling rotation lock sets RotationLockPreference to 1.
    /// </summary>
    [Fact]
    public void RotationLock_Enable_SetsPreference1()
    {
        Handle("RotationLock", """{"enable":true}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell", "RotationLockPreference", 1, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling rotation lock sets RotationLockPreference to 0.
    /// </summary>
    [Fact]
    public void RotationLock_Disable_SetsPreference0()
    {
        Handle("RotationLock", """{"enable":false}""");
        _registryMock.Verify(r => r.SetValue(@"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell", "RotationLockPreference", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that increasing brightness adds 10 to the current brightness level.
    /// </summary>
    [Fact]
    public void AdjustScreenBrightness_Increase_SetsBrightnessPlus10()
    {
        _brightnessMock.Setup(b => b.GetCurrentBrightness()).Returns(50);
        Handle("AdjustScreenBrightness", """{"brightnessLevel":"increase"}""");

        _brightnessMock.Verify(b => b.SetBrightness(60), Times.Once);
    }

    /// <summary>
    /// Verifies that decreasing brightness subtracts 10 from the current brightness level.
    /// </summary>
    [Fact]
    public void AdjustScreenBrightness_Decrease_SetsBrightnessMinus10()
    {
        _brightnessMock.Setup(b => b.GetCurrentBrightness()).Returns(50);

        Handle("AdjustScreenBrightness", """{"brightnessLevel":"decrease"}""");

        _brightnessMock.Verify(b => b.SetBrightness(40), Times.Once);
    }

    /// <summary>
    /// Verifies that decreasing brightness is clamped to a minimum of 0.
    /// </summary>
    [Fact]
    public void AdjustScreenBrightness_Decrease_ClampsToZero()
    {
        _brightnessMock.Setup(b => b.GetCurrentBrightness()).Returns(5);

        Handle("AdjustScreenBrightness", """{"brightnessLevel":"decrease"}""");

        _brightnessMock.Verify(b => b.SetBrightness(0), Times.Once);
    }

    /// <summary>
    /// Verifies that increasing brightness is clamped to a maximum of 100.
    /// </summary>
    [Fact]
    public void AdjustScreenBrightness_Increase_ClampsTo100()
    {
        _brightnessMock.Setup(b => b.GetCurrentBrightness()).Returns(95);

        Handle("AdjustScreenBrightness", """{"brightnessLevel":"increase"}""");

        _brightnessMock.Verify(b => b.SetBrightness(100), Times.Once);
    }

    /// <summary>
    /// Verifies that DisplayScaling at 125% opens the display settings page.
    /// </summary>
    [Fact]
    public void DisplayScaling_125Percent_OpensSettings()
    {
        Handle("DisplayScaling", """{"sizeOverride":"125"}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that DisplayScaling with non-numeric input does not open any settings page.
    /// </summary>
    [Fact]
    public void DisplayScaling_InvalidInput_DoesNotOpenSettings()
    {
        Handle("DisplayScaling", """{"sizeOverride":"abc"}""");

        _processMock.Verify(p => p.StartShellExecute(It.IsAny<string>()), Times.Never);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion

#region SystemSettingsHandler

public class SystemSettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly SystemSettingsHandler _handler;

    public SystemSettingsHandlerTests()
    {
        _handler = new SystemSettingsHandler(_registryMock.Object, _processMock.Object);
    }

    /// <summary>
    /// Verifies that AutomaticTimeSettingAction opens the date and time settings page.
    /// </summary>
    [Fact]
    public void AutomaticTimeSettingAction_OpensDateTimeSettings()
    {
        Handle("AutomaticTimeSettingAction", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:dateandtime"), Times.Once);
    }

    /// <summary>
    /// Verifies that EnableGameMode opens the gaming game mode settings page.
    /// </summary>
    [Fact]
    public void EnableGameMode_OpensGamingSettings()
    {
        Handle("EnableGameMode", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:gaming-gamemode"), Times.Once);
    }

    /// <summary>
    /// Verifies that EnableQuietHours opens the quiet hours settings page.
    /// </summary>
    [Fact]
    public void EnableQuietHours_OpensQuietHoursSettings()
    {
        Handle("EnableQuietHours", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:quiethours"), Times.Once);
    }

    /// <summary>
    /// Verifies that MinimizeWindowsOnMonitorDisconnectAction opens the display settings page.
    /// </summary>
    [Fact]
    public void MinimizeWindowsOnMonitorDisconnectAction_OpensDisplaySettings()
    {
        Handle("MinimizeWindowsOnMonitorDisconnectAction", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that RememberWindowLocations opens the display settings page.
    /// </summary>
    [Fact]
    public void RememberWindowLocations_OpensDisplaySettings()
    {
        Handle("RememberWindowLocations", "{}");
        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    /// <summary>
    /// Verifies that enabling automatic DST adjustment sets DynamicDaylightTimeDisabled to 0.
    /// </summary>
    [Fact]
    public void AutomaticDSTAdjustment_Enable_SetsRegistryValue()
    {
        Handle("AutomaticDSTAdjustment", """{"enable":true}""");
        _registryMock.Verify(r => r.SetValueLocalMachine(
            @"SYSTEM\CurrentControlSet\Control\TimeZoneInformation",
            "DynamicDaylightTimeDisabled", 0, RegistryValueKind.DWord), Times.Once);
    }

    /// <summary>
    /// Verifies that disabling automatic DST adjustment sets DynamicDaylightTimeDisabled to 1.
    /// </summary>
    [Fact]
    public void AutomaticDSTAdjustment_Disable_SetsRegistryValue()
    {
        Handle("AutomaticDSTAdjustment", """{"enable":false}""");
        _registryMock.Verify(r => r.SetValueLocalMachine(
            @"SYSTEM\CurrentControlSet\Control\TimeZoneInformation",
            "DynamicDaylightTimeDisabled", 1, RegistryValueKind.DWord), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, JsonDocument.Parse(jsonValue).RootElement);
    }
}

#endregion
