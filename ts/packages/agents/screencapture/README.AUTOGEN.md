<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ba3bf63187d14dc4e868df4407f295805fdff3994c08c48f254b2668d75a8472 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# screencapture-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `screencapture-agent` is a TypeAgent application agent designed for screen capture and recording tasks. It enables users to take screenshots and record their screens on Windows and Linux (X11), with the option to target specific programs or windows by name. This agent integrates with the TypeAgent ecosystem, allowing users to perform these actions through natural language commands.

## What it does

The `screencapture-agent` provides the following capabilities:

- **`takeScreenshot`**: Captures a screenshot of the entire screen or a specific window. If a `target` parameter is provided, the agent attempts to match the name to a visible window (e.g., "Chrome" or "Visual Studio").
- **`startRecording`**: Begins a screen recording of the entire screen or a specific window. Only one recording can be active at a time.
- **`stopRecording`**: Stops the currently active screen recording.
- **`listWindows`**: Lists all currently visible windows, allowing users to identify and target them by name.
- **`recording`**: Tracks the activity of an ongoing recording, including details such as the target, output path, and start time.

Captured screenshots and recordings are stored in the agent's session storage under `screenshots/` and `recordings/` directories. These files are also surfaced as entities in the action results, making them accessible for further processing or sharing.

### Platform Support

- **Windows 10/11**: Supports full-screen and per-window capture using `gdigrab`. Window enumeration is performed using PowerShell's `Get-Process` command.
- **Linux (X11)**: Supports full-screen and per-window capture using `x11grab`. Window enumeration is achieved using `wmctrl -lp`, and per-window geometry is determined using `xdotool getwindowgeometry`.
- **Linux (Wayland)**: Not supported in this version. The agent detects `XDG_SESSION_TYPE=wayland` and provides a clear error message. Users must switch to an X11 session to use the agent.
- **macOS and other platforms**: Not supported.

## Setup

The `screencapture-agent` requires certain system tools and environment variables to function correctly. These tools are not bundled with the package and must be installed separately.

### Required Tools

#### Windows

- **`ffmpeg`**: Install using `winget install Gyan.FFmpeg` or download it from `https://ffmpeg.org`.

#### Linux

- **`ffmpeg`**: Install using your package manager:
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - Fedora: `sudo dnf install ffmpeg`
  - Arch Linux: `sudo pacman -S ffmpeg`
- **`wmctrl`**: Install using `sudo apt install wmctrl`.
- **`xdotool`**: Install using `sudo apt install xdotool`.

If any required tool is missing, the agent will provide an actionable installation hint when you attempt to use a feature that depends on it. After installing the necessary tools, restart your shell or CLI session to ensure the changes take effect.

### Environment Variables

The following environment variables must be set:

- `DISPLAY`: Required for graphical display on Linux systems.
- `XDG_SESSION_TYPE`: Must be set to `x11` on Linux systems. The agent does not support Wayland sessions.

For more detailed instructions on setting up the environment, refer to the hand-written README.

## Key Files

The `screencapture-agent` is structured into several key files and directories, each serving a specific purpose:

- **[screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts)**: Implements the core logic for handling actions such as taking screenshots, starting/stopping recordings, and listing windows. This is the primary file for understanding the agent's behavior.
- **[screencaptureManifest.json](./src/screencaptureManifest.json)**: Contains metadata about the agent, including its description, schema, and capabilities.
- **[screencaptureSchema.ts](./src/screencaptureSchema.ts)**: Defines the types and parameters for the actions supported by the agent.
- **[screencaptureSchema.agr](./src/screencaptureSchema.agr)**: Specifies the grammar rules for mapping user commands to actions.
- **[context.ts](./src/context.ts)**: Manages the agent's runtime context, including active recordings and tool installation states.
- **[platform/](./src/platform/)**: A directory containing platform-specific modules for Windows and Linux. These modules handle tasks such as tool detection, window enumeration, and command execution.

### Platform-Specific Modules

- **[platform/ffmpeg.ts](./src/platform/ffmpeg.ts)**: Handles detection and setup of the `ffmpeg` tool.
- **[platform/linux.ts](./src/platform/linux.ts)**: Implements Linux-specific functionality, such as window enumeration using `wmctrl` and `xdotool`.
- **[platform/index.ts](./src/platform/index.ts)**: Provides platform detection and abstracts platform-specific operations.

## How to extend

To add new features or actions to the `screencapture-agent`, follow these steps:

1. **Define a new action**:

   - Add the action type and parameters to [screencaptureSchema.ts](./src/screencaptureSchema.ts).
   - Update the grammar in [screencaptureSchema.agr](./src/screencaptureSchema.agr) to include user-friendly commands that map to the new action.

2. **Implement the action handler**:

   - Extend the logic in [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) to handle the new action. Use existing patterns for consistency.

3. **Update platform-specific logic**:

   - If the new action requires platform-specific behavior, add the necessary logic to the appropriate module in the [platform/](./src/platform/) directory.

4. **Test the new functionality**:

   - Use the TypeAgent Shell or CLI to test the new action. Verify that it behaves as expected and integrates correctly with the existing actions.

5. **Document the changes**:
   - Update the hand-written README and ensure the new action is described in the schema and grammar files.

By following these steps, you can enhance the `screencapture-agent` to support additional use cases or improve its existing functionality.

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

`./src/screencaptureActionHandler.ts`, `./src/screencaptureManifest.json`, `./src/screencaptureSchema.agr`, …and 12 more under `./src/`.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-12T08:45:00.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
