<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3b37c232369dbd851bee9cf26ab12613b1381c7e7f5072efb9ae8d7d586c9757 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# screencapture-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `screencapture-agent` is a TypeAgent application agent that facilitates screen capture and recording on Windows and Linux (X11). It supports taking screenshots and recording the screen, either in full or for specific application windows, by matching their names.

## What it does

The `screencapture-agent` provides functionality for capturing screenshots and recording the screen. It supports the following actions:

- `takeScreenshot`: Captures a screenshot of the entire screen or a specific window. If a `target` is provided, the agent attempts to match it to a visible window by name (e.g., "Chrome" or "Visual Studio").
- `startRecording`: Initiates a screen recording. Similar to `takeScreenshot`, the `target` parameter can be used to specify a particular window or program. Only one recording can be active at a time.
- `stopRecording`: Stops the currently active screen recording.
- `listWindows`: Lists all currently visible windows, allowing users to identify and target them by name.
- `recording`: Tracks the activity of an ongoing recording, including details such as the target, output path, and start time.

The agent stores captured screenshots and recordings in session-specific storage directories (`screenshots/` and `recordings/`), and these files are returned as entities in the action results.

### Platform Support

- **Windows 10/11**: Supports full-screen and per-window capture using `gdigrab`. Window enumeration is performed via PowerShell's `Get-Process` command.
- **Linux (X11)**: Supports full-screen and per-window capture using `x11grab`. Window enumeration is achieved using `wmctrl -lp`, and per-window geometry is determined using `xdotool getwindowgeometry`.
- **Linux (Wayland)**: Not supported in this version. If the agent detects `XDG_SESSION_TYPE=wayland`, it will return an error message instructing the user to switch to an X11 session.
- **macOS and other platforms**: Not supported.

## Setup

To use the `screencapture-agent`, you need to install specific system tools and configure environment variables.

### Required Tools

The agent relies on external system binaries for its functionality. These tools are not bundled with the agent and must be installed separately.

#### Windows

- **`ffmpeg`**: Install using `winget install Gyan.FFmpeg` or download it from `https://ffmpeg.org`.

#### Linux

- **`ffmpeg`**: Install using your package manager:
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - Fedora: `sudo dnf install ffmpeg`
  - Arch Linux: `sudo pacman -S ffmpeg`
- **`wmctrl`**: Install using `sudo apt install wmctrl` (Debian/Ubuntu).
- **`xdotool`**: Install using `sudo apt install xdotool` (Debian/Ubuntu).

If any required tool is missing, the agent will provide an actionable error message with installation instructions when you attempt to use a feature that depends on the missing tool.

### Environment Variables

The following environment variables must be set for the agent to function correctly:

- `DISPLAY`: Required for graphical display on Linux systems.
- `XDG_SESSION_TYPE`: Must be set to `x11` on Linux systems. The agent does not support Wayland sessions.

For more details on setup, refer to the hand-written README.

## Key Files

The `screencapture-agent` is organized into several key files and directories:

- [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts): Implements the logic for all supported actions, including taking screenshots, starting/stopping recordings, and listing windows.
- [screencaptureManifest.json](./src/screencaptureManifest.json): Defines the agent's metadata, including its description, schema, and capabilities.
- [screencaptureSchema.ts](./src/screencaptureSchema.ts): Specifies the types and parameters for the agent's actions, ensuring proper validation and execution.
- [screencaptureSchema.agr](./src/screencaptureSchema.agr): Contains grammar rules that map user commands to specific actions.
- [context.ts](./src/context.ts): Manages the agent's runtime context, including active recordings and tool installation state.
- [platform/](./src/platform/): A directory containing platform-specific logic for Windows and Linux, such as tool detection, command execution, and window enumeration.

### Key Components

1. **Action Handler**: The [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file is the core of the agent, implementing the logic for all actions. It interacts with platform-specific modules to execute tasks like capturing screenshots and managing recordings.
2. **Manifest**: The [screencaptureManifest.json](./src/screencaptureManifest.json) file provides metadata about the agent, including its description, supported actions, and schema.
3. **Schema and Grammar**: The [screencaptureSchema.ts](./src/screencaptureSchema.ts) and [screencaptureSchema.agr](./src/screencaptureSchema.agr) files define the structure of actions and the grammar for interpreting user commands.
4. **Platform-Specific Logic**: The [platform/](./src/platform/) directory contains modules for handling platform-specific tasks. For example:
   - [ffmpeg.ts](./src/platform/ffmpeg.ts): Detects and validates the presence of `ffmpeg` on the system.
   - [linux.ts](./src/platform/linux.ts): Implements Linux-specific functionality, such as window enumeration using `wmctrl` and `xdotool`.

## How to extend

To extend the `screencapture-agent`, follow these steps:

1. **Define a new action**:

   - Add a new action type to [screencaptureSchema.ts](./src/screencaptureSchema.ts).
   - Specify the action's parameters and expected behavior.

2. **Update the grammar**:

   - Add new grammar rules to [screencaptureSchema.agr](./src/screencaptureSchema.agr) to map user commands to the new action.

3. **Implement the action handler**:

   - Extend the [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file to include the logic for the new action.
   - Use the platform-specific modules in [platform/](./src/platform/) if the action requires OS-level operations.

4. **Test the new functionality**:

   - Use the TypeAgent Shell or CLI to test the new action.
   - Verify that the action behaves as expected and integrates correctly with the rest of the agent.

5. **Update documentation**:
   - Document the new action in the schema and ensure the grammar rules are clear and comprehensive.
   - Update the hand-written README if necessary to reflect the new functionality.

By following these steps, you can add new features to the `screencapture-agent` while maintaining its structure and functionality.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
