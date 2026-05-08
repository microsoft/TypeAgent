# screencapture

Screen capture and recording dispatcher agent. Takes screenshots and records the
screen on Windows and Linux (X11), including by program / window name.

## Prerequisites

This agent shells out to system binaries — they are **not** bundled.

| Tool      | Purpose                                 | Windows install                                                      | Linux install                                                                   |
| --------- | --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ffmpeg`  | All capture and recording               | `winget install Gyan.FFmpeg` (or download from <https://ffmpeg.org>) | `sudo apt install ffmpeg` / `sudo dnf install ffmpeg` / `sudo pacman -S ffmpeg` |
| `wmctrl`  | List visible windows (Linux only)       | _n/a_                                                                | `sudo apt install wmctrl`                                                       |
| `xdotool` | Per-window geometry lookup (Linux only) | _n/a_                                                                | `sudo apt install xdotool`                                                      |

If a required tool is missing the agent will surface an actionable install hint
the first time you invoke an action that needs it. Restart the shell / CLI
after installing.

## Platform support

- **Windows 10 / 11**: full screen and per-window capture via `gdigrab`. Window
  enumeration uses PowerShell `Get-Process` against `MainWindowTitle`.
- **Linux X11**: full screen and per-window capture via `x11grab`. Window
  enumeration uses `wmctrl -lp`; per-window geometry via `xdotool getwindowgeometry`.
- **Linux Wayland**: not supported in this version. The agent detects
  `XDG_SESSION_TYPE=wayland` and refuses with a clear message — switch to an
  X11 session at the login screen and try again.
- **macOS / other**: not supported.

## Build

From `ts/`:

```sh
pnpm --filter screencapture-agent build
```

## Running

Launch the [TypeAgent Shell](../../shell) or the [TypeAgent CLI](../../cli)
and enable the agent with `@config agent screencapture`. Example phrases:

- `take a screenshot`
- `screenshot Visual Studio Code`
- `take a screenshot of the desktop`
- `list open windows`
- `start recording`
- `record Chrome`
- `stop recording`

Captured files are stored under the agent's session storage
(`screenshots/` and `recordings/` siblings) and surfaced as entities in the
action result.

## Roadmap

The initial release focuses on capture correctness and cross-platform parity.
The following enhancements are tracked but not yet implemented:

- **Inline screenshot rendering**: show the captured image directly in the
  agent message bubble rather than only emitting a file path.
- **Copy to clipboard**: provide an affordance on the displayed image to copy
  it to the OS clipboard.
- **Open in OS image viewer**: clicking the displayed image launches the
  default image viewer for the host OS.
- **OS-standard save location**: also write a copy to the platform's default
  screenshots folder (`%USERPROFILE%\Pictures\Screenshots` on Windows,
  `~/Pictures` on Linux) in addition to session storage.
- **Region screenshot**: support a user-drawn rectangle.
- **Audio capture and webcam overlay**: parity with the Windows Game Bar
  recorder.
- **Wayland support**: best-effort capture via PipeWire / `wf-recorder`.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
