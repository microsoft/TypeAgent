# AutoShell

A Windows shell automation console application that provides a JSON-based command interface for controlling Windows applications, audio settings, themes, and window management.

## Overview

AutoShell is part of the [TypeAgent](https://github.com/microsoft/TypeAgent) project. It runs as a console application that reads JSON commands from stdin and executes Windows shell operations. This enables programmatic control of the Windows desktop environment.

## Features

- **Application Management**: Launch, close, and switch between applications using friendly names
- **Window Management**: Maximize, minimize, and tile windows side-by-side
- **Audio Control**: Set volume levels, mute/unmute, and restore previous volume
- **Theme & Personalization**: Apply themes, set wallpaper, toggle transparency, and configure title bar colors
- **Virtual Desktop Management**: Create, switch, pin, and move windows across virtual desktops
- **Display Settings**: Set resolution, brightness, scaling, orientation, color temperature, and blue light filter
- **Network & Connectivity**: Wi-Fi, Bluetooth, airplane mode, and metered connection controls
- **Mouse & Touchpad**: Cursor speed, pointer size, scroll lines, touchpad settings, and cursor trail
- **Taskbar Customization**: Alignment, auto-hide, badges, Task View, Widgets, and multi-monitor display
- **Accessibility**: Narrator, Magnifier, Sticky Keys, Filter Keys, and mono audio
- **Privacy Controls**: Manage camera, microphone, and location access
- **Power Management**: Battery saver levels and power mode configuration
- **System Settings**: Notifications, game mode, focus assist, time settings, and multi-monitor behavior
- **File Explorer**: Toggle file extensions and hidden/system file visibility

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
| `ApplyTheme` | Theme name | Applies a Windows theme |
| `CloseProgram` | Application name | Closes an application |
| `ConnectWifi` | `{"ssid": "name", "password": "pass"}` | Connects to a Wi-Fi network |
| `CreateDesktop` | JSON array of names | Creates one or more virtual desktops |
| `Debug` | (none) | Launches the debugger |
| `DisconnectWifi` | (none) | Disconnects from the current Wi-Fi network |
| `LaunchProgram` | Application name | Opens an application (or raises if already running) |
| `ListAppNames` | (none) | Outputs installed applications as JSON |
| `ListResolutions` | (none) | Outputs available display resolutions as JSON |
| `ListThemes` | (none) | Outputs installed themes as JSON |
| `ListWifiNetworks` | (none) | Lists available Wi-Fi networks as JSON |
| `Maximize` | Application name | Maximizes the application window |
| `Minimize` | Application name | Minimizes the application window |
| `MoveWindowToDesktop` | `{"process": "app", "desktop": "name"}` | Moves a window to a specific virtual desktop |
| `Mute` | `true`/`false` | Mutes or unmutes system audio |
| `NextDesktop` | (none) | Switches to the next virtual desktop |
| `PinWindow` | Application name | Pins a window to appear on all virtual desktops |
| `PreviousDesktop` | (none) | Switches to the previous virtual desktop |
| `quit` | (none) | Exits the application |
| `RestoreVolume` | (none) | Restores previously saved volume level |
| `SetScreenResolution` | `"WIDTHxHEIGHT"` or `{"width": W, "height": H}` | Sets the display resolution |
| `SetTextSize` | `100-225` | Sets system text scaling percentage |
| `SetThemeMode` | `"light"`, `"dark"`, `"toggle"`, or boolean | Sets light/dark mode |
| `SetWallpaper` | File path | Sets the desktop wallpaper |
| `SwitchDesktop` | Index or name | Switches to a virtual desktop by index or name |
| `SwitchTo` | Application name | Brings application window to foreground |
| `Tile` | `"app1,app2"` | Tiles two applications side-by-side |
| `ToggleAirplaneMode` | `true`/`false` | Enables or disables Windows airplane mode |
| `ToggleNotifications` | (none) | Toggles the Windows notification center |
| `Volume` | `0-100` | Sets system volume percentage |

#### Settings Commands

##### Network Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `BluetoothToggle` | `true`/`false` | Toggles Bluetooth on/off |
| `EnableMeteredConnections` | `true`/`false` | Enables or disables metered connections |
| `EnableWifi` | `true`/`false` | Enables or disables Wi-Fi |

##### Display Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AdjustColorTemperature` | value | Adjusts color temperature |
| `AdjustScreenBrightness` | value | Adjusts screen brightness |
| `AdjustScreenOrientation` | value | Adjusts screen orientation |
| `DisplayResolutionAndAspectRatio` | value | Sets display resolution and aspect ratio |
| `DisplayScaling` | value | Sets display scaling |
| `EnableBlueLightFilterSchedule` | `true`/`false` | Enables or disables blue light filter schedule |
| `RotationLock` | `true`/`false` | Enables or disables rotation lock |

##### Personalization Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ApplyColorToTitleBar` | `true`/`false` | Applies accent color to title bars |
| `EnableTransparency` | `true`/`false` | Enables or disables transparency effects |
| `HighContrastTheme` | value | Sets high contrast theme |
| `SystemThemeMode` | value | Sets the system theme mode |

##### Taskbar Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutoHideTaskbar` | `true`/`false` | Auto-hides the taskbar |
| `DisplaySecondsInSystrayClock` | `true`/`false` | Shows seconds in system tray clock |
| `DisplayTaskbarOnAllMonitors` | `true`/`false` | Displays taskbar on all monitors |
| `ShowBadgesOnTaskbar` | `true`/`false` | Shows or hides badges on taskbar |
| `TaskbarAlignment` | value | Sets taskbar alignment |
| `TaskViewVisibility` | `true`/`false` | Shows or hides Task View button |
| `ToggleWidgetsButtonVisibility` | `true`/`false` | Shows or hides Widgets button |

##### Mouse & Touchpad Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AdjustMousePointerSize` | value | Adjusts mouse pointer size |
| `CursorTrail` | `{"enable": true/false, "length": 2-12}` | Enables/disables cursor trail (length: 2–12) |
| `EnableTouchPad` | `true`/`false` | Enables or disables touchpad |
| `EnhancePointerPrecision` | `true`/`false` | Enables or disables pointer precision |
| `MouseCursorSpeed` | value | Sets mouse cursor speed |
| `MousePointerCustomization` | value | Customizes mouse pointer |
| `MouseWheelScrollLines` | value | Sets mouse wheel scroll lines |
| `SetPrimaryMouseButton` | value | Sets primary mouse button (left/right) |
| `TouchpadCursorSpeed` | value | Sets touchpad cursor speed |

##### Privacy Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ManageCameraAccess` | `true`/`false` | Manages camera access |
| `ManageLocationAccess` | `true`/`false` | Manages location access |
| `ManageMicrophoneAccess` | `true`/`false` | Manages microphone access |

##### Power Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `BatterySaverActivationLevel` | value | Sets battery saver activation level |
| `SetPowerModeOnBattery` | value | Sets power mode on battery |
| `SetPowerModePluggedIn` | value | Sets power mode when plugged in |

##### Accessibility Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `EnableFilterKeysAction` | `true`/`false` | Enables or disables Filter Keys |
| `EnableMagnifier` | `true`/`false` | Enables or disables Magnifier |
| `EnableNarratorAction` | `true`/`false` | Enables or disables Narrator |
| `EnableStickyKeys` | `true`/`false` | Enables or disables Sticky Keys |
| `MonoAudioToggle` | `true`/`false` | Toggles mono audio |

##### File Explorer Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ShowFileExtensions` | `true`/`false` | Shows or hides file extensions |
| `ShowHiddenAndSystemFiles` | `true`/`false` | Shows or hides hidden and system files |

##### System Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutomaticDSTAdjustment` | `true`/`false` | Enables or disables automatic DST adjustment |
| `AutomaticTimeSettingAction` | `true`/`false` | Enables or disables automatic time setting |
| `EnableGameMode` | `true`/`false` | Enables or disables game mode |
| `EnableQuietHours` | `true`/`false` | Enables or disables quiet hours |
| `MinimizeWindowsOnMonitorDisconnectAction` | `true`/`false` | Minimizes windows when monitor disconnects |
| `RememberWindowLocations` | `true`/`false` | Remembers window locations per monitor |

### Examples

Launch a program:
```json
{"LaunchProgram": "notepad"} 
```

Set the system volume at 50%:
```json
{"Volume": 50} 
```

Tile notepad on the left and calculator on the right of the screen:
```json
{"Tile": "notepad,calculator"} 
```

Apply the 'dark' Windows theme:
```json
{"ApplyTheme": "dark"} 
```

Set dark mode:
```json
{"SetThemeMode": "dark"}
```

Toggle between light and dark mode:
```json
{"SetThemeMode": "toggle"}
```

Mute the system audio:
```json
{"Mute": true} 
```

Set the desktop wallpaper and then quit AutoShell:
```json
{"SetWallpaper": "C:\\Users\\Public\\Pictures\\wallpaper.jpg"} {"quit": true}
```

Create a new virtual desktop named "Design Work":
```json
{"CreateDesktop": "Design Work"}
```

Toggle the Windows notification center:
```json
{"ToggleNotifications": true}
```

Enable airplane mode:
```json
{"ToggleAirplaneMode": true}
```

Disable airplane mode:
```json
{"ToggleAirplaneMode": false}
```

List available Wi-Fi networks:
```json
{"ListWifiNetworks": true}
```

Connect to a Wi-Fi network:
```json
{"ConnectWifi": {"ssid": "MyNetwork", "password": "MyPassword123"}}
```

Set system text size to 125%:
```json
{"SetTextSize": 125}
```

List available display resolutions:
```json
{"ListResolutions": true}
```

Set display resolution to 1920x1080:
```json
{"SetScreenResolution": "1920x1080"}
```

Set display resolution with specific refresh rate:
```json
{"SetScreenResolution": "1920x1080@144"}
```

Set display resolution using JSON object:
```json
{"SetScreenResolution": {"width": 2560, "height": 1440, "refreshRate": 60}}
```

Enable cursor trail with length 7:
```json
{"CursorTrail": "{\"enable\":true,\"length\":7}"}
```

Disable cursor trail:
```json
{"CursorTrail": "{\"enable\":false}"}
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

AutoShell uses a handler-based architecture with dependency injection. All platform-specific (P/Invoke, COM, WMI) code is isolated behind service interfaces, keeping handlers thin and fully unit-testable.

```
autoShell/
├── AutoShell.cs              # Entry point — stdin/stdout command loop
├── CommandDispatcher.cs      # Routes JSON keys to handlers; Create() wires all dependencies
├── CoreAudioInterop.cs       # COM interop definitions for Windows audio
├── UIAutomation.cs           # UI Automation helpers (last-resort, marked [Obsolete])
├── Handlers/
│   ├── ICommandHandler.cs    # Handler interface (SupportedCommands + Handle)
│   ├── AppCommandHandler.cs          # LaunchProgram, CloseProgram, ListAppNames
│   ├── AudioCommandHandler.cs        # Volume, Mute, RestoreVolume
│   ├── DisplayCommandHandler.cs      # SetScreenResolution, ListResolutions, SetTextSize
│   ├── NetworkCommandHandler.cs      # ConnectWifi, ToggleAirplaneMode, etc.
│   ├── SystemCommandHandler.cs       # Debug, ToggleNotifications
│   ├── ThemeCommandHandler.cs        # ApplyTheme, ListThemes, SetThemeMode, SetWallpaper
│   ├── VirtualDesktopCommandHandler.cs  # CreateDesktop, SwitchDesktop, PinWindow, etc.
│   ├── WindowCommandHandler.cs       # Maximize, Minimize, SwitchTo, Tile
│   └── Settings/
│       ├── AccessibilitySettingsHandler.cs
│       ├── DisplaySettingsHandler.cs
│       ├── FileExplorerSettingsHandler.cs
│       ├── MouseSettingsHandler.cs
│       ├── PersonalizationSettingsHandler.cs
│       ├── PowerSettingsHandler.cs
│       ├── PrivacySettingsHandler.cs
│       ├── SystemSettingsHandler.cs
│       └── TaskbarSettingsHandler.cs
├── Services/                 # Interfaces + Windows implementations
│   ├── IAppRegistry.cs / WindowsAppRegistry.cs
│   ├── IAudioService.cs / WindowsAudioService.cs
│   ├── IBrightnessService.cs / WindowsBrightnessService.cs
│   ├── IDebuggerService.cs / WindowsDebuggerService.cs
│   ├── IDisplayService.cs / WindowsDisplayService.cs
│   ├── INetworkService.cs / WindowsNetworkService.cs
│   ├── IProcessService.cs / WindowsProcessService.cs
│   ├── IRegistryService.cs / WindowsRegistryService.cs
│   ├── ISystemParametersService.cs / WindowsSystemParametersService.cs
│   ├── IVirtualDesktopService.cs / WindowsVirtualDesktopService.cs
│   └── IWindowService.cs / WindowsWindowService.cs
└── Logging/
    ├── ILogger.cs            # Logging interface (Error, Warning, Debug)
    └── ConsoleLogger.cs      # Colored console + diagnostics output
```

### Key design decisions

- **CommandDispatcher.Create()** is the composition root — it creates all concrete services and wires them into handlers. Tests bypass this and inject mocks directly.
- **Handlers are thin** — they parse JSON parameters and delegate to services. No P/Invoke or COM code lives in handlers.
- **Services own all platform calls** — P/Invoke, COM, WMI, and registry access are encapsulated behind interfaces (`I*Service` / `Windows*Service`).
- **ILogger** abstracts all diagnostic output. `ConsoleLogger` preserves the original colored error/warning formatting.

## License

Copyright (c) Microsoft Corporation. Licensed under the MIT License.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
