<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3b37c232369dbd851bee9cf26ab12613b1381c7e7f5072efb9ae8d7d586c9757 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# screencapture-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `screencapture-agent` is a TypeAgent application agent that facilitates screen capture and recording. It supports taking screenshots and recording the screen on Windows and Linux (X11), with the ability to target specific programs or window names.

## What it does

The `screencapture-agent` provides functionality for capturing screenshots and recording screen activity. It supports the following actions:

- `takeScreenshot`: Captures a screenshot of the entire screen or a specific window. If no `target` is specified, the primary screen is captured. If a `target` is provided, the agent attempts to match it to a visible window or program name.
- `startRecording`: Begins recording the screen or a specific window. Similar to `takeScreenshot`, the `target` parameter can be used to specify a particular window or program.
- `stopRecording`: Stops the currently active screen recording.
- `listWindows`: Lists all currently visible windows, allowing users to identify and target specific windows by name.
- `recording`: Tracks the activity of an ongoing recording, including details such as the target, output path, and start time.

Captured screenshots and recordings are saved in the agent's session storage under `screenshots/` and `recordings/` directories. These files are also surfaced as entities in the action results.

The agent is designed to work on Windows and Linux (X11) platforms. It uses system-level tools like `ffmpeg`, `wmctrl`, and `xdotool` to perform its operations. Note that Linux Wayland and macOS are not supported in this version.

## Setup

To use the `screencapture-agent`, you need to install certain system-level tools and configure environment variables. The required setup steps vary depending on your operating system.

### Prerequisites

#### Windows

- **`ffmpeg`**: Install using the command `winget install Gyan.FFmpeg` or download it from the official website at `https://ffmpeg.org`.

#### Linux

- **`ffmpeg`**: Install using your package manager. For example:
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - Fedora: `sudo dnf install ffmpeg`
  - Arch Linux: `sudo pacman -S ffmpeg`
- **`wmctrl`**: Install using `sudo apt install wmctrl` (Debian/Ubuntu).
- **`xdotool`**: Install using `sudo apt install xdotool` (Debian/Ubuntu).

If any required tool is missing, the agent will provide an actionable installation hint when you attempt to use a feature that depends on it. After installing the necessary tools, restart your shell or CLI to ensure the changes take effect.

### Environment Variables

The following environment variables must be set for the agent to function correctly:

- `DISPLAY`: Specifies the display server to use. This is typically set automatically in most Linux environments.
- `XDG_SESSION_TYPE`: Indicates the session type (e.g., `x11` or `wayland`). Note that only `x11` is supported in this version.

For additional details on setup, refer to the hand-written README.

## Key Files

The `screencapture-agent` is organized into several key files and directories, each serving a specific purpose:

- [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts): Implements the logic for handling the agent's actions, such as taking screenshots, starting/stopping recordings, and listing windows.
- [screencaptureManifest.json](./src/screencaptureManifest.json): Defines the agent's metadata, including its description, schema, and capabilities.
- [screencaptureSchema.ts](./src/screencaptureSchema.ts): Specifies the types and parameters for the actions supported by the agent.
- [screencaptureSchema.agr](./src/screencaptureSchema.agr): Contains grammar rules that map user commands to specific actions.
- [context.ts](./src/context.ts): Manages the agent's runtime context, including active recordings and tool installation states.
- [platform/](./src/platform/): A directory containing platform-specific logic for Windows and Linux, such as tool detection, command execution, and window enumeration.

### Key Components

1. **Action Handler**: The [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file is the core of the agent, implementing the behavior for all supported actions.
2. **Manifest**: The [screencaptureManifest.json](./src/screencaptureManifest.json) file describes the agent's capabilities and links to its schema and grammar files.
3. **Schema and Grammar**: The [screencaptureSchema.ts](./src/screencaptureSchema.ts) and [screencaptureSchema.agr](./src/screencaptureSchema.agr) files define the structure of actions and the language rules for interpreting user commands.
4. **Platform-Specific Logic**: The [platform/](./src/platform/) directory contains modules for handling platform-specific requirements, such as detecting and using system tools like `ffmpeg`, `wmctrl`, and `xdotool`.

## How to extend

To extend the `screencapture-agent`, follow these steps:

1. **Define a new action**:
   - Add a new action type to [screencaptureSchema.ts](./src/screencaptureSchema.ts). Define the action name and its parameters.
2. **Update the grammar**:
   - Add new grammar rules in [screencaptureSchema.agr](./src/screencaptureSchema.agr) to map user commands to the new action.
3. **Implement the action handler**:
   - Extend the logic in [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) to handle the new action. This may involve adding new methods or modifying existing ones.
4. **Test the new functionality**:
   - Use the TypeAgent Shell or CLI to test the new action. Verify that it behaves as expected and integrates correctly with the existing functionality.

By following this process, you can add new features to the `screencapture-agent` while maintaining its modular and extensible design.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
