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

| Command | Parameter | Description |
|---------|-----------|-------------|
| `applyTheme` | Theme name | Applies a Windows theme |
| `closeProgram` | Application name | Closes an application |
| `connectWifi` | SSID | Connects to a Wi-Fi network by SSID |
| `createDesktop` | JSON array of names | Creates one or more virtual desktops |
| `disconnectWifi` | | Disconnects from the current Wi-Fi network |
| `launchProgram` | Application name | Opens an application (or raises if already running) |
| `listAppNames` | (none) | Outputs installed applications as JSON |
| `listThemes` | (none) | Outputs installed themes as JSON |
| `maximize` | Application name | Maximizes the application window |
| `minimize` | Application name | Minimizes the application window |
| `moveWindowToDesktop` | `{"process": "app", "desktop": "name"}` | Moves a window to a specific virtual desktop |
| `mute` | `true`/`false` | Mutes or unmutes system audio |
| `nextDesktop` | (none) | Switches to the next virtual desktop |
| `pinWindow` | Application name | Pins a window to appear on all virtual desktops |
| `previousDesktop` | (none) | Switches to the previous virtual desktop |
| `quit` | (none) | Exits the application |
| `restoreVolume` | (none) | Restores previously saved volume level |
| `setAirplaneMode` | `true`/`false` | Enables or disables Windows airplane mode |
| `setWallpaper` | File path | Sets the desktop wallpaper |
| `switchDesktop` | Index or name | Switches to a virtual desktop by index or name |
| `switchTo` | Application name | Brings application window to foreground |
| `tile` | `"app1,app2"` | Tiles two applications side-by-side |
| `toggleNotifications` | (none) | Toggles the Windows notification center |
| `volume` | `0-100` | Sets system volume percentage |

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

Connect to a Wi-Fi network:
```json
{"connectWifi": {"ssid": "MyNetwork", "password": "MyPassword123"}}
```

### Supported Application Friendly Names

AutoShell recognizes these friendly names (case-insensitive):

- `chrome`, `edge`, `microsoft edge`
- `word`, `winword`, `excel`, `powerpoint`, `outlook`
- `visual studio`, `visual studio code`
- `notepad`, `paint`, `calculator`
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

## License

Copyright (c) Microsoft Corporation. Licensed under the MIT License.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
