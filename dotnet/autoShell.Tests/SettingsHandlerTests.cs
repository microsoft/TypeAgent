// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Services;
using Microsoft.Win32;
using Moq;
using Newtonsoft.Json.Linq;

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

    [Fact]
    public void ApplyColorToTitleBar_Enable_SetsColorPrevalence1()
    {
        Handle("ApplyColorToTitleBar", """{"enableColor":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\DWM", "ColorPrevalence", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ApplyColorToTitleBar_Disable_SetsColorPrevalence0()
    {
        Handle("ApplyColorToTitleBar", """{"enableColor":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\DWM", "ColorPrevalence", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void EnableTransparency_Enable_SetsTransparency1()
    {
        Handle("EnableTransparency", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void EnableTransparency_Disable_SetsTransparency0()
    {
        Handle("EnableTransparency", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "EnableTransparency", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void SystemThemeMode_Light_SetsBothKeys()
    {
        Handle("SystemThemeMode", """{"mode":"light"}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void SystemThemeMode_Dark_SetsBothKeys()
    {
        Handle("SystemThemeMode", """{"mode":"dark"}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        _registryMock.Verify(r => r.SetValue(Path, "AppsUseLightTheme", 0, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "SystemUsesLightTheme", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void HighContrastTheme_OpensSettings()
    {
        Handle("HighContrastTheme", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-highcontrast"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
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

    [Fact]
    public void ManageCameraAccess_Deny_WritesDeny()
    {
        Handle("ManageCameraAccess", """{"accessSetting":"deny"}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
            "Value", "Deny", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void ManageCameraAccess_Allow_WritesAllow()
    {
        Handle("ManageCameraAccess", """{"accessSetting":"allow"}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
            "Value", "Allow", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void ManageMicrophoneAccess_Deny_WritesDeny()
    {
        Handle("ManageMicrophoneAccess", """{"accessSetting":"deny"}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
            "Value", "Deny", RegistryValueKind.String), Times.Once);
    }

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
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
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

    [Fact]
    public void ShowFileExtensions_Enable_SetsHideFileExt0()
    {
        Handle("ShowFileExtensions", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            "HideFileExt", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ShowFileExtensions_Disable_SetsHideFileExt1()
    {
        Handle("ShowFileExtensions", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            "HideFileExt", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ShowHiddenAndSystemFiles_Enable_SetsBothKeys()
    {
        Handle("ShowHiddenAndSystemFiles", """{"enable":true}""");

        const string Path = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
        _registryMock.Verify(r => r.SetValue(Path, "Hidden", 1, RegistryValueKind.DWord), Times.Once);
        _registryMock.Verify(r => r.SetValue(Path, "ShowSuperHidden", 1, RegistryValueKind.DWord), Times.Once);
    }

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
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
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

    [Fact]
    public void BatterySaverActivationLevel_SetsThreshold()
    {
        Handle("BatterySaverActivationLevel", """{"thresholdValue":30}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver",
            "ActivationThreshold", 30, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void SetPowerModeOnBattery_OpensSettings()
    {
        Handle("SetPowerModeOnBattery", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:powersleep"), Times.Once);
    }

    [Fact]
    public void SetPowerModePluggedIn_OpensSettings()
    {
        Handle("SetPowerModePluggedIn", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:powersleep"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion

#region AccessibilitySettingsHandler

public class AccessibilitySettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly AccessibilitySettingsHandler _handler;

    public AccessibilitySettingsHandlerTests()
    {
        _handler = new AccessibilitySettingsHandler(_registryMock.Object, _processMock.Object);
    }

    [Fact]
    public void EnableStickyKeys_Enable_SetsFlags510()
    {
        Handle("EnableStickyKeys", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags", "510", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void EnableStickyKeys_Disable_SetsFlags506()
    {
        Handle("EnableStickyKeys", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags", "506", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void EnableFilterKeysAction_Enable_SetsFlags2()
    {
        Handle("EnableFilterKeysAction", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags", "2", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void EnableFilterKeysAction_Disable_SetsFlags126()
    {
        Handle("EnableFilterKeysAction", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags", "126", RegistryValueKind.String), Times.Once);
    }

    [Fact]
    public void MonoAudioToggle_Enable_SetsMonoMix1()
    {
        Handle("MonoAudioToggle", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Multimedia\Audio",
            "AccessibilityMonoMixState", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void EnableMagnifier_Enable_StartsProcess()
    {
        Handle("EnableMagnifier", """{"enable":true}""");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "magnify.exe")), Times.Once);
    }

    [Fact]
    public void EnableNarratorAction_Enable_StartsNarrator()
    {
        Handle("EnableNarratorAction", """{"enable":true}""");

        _processMock.Verify(p => p.Start(It.Is<ProcessStartInfo>(
            psi => psi.FileName == "narrator.exe")), Times.Once);
    }

    [Fact]
    public void EnableNarratorAction_Disable_CallsGetProcessesByName()
    {
        _processMock.Setup(p => p.GetProcessesByName("Narrator")).Returns([]);

        Handle("EnableNarratorAction", """{"enable":false}""");

        _processMock.Verify(p => p.GetProcessesByName("Narrator"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion

#region MouseSettingsHandler

public class MouseSettingsHandlerTests
{
    private readonly Mock<ISystemParametersService> _systemParamsMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly MouseSettingsHandler _handler;

    public MouseSettingsHandlerTests()
    {
        _handler = new MouseSettingsHandler(_systemParamsMock.Object, _processMock.Object);
    }

    [Fact]
    public void MouseCursorSpeed_SetsSpeed()
    {
        Handle("MouseCursorSpeed", """{"speedLevel":10}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            0x0071, 0, (IntPtr)10, 3), Times.Once);
    }

    [Fact]
    public void MouseWheelScrollLines_SetsLines()
    {
        Handle("MouseWheelScrollLines", """{"scrollLines":5}""");

        _systemParamsMock.Verify(s => s.SetParameter(
            0x0069, 5, IntPtr.Zero, 3), Times.Once);
    }

    [Fact]
    public void EnhancePointerPrecision_Enable()
    {
        Handle("EnhancePointerPrecision", """{"enable":true}""");

        _systemParamsMock.Verify(s => s.GetParameter(3, 0, It.IsAny<int[]>(), 0), Times.Once);
        _systemParamsMock.Verify(s => s.SetParameter(
            4, 0, It.Is<int[]>(a => a[2] == 1), 3), Times.Once);
    }

    [Fact]
    public void EnhancePointerPrecision_Disable()
    {
        Handle("EnhancePointerPrecision", """{"enable":false}""");

        _systemParamsMock.Verify(s => s.GetParameter(3, 0, It.IsAny<int[]>(), 0), Times.Once);
        _systemParamsMock.Verify(s => s.SetParameter(
            4, 0, It.Is<int[]>(a => a[2] == 0), 3), Times.Once);
    }

    [Fact]
    public void AdjustMousePointerSize_OpensMouseSettings()
    {
        Handle("AdjustMousePointerSize", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-mouse"), Times.Once);
    }

    [Fact]
    public void EnableTouchPad_OpensTouchpadSettings()
    {
        Handle("EnableTouchPad", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:devices-touchpad"), Times.Once);
    }

    [Fact]
    public void MousePointerCustomization_OpensMouseSettings()
    {
        Handle("MousePointerCustomization", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:easeofaccess-mouse"), Times.Once);
    }

    [Fact]
    public void TouchpadCursorSpeed_OpensTouchpadSettings()
    {
        Handle("TouchpadCursorSpeed", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:devices-touchpad"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion

#region TaskbarSettingsHandler

public class TaskbarSettingsHandlerTests
{
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    private const string StuckRects3 = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3";

    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly TaskbarSettingsHandler _handler;

    public TaskbarSettingsHandlerTests()
    {
        _handler = new TaskbarSettingsHandler(_registryMock.Object);
    }

    [Fact]
    public void AutoHideTaskbar_Enable_SetsAutoHideBit()
    {
        byte[] settings = new byte[9];
        _registryMock.Setup(r => r.GetValue(StuckRects3, "Settings", null)).Returns(settings);

        Handle("AutoHideTaskbar", """{"hideWhenNotUsing":true}""");

        _registryMock.Verify(r => r.SetValue(StuckRects3, "Settings",
            It.Is<byte[]>(b => (b[8] & 0x01) == 0x01), RegistryValueKind.Binary), Times.Once);
    }

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

    [Fact]
    public void DisplaySecondsInSystrayClock_Enable_SetsShowSeconds1()
    {
        Handle("DisplaySecondsInSystrayClock", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "ShowSecondsInSystemClock", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void DisplaySecondsInSystrayClock_Disable_SetsShowSeconds0()
    {
        Handle("DisplaySecondsInSystrayClock", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "ShowSecondsInSystemClock", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void DisplayTaskbarOnAllMonitors_Enable_SetsMMTaskbar1()
    {
        Handle("DisplayTaskbarOnAllMonitors", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "MMTaskbarEnabled", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void DisplayTaskbarOnAllMonitors_Disable_SetsMMTaskbar0()
    {
        Handle("DisplayTaskbarOnAllMonitors", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "MMTaskbarEnabled", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ShowBadgesOnTaskbar_Enable_SetsBadges1()
    {
        Handle("ShowBadgesOnTaskbar", """{"enableBadging":true}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarBadges", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ShowBadgesOnTaskbar_Disable_SetsBadges0()
    {
        Handle("ShowBadgesOnTaskbar", """{"enableBadging":false}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarBadges", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void TaskbarAlignment_Center_SetsTaskbarAl1()
    {
        Handle("TaskbarAlignment", """{"alignment":"center"}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarAl", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void TaskbarAlignment_Left_SetsTaskbarAl0()
    {
        Handle("TaskbarAlignment", """{"alignment":"left"}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarAl", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void TaskViewVisibility_Show_SetsButton1()
    {
        Handle("TaskViewVisibility", """{"visibility":true}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "ShowTaskViewButton", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void TaskViewVisibility_Hide_SetsButton0()
    {
        Handle("TaskViewVisibility", """{"visibility":false}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "ShowTaskViewButton", 0, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ToggleWidgetsButtonVisibility_Show_SetsTaskbarDa1()
    {
        Handle("ToggleWidgetsButtonVisibility", """{"visibility":"show"}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarDa", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void ToggleWidgetsButtonVisibility_Hide_SetsTaskbarDa0()
    {
        Handle("ToggleWidgetsButtonVisibility", """{"visibility":"hide"}""");

        _registryMock.Verify(r => r.SetValue(ExplorerAdvanced,
            "TaskbarDa", 0, RegistryValueKind.DWord), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion

#region DisplaySettingsHandler

public class DisplaySettingsHandlerTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly DisplaySettingsHandler _handler;

    public DisplaySettingsHandlerTests()
    {
        _handler = new DisplaySettingsHandler(_registryMock.Object, _processMock.Object);
    }

    [Fact]
    public void AdjustColorTemperature_OpensNightLightSettings()
    {
        Handle("AdjustColorTemperature", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:nightlight"), Times.Once);
    }

    [Fact]
    public void AdjustScreenOrientation_OpensDisplaySettings()
    {
        Handle("AdjustScreenOrientation", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    [Fact]
    public void DisplayResolutionAndAspectRatio_OpensDisplaySettings()
    {
        Handle("DisplayResolutionAndAspectRatio", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    [Fact]
    public void DisplayScaling_WithPercentage_OpensDisplaySettings()
    {
        Handle("DisplayScaling", """{"sizeOverride":"150"}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

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

    [Fact]
    public void RotationLock_Enable_SetsPreference1()
    {
        Handle("RotationLock", """{"enable":true}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell",
            "RotationLockPreference", 1, RegistryValueKind.DWord), Times.Once);
    }

    [Fact]
    public void RotationLock_Disable_SetsPreference0()
    {
        Handle("RotationLock", """{"enable":false}""");

        _registryMock.Verify(r => r.SetValue(
            @"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell",
            "RotationLockPreference", 0, RegistryValueKind.DWord), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion

#region SystemSettingsHandler

public class SystemSettingsHandlerTests
{
    private readonly Mock<IProcessService> _processMock = new();
    private readonly SystemSettingsHandler _handler;

    public SystemSettingsHandlerTests()
    {
        _handler = new SystemSettingsHandler(_processMock.Object);
    }

    [Fact]
    public void AutomaticTimeSettingAction_OpensDateTimeSettings()
    {
        Handle("AutomaticTimeSettingAction", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:dateandtime"), Times.Once);
    }

    [Fact]
    public void EnableGameMode_OpensGamingSettings()
    {
        Handle("EnableGameMode", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:gaming-gamemode"), Times.Once);
    }

    [Fact]
    public void EnableQuietHours_OpensQuietHoursSettings()
    {
        Handle("EnableQuietHours", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:quiethours"), Times.Once);
    }

    [Fact]
    public void MinimizeWindowsOnMonitorDisconnectAction_OpensDisplaySettings()
    {
        Handle("MinimizeWindowsOnMonitorDisconnectAction", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    [Fact]
    public void RememberWindowLocations_OpensDisplaySettings()
    {
        Handle("RememberWindowLocations", """{}""");

        _processMock.Verify(p => p.StartShellExecute("ms-settings:display"), Times.Once);
    }

    private void Handle(string key, string jsonValue)
    {
        _handler.Handle(key, jsonValue, JObject.Parse(jsonValue));
    }
}

#endregion
