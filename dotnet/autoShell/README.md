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

AutoShell runs in two modes:

**Interactive mode** (default): Run the application and send JSON commands via stdin, one per line:
```
dotnet run --project autoShell.csproj
{"Volume":50}
{"Mute":true}
{"quit":null}
```

**Command-line mode**: Pass a JSON command (or array) as an argument for one-shot execution:
```
autoShell.exe {"Volume":50}
autoShell.exe [{"Volume":50},{"Mute":true}]
```

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
| `BluetoothToggle` | `{"enableBluetooth": true/false}` | Toggles Bluetooth on/off |
| `EnableMeteredConnections` | (none) | Opens network status settings |
| `EnableWifi` | `{"enable": true/false}` | Enables or disables Wi-Fi |

##### Display Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AdjustColorTemperature` | (none) | Opens Night light settings |
| `AdjustScreenBrightness` | `{"brightnessLevel": "increase"/"decrease"}` | Adjusts screen brightness ±10% |
| `AdjustScreenOrientation` | (none) | Opens display settings |
| `DisplayResolutionAndAspectRatio` | (none) | Opens display settings |
| `DisplayScaling` | `{"sizeOverride": "150"}` | Opens display settings; targets a DPI percentage |
| `EnableBlueLightFilterSchedule` | `{"nightLightScheduleDisabled": true/false}` | Enables or disables blue light filter schedule |
| `RotationLock` | `{"enable": true/false}` | Enables or disables rotation lock |

##### Personalization Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ApplyColorToTitleBar` | `{"enableColor": true/false}` | Applies accent color to title bars |
| `EnableTransparency` | `{"enable": true/false}` | Enables or disables transparency effects |
| `HighContrastTheme` | (none) | Opens high contrast settings |
| `SystemThemeMode` | `{"mode": "light"/"dark"}` | Sets the system theme mode |

##### Taskbar Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutoHideTaskbar` | `{"hideWhenNotUsing": true/false}` | Auto-hides the taskbar |
| `DisplaySecondsInSystrayClock` | `{"enable": true/false}` | Shows seconds in system tray clock |
| `DisplayTaskbarOnAllMonitors` | `{"enable": true/false}` | Displays taskbar on all monitors |
| `ShowBadgesOnTaskbar` | `{"enableBadging": true/false}` | Shows or hides badges on taskbar |
| `TaskbarAlignment` | `{"alignment": "left"/"center"}` | Sets taskbar alignment |
| `TaskViewVisibility` | `{"visibility": true/false}` | Shows or hides Task View button |
| `ToggleWidgetsButtonVisibility` | `{"visibility": "show"/"hide"}` | Shows or hides Widgets button |

##### Mouse & Touchpad Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AdjustMousePointerSize` | (none) | Opens mouse pointer settings |
| `CursorTrail` | `{"enable": true/false, "length": 2-12}` | Enables/disables cursor trail (length: 2–12) |
| `EnableTouchPad` | (none) | Opens touchpad settings |
| `EnhancePointerPrecision` | `{"enable": true/false}` | Enables or disables pointer precision |
| `MouseCursorSpeed` | `{"speedLevel": 1-20}` | Sets mouse cursor speed (default 10) |
| `MousePointerCustomization` | (none) | Opens mouse pointer settings |
| `MouseWheelScrollLines` | `{"scrollLines": 1-100}` | Sets mouse wheel scroll lines (default 3) |
| `SetPrimaryMouseButton` | `{"primaryButton": "left"/"right"}` | Sets primary mouse button |
| `TouchpadCursorSpeed` | (none) | Opens touchpad settings |

##### Privacy Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ManageCameraAccess` | `{"accessSetting": "allow"/"deny"}` | Manages camera access |
| `ManageLocationAccess` | `{"accessSetting": "allow"/"deny"}` | Manages location access |
| `ManageMicrophoneAccess` | `{"accessSetting": "allow"/"deny"}` | Manages microphone access |

##### Power Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `BatterySaverActivationLevel` | `{"thresholdValue": 0-100}` | Sets battery saver activation level |
| `SetPowerModeOnBattery` | (none) | Opens power settings |
| `SetPowerModePluggedIn` | (none) | Opens power settings |

##### Accessibility Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `EnableFilterKeysAction` | (none) | Toggles Filter Keys |
| `EnableMagnifier` | (none) | Toggles Magnifier |
| `EnableNarratorAction` | (none) | Toggles Narrator |
| `EnableStickyKeys` | (none) | Toggles Sticky Keys |
| `MonoAudioToggle` | (none) | Toggles mono audio |

##### File Explorer Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `ShowFileExtensions` | `{"enable": true/false}` | Shows or hides file extensions |
| `ShowHiddenAndSystemFiles` | `{"enable": true/false}` | Shows or hides hidden and system files |

##### System Settings

| Command | Parameter | Description |
|---------|-----------|-------------|
| `AutomaticDSTAdjustment` | `{"enable": true/false}` | Enables or disables automatic DST adjustment |
| `AutomaticTimeSettingAction` | (none) | Opens date/time settings |
| `EnableGameMode` | (none) | Opens Game Mode settings |
| `EnableQuietHours` | (none) | Opens quiet hours / focus assist settings |
| `MinimizeWindowsOnMonitorDisconnectAction` | (none) | Opens display settings |
| `RememberWindowLocations` | (none) | Opens display settings |

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

Set the desktop wallpaper:
```json
{"SetWallpaper": "C:\\Users\\Public\\Pictures\\wallpaper.jpg"}
```

Quit AutoShell:
```json
{"quit": null}
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
├── IAppRegistry.cs           # App registry interface (shared across handlers)
├── WindowsAppRegistry.cs     # Maps friendly app names to paths and AppUserModelIDs
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
│   ├── IAudioService.cs / WindowsAudioService.cs
│   ├── IBrightnessService.cs / WindowsBrightnessService.cs
│   ├── IDebuggerService.cs / WindowsDebuggerService.cs
│   ├── IDisplayService.cs / WindowsDisplayService.cs
│   ├── INetworkService.cs / WindowsNetworkService.cs
│   ├── IProcessService.cs / WindowsProcessService.cs
│   ├── IRegistryService.cs / WindowsRegistryService.cs
│   ├── ISystemParametersService.cs / WindowsSystemParametersService.cs
│   ├── IVirtualDesktopService.cs / WindowsVirtualDesktopService.cs
│   ├── IWindowService.cs / WindowsWindowService.cs
│   └── Interop/
│       ├── CoreAudioInterop.cs   # COM interop definitions for Windows audio
│       └── UIAutomation.cs       # UI Automation helpers (last-resort)
├── Logging/
│   ├── ILogger.cs            # Logging interface (Error, Warning, Info, Debug)
│   └── ConsoleLogger.cs      # Colored console + diagnostics output
└── autoShell.Tests/          # unit, integration, and E2E tests
```

### Key design decisions

- **CommandDispatcher.Create()** is the composition root — it creates all concrete services and wires them into handlers. Tests bypass this and inject mocks directly.
- **Handlers are thin** — they parse JSON parameters and delegate to services. No P/Invoke or COM code lives in handlers.
- **Services own all platform calls** — P/Invoke, COM, WMI, and registry access are encapsulated behind interfaces (`I*Service` / `Windows*Service`).
- **ILogger** abstracts all diagnostic output with four levels: Error (red), Warning (yellow), Info (cyan), and Debug (diagnostics only). `ConsoleLogger` preserves the original colored formatting.

## License

Copyright (c) Microsoft Corporation. Licensed under the MIT License.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
