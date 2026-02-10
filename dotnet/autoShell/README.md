# AutoShell

A Windows shell automation console application that provides a JSON-based command interface for controlling Windows applications, audio settings, themes, and window management.

## Overview

AutoShell is part of the [TypeAgent](https://github.com/microsoft/TypeAgent) project. It runs as a console application that reads JSON commands from stdin and executes Windows shell operations. This enables programmatic control of the Windows desktop environment.

## Features

- **Application Management**: Launch, close, and switch between applications using friendly names
- **Window Management**: Maximize, minimize, and tile windows side-by-side
- **Audio Control**: Set volume levels, mute/unmute, and restore previous volume
- **Theme Management**: List and apply Windows themes
- **Desktop Customization**: Set desktop wallpaper
- **Virtual Desktop Management**: Create new virtual desktops
- **Notification Center**: Toggle the Windows notification center
- **Airplane Mode Control**: Enable or disable Windows airplane mode
- **Wi-Fi Management**: Connect to Wi-Fi networks by SSID
- **Display Resolution**: List available resolutions and change display settings

## Requirements

- Windows 10/11
- .NET 8
- [Microsoft.WindowsAPICodePack.Shell](https://www.nuget.org/packages/Microsoft.WindowsAPICodePack.Shell) NuGet package
- [Newtonsoft.Json](https://www.nuget.org/packages/Newtonsoft.Json) NuGet package

## Building

dotnet build AutoShell.csproj

## Usage

Run the application and send JSON commands via stdin:

### Command Reference

#### Core Commands

| Command | Parameter | Description |
|---------|-----------|-------------|
| `applyTheme` | Theme name | Applies a Windows theme |
| `closeProgram` | Application name | Closes an application |
| `connectWifi` | `{"ssid": "name", "password": "pass"}` | Connects to a Wi-Fi network |
| `createDesktop` | JSON array of names | Creates one or more virtual desktops |
| `disconnectWifi` | (none) | Disconnects from the current Wi-Fi network |
| `launchProgram` | Application name | Opens an application (or raises if already running) |
| `listAppNames` | (none) | Outputs installed applications as JSON |
| `listResolutions` | (none) | Outputs available display resolutions as JSON |
| `listThemes` | (none) | Outputs installed themes as JSON |
| `listWifiNetworks` | (none) | Lists available Wi-Fi networks as JSON |
| `maximize` | Application name | Maximizes the application window |
| `minimize` | Application name | Minimizes the application window |
| `moveWindowToDesktop` | `{"process": "app", "desktop": "name"}` | Moves a window to a specific virtual desktop |
| `mute` | `true`/`false` | Mutes or unmutes system audio |
| `nextDesktop` | (none) | Switches to the next virtual desktop |
| `pinWindow` | Application name | Pins a window to appear on all virtual desktops |
| `previousDesktop` | (none) | Switches to the previous virtual desktop |
| `quit` | (none) | Exits the application |
| `restoreVolume` | (none) | Restores previously saved volume level |
| `setScreenResolution` | `"WIDTHxHEIGHT"` or `{"width": W, "height": H}` | Sets the display resolution |
| `setTextSize` | `100-225` | Sets system text scaling percentage |
| `setThemeMode` | `"light"`, `"dark"`, `"toggle"`, or boolean | Sets light/dark mode |
| `setWallpaper` | File path | Sets the desktop wallpaper |
| `switchDesktop` | Index or name | Switches to a virtual desktop by index or name |
| `switchTo` | Application name | Brings application window to foreground |
| `tile` | `"app1,app2"` | Tiles two applications side-by-side |
| `toggleAirplaneMode` | `true`/`false` | Enables or disables Windows airplane mode |
| `toggleNotifications` | (none) | Toggles the Windows notification center |
| `volume` | `0-100` | Sets system volume percentage |

#### Settings Commands

##### Network Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `BluetoothToggle` | `true`/`false` | Toggles Bluetooth on/off |
| `enableWifi` | `true`/`false` | Enables or disables Wi-Fi |
| `enableMeteredConnections` | `true`/`false` | Enables or disables metered connections |

##### Display Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AdjustScreenBrightness` | value | Adjusts screen brightness |
| `EnableBlueLightFilterSchedule` | `true`/`false` | Enables or disables blue light filter schedule |
| `adjustColorTemperature` | value | Adjusts color temperature |
| `DisplayScaling` | value | Sets display scaling |
| `AdjustScreenOrientation` | value | Adjusts screen orientation |
| `DisplayResolutionAndAspectRatio` | value | Sets display resolution and aspect ratio |
| `RotationLock` | `true`/`false` | Enables or disables rotation lock |

##### Personalization Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `SystemThemeMode` | value | Sets the system theme mode |
| `EnableTransparency` | `true`/`false` | Enables or disables transparency effects |
| `ApplyColorToTitleBar` | `true`/`false` | Applies accent color to title bars |
| `HighContrastTheme` | value | Sets high contrast theme |

##### Taskbar Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutoHideTaskbar` | `true`/`false` | Auto-hides the taskbar |
| `TaskbarAlignment` | value | Sets taskbar alignment |
| `TaskViewVisibility` | `true`/`false` | Shows or hides Task View button |
| `ToggleWidgetsButtonVisibility` | `true`/`false` | Shows or hides Widgets button |
| `ShowBadgesOnTaskbar` | `true`/`false` | Shows or hides badges on taskbar |
| `DisplayTaskbarOnAllMonitors` | `true`/`false` | Displays taskbar on all monitors |
| `DisplaySecondsInSystrayClock` | `true`/`false` | Shows seconds in system tray clock |

##### Mouse Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `MouseCursorSpeed` | value | Sets mouse cursor speed |
| `MouseWheelScrollLines` | value | Sets mouse wheel scroll lines |
| `setPrimaryMouseButton` | value | Sets primary mouse button (left/right) |
| `EnhancePointerPrecision` | `true`/`false` | Enables or disables pointer precision |
| `AdjustMousePointerSize` | value | Adjusts mouse pointer size |
| `mousePointerCustomization` | value | Customizes mouse pointer |

##### Touchpad Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `EnableTouchPad` | `true`/`false` | Enables or disables touchpad |
| `TouchpadCursorSpeed` | value | Sets touchpad cursor speed |

##### Privacy Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ManageMicrophoneAccess` | `true`/`false` | Manages microphone access |
| `ManageCameraAccess` | `true`/`false` | Manages camera access |
| `ManageLocationAccess` | `true`/`false` | Manages location access |

##### Power Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `BatterySaverActivationLevel` | value | Sets battery saver activation level |
| `setPowerModePluggedIn` | value | Sets power mode when plugged in |
| `SetPowerModeOnBattery` | value | Sets power mode on battery |

##### Gaming Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `enableGameMode` | `true`/`false` | Enables or disables game mode |

##### Accessibility Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `EnableNarratorAction` | `true`/`false` | Enables or disables Narrator |
| `EnableMagnifier` | `true`/`false` | Enables or disables Magnifier |
| `enableStickyKeys` | `true`/`false` | Enables or disables Sticky Keys |
| `EnableFilterKeysAction` | `true`/`false` | Enables or disables Filter Keys |
| `MonoAudioToggle` | `true`/`false` | Toggles mono audio |

##### File Explorer Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ShowFileExtensions` | `true`/`false` | Shows or hides file extensions |
| `ShowHiddenAndSystemFiles` | `true`/`false` | Shows or hides hidden and system files |

##### Time & Region Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutomaticTimeSettingAction` | `true`/`false` | Enables or disables automatic time setting |
| `AutomaticDSTAdjustment` | `true`/`false` | Enables or disables automatic DST adjustment |

##### Focus Assist Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `EnableQuietHours` | `true`/`false` | Enables or disables quiet hours |

##### Multi-Monitor Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `RememberWindowLocations` | `true`/`false` | Remembers window locations per monitor |
| `MinimizeWindowsOnMonitorDisconnectAction` | `true`/`false` | Minimizes windows when monitor disconnects |

### Examples

Launch a program:
```json
{"launchProgram": "notepad"} 
```

Set the system volume at 50%:
```json
{"volume": 50} 
```

Tile notepad on the left and calculator on the right of the screen:
```json
{"tile": "notepad,calculator"} 
```

Apply the 'dark' Windows theme:
```json
{"applyTheme": "dark"} 
```

Set dark mode:
```json
{"setThemeMode": "dark"}
```

Toggle between light and dark mode:
```json
{"setThemeMode": "toggle"}
```

Mute the system audio:
```json
{"mute": true} 
```

Set the desktop wallpaper and then quit AutoShell:
```json
{"setWallpaper": "C:\\Users\\Public\\Pictures\\wallpaper.jpg"} {"quit": true}
```

Create a new virtual desktop named "Design Work":
```json
{"createDesktop": "Design Work"}
```

Toggle the Windows notification center:
```json
{"toggleNotifications": true}
```

Enable airplane mode:
```json
{"toggleAirplaneMode": true}
```

Disable airplane mode:
```json
{"toggleAirplaneMode": false}
```

List available Wi-Fi networks:
```json
{"listWifiNetworks": true}
```

Connect to a Wi-Fi network:
```json
{"connectWifi": {"ssid": "MyNetwork", "password": "MyPassword123"}}
```

Set system text size to 125%:
```json
{"setTextSize": 125}
```

List available display resolutions:
```json
{"listResolutions": true}
```

Set display resolution to 1920x1080:
```json
{"setScreenResolution": "1920x1080"}
```

Set display resolution with specific refresh rate:
```json
{"setScreenResolution": "1920x1080@144"}
```

Set display resolution using JSON object:
```json
{"setScreenResolution": {"width": 2560, "height": 1440, "refreshRate": 60}}
```

### Supported Application Friendly Names

AutoShell recognizes these friendly names (case-insensitive):

- `chrome`, `edge`, `microsoft edge`
- `word`, `winword`, `excel`, `powerpoint`, `power point`, `outlook`
- `visual studio`, `visual studio code`
- `notepad`, `paint`, `paint 3d`, `calculator`
- `file explorer`, `control panel`, `task manager`
- `cmd`, `powershell`
- `snipping tool`, `magnifier`
- `spotify`, `copilot`, `m365 copilot`

Additionally, AutoShell automatically discovers all installed Windows Store applications by their display names.

## Architecture

The application is structured as a partial class across multiple files:

- `AutoShell.cs` - Main logic, application management, audio control
- `AutoShell_Themes.cs` - Windows theme management
- `AutoShell_Win32.cs` - Win32 API P/Invoke declarations
- `AutoShell_Settings.cs` - Windows settings management
- `UIAutomation.cs` - UI Automation helpers

## License

Copyright (c) Microsoft Corporation. Licensed under the MIT License.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
