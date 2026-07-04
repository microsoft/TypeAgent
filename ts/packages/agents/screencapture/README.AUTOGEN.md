<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3b37c232369dbd851bee9cf26ab12613b1381c7e7f5072efb9ae8d7d586c9757 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# screencapture-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `screencapture-agent` is a TypeAgent application agent designed to handle screen capture and recording tasks. It supports taking screenshots and recording the screen on Windows and Linux (X11), with the ability to target specific application windows or capture the entire screen. The agent integrates with system-level tools like `ffmpeg`, `wmctrl`, and `xdotool` to perform its operations.

## What it does

The `screencapture-agent` provides the following actions:

- **`takeScreenshot`**: Captures a screenshot of the entire screen or a specific window. If a `target` parameter is provided, the agent attempts to match it to a visible window by name (e.g., "Chrome" or "Visual Studio").
- **`startRecording`**: Initiates a screen recording. Similar to `takeScreenshot`, the `target` parameter can specify a particular window or application to record.
- **`stopRecording`**: Stops the currently active screen recording.
- **`listWindows`**: Lists all currently visible windows, allowing users to identify and target specific windows by name.
- **`recording`**: Tracks the activity of an ongoing recording, including details such as the target, output file path, and start time.

Captured screenshots and recordings are saved in the agent's session storage under `screenshots/` and `recordings/` directories. These files are also surfaced as entities in the action results, making them accessible for further processing or sharing.

### Platform Support

- **Windows 10/11**: Supports full-screen and per-window capture using `gdigrab`. Window enumeration is performed via PowerShell's `Get-Process` command.
- **Linux (X11)**: Supports full-screen and per-window capture using `x11grab`. Window enumeration is achieved with `wmctrl -lp`, and per-window geometry is determined using `xdotool getwindowgeometry`.
- **Linux (Wayland)**: Not supported in this version. The agent detects `XDG_SESSION_TYPE=wayland` and provides a clear error message. Users are advised to switch to an X11 session.
- **macOS and other platforms**: Not supported.

## Setup

To use the `screencapture-agent`, you need to install specific system tools and configure environment variables.

### Required Tools

The agent relies on external system binaries for its operations. These tools are not bundled with the agent and must be installed separately.

#### Windows

- **`ffmpeg`**: Install using `winget install Gyan.FFmpeg` or download it from `https://ffmpeg.org`.

#### Linux

- **`ffmpeg`**: Install using your package manager:
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - Fedora: `sudo dnf install ffmpeg`
  - Arch Linux: `sudo pacman -S ffmpeg`
- **`wmctrl`**: Install using `sudo apt install wmctrl` (Debian/Ubuntu).
- **`xdotool`**: Install using `sudo apt install xdotool` (Debian/Ubuntu).

If any required tool is missing, the agent will provide an actionable installation hint when you attempt to use an action that depends on it.

### Environment Variables

The following environment variables must be set:

- `DISPLAY`: Required for graphical display on Linux systems.
- `XDG_SESSION_TYPE`: Must be set to `x11` for Linux systems. Wayland is not supported.

For more details on setting up these tools and environment variables, refer to the hand-written README.

## Key Files

The `screencapture-agent` is organized into several key files that define its functionality and structure:

- **[screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts)**: Implements the logic for all supported actions, including taking screenshots, starting/stopping recordings, and listing windows.
- **[screencaptureManifest.json](./src/screencaptureManifest.json)**: Defines the agent's manifest, including its description, schema, and capabilities.
- **[screencaptureSchema.ts](./src/screencaptureSchema.ts)**: Specifies the types and parameters for the actions, ensuring proper validation and execution.
- **[screencaptureSchema.agr](./src/screencaptureSchema.agr)**: Contains grammar rules that map user commands to specific actions.
- **[context.ts](./src/context.ts)**: Manages the agent's runtime context, including active recordings and tool installation states.
- **[platform/](./src/platform/)**: A directory containing platform-specific logic for Windows and Linux, such as tool detection, command execution, and window enumeration.

### Key Components

1. **Action Handler**: The [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file is the core of the agent, implementing the logic for each action. It interacts with platform-specific modules to execute tasks like capturing screenshots and managing recordings.
2. **Manifest and Schema**: The [screencaptureManifest.json](./src/screencaptureManifest.json) and [screencaptureSchema.ts](./src/screencaptureSchema.ts) files define the agent's capabilities and the structure of its actions.
3. **Grammar**: The [screencaptureSchema.agr](./src/screencaptureSchema.agr) file contains the grammar rules that enable the agent to interpret user commands and map them to actions.
4. **Platform-Specific Logic**: The [platform/](./src/platform/) directory includes modules for handling platform-specific requirements, such as detecting and using system tools (`ffmpeg`, `wmctrl`, `xdotool`) and managing platform-specific capture methods.

## How to extend

To add new features or modify existing functionality in the `screencapture-agent`, follow these steps:

1. **Define New Actions**:

   - Add new action types and parameters in [screencaptureSchema.ts](./src/screencaptureSchema.ts).
   - Update the schema to include the new action definitions.

2. **Update Grammar**:

   - Add new grammar rules in [screencaptureSchema.agr](./src/screencaptureSchema.agr) to map user commands to the new actions.

3. **Implement Action Logic**:

   - Extend the [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file to handle the new actions. This may involve adding new methods or modifying existing ones.

4. **Add Platform-Specific Support**:

   - If the new action requires platform-specific logic, update or add modules in the [platform/](./src/platform/) directory. For example, you might need to add new commands for `ffmpeg` or other tools.

5. **Test Your Changes**:
   - Use the TypeAgent Shell or CLI to test the new actions. Verify that they work as expected and produce the desired results.
   - Add unit tests for the new functionality to ensure reliability and maintainability.

By following these steps, you can extend the `screencapture-agent` to support additional screen capture and recording features or adapt it to new platforms and tools.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/screencaptureManifest.json](./src/screencaptureManifest.json)
- `./agent/handlers` → `./dist/screencaptureActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/screencaptureActionHandler.ts`, `./src/screencaptureManifest.json`, `./src/screencaptureSchema.agr`, …and 11 more under `./src/`.

### Agent surface

- Manifest: [./src/screencaptureManifest.json](./src/screencaptureManifest.json)
- Schema: [./src/screencaptureSchema.ts](./src/screencaptureSchema.ts)
- Grammar: [./src/screencaptureSchema.agr](./src/screencaptureSchema.agr)
- Handler: [./src/screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts)

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `DISPLAY`
- `XDG_SESSION_TYPE`

### Actions

_5 actions implemented by this agent, parsed deterministically from `./src/screencaptureSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                 | Action                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| _Take a screenshot_                                                       | `takeScreenshot`                                        |
| _Start a screen recording_                                                | `startRecording`                                        |
| _Stop the currently active screen recording._                             | `stopRecording`                                         |
| _List all currently visible windows so the user can target them by name._ | `listWindows`                                           |
| _Activity type tracked while a recording is in progress._                 | `recording` → `{ "outputPath": "…", "startedAtMs": 0 }` |

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
