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

This agent provides functionality for capturing screenshots and recording screen activity. It supports the following actions:

- `takeScreenshot`: Captures a screenshot of the entire screen or a specific window. If a `target` is specified, the agent will attempt to match the name to a visible window (e.g., "Chrome" or "Visual Studio").
- `startRecording`: Begins recording the screen or a specific window. Only one recording can be active at a time.
- `stopRecording`: Stops the currently active screen recording.
- `listWindows`: Lists all currently visible windows, allowing users to identify and target them by name.
- `recording`: Tracks the activity of an ongoing recording, including details such as the target, output path, and start time.

Captured screenshots and recordings are saved in the agent's session storage under `screenshots/` and `recordings/` directories. These files are also surfaced as entities in the action results.

## Setup

To use the `screencapture-agent`, you need to install certain system tools and configure environment variables. The agent relies on external binaries for its functionality, which are not bundled with the package.

### Required Tools

#### Windows

- **`ffmpeg`**: Install using `winget install Gyan.FFmpeg` or download it from `https://ffmpeg.org`.

#### Linux

- **`ffmpeg`**: Install using your package manager, e.g., `sudo apt install ffmpeg`, `sudo dnf install ffmpeg`, or `sudo pacman -S ffmpeg`.
- **`wmctrl`**: Install using `sudo apt install wmctrl`.
- **`xdotool`**: Install using `sudo apt install xdotool`.

If any required tool is missing, the agent will provide an actionable installation hint when you attempt to use a feature that depends on it. After installing the necessary tools, restart your shell or CLI session to ensure the changes take effect.

### Environment Variables

The following environment variables must be set:

- `DISPLAY`: Required for graphical display on Linux systems.
- `XDG_SESSION_TYPE`: Must be set to `x11` on Linux systems. The agent does not support Wayland sessions.

For more details on setting up the environment, refer to the hand-written README.

## Key Files

The `screencapture-agent` is organized into several key files and directories, each responsible for specific functionality:

- [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts): Implements the logic for handling actions such as taking screenshots, starting/stopping recordings, and listing windows.
- [screencaptureManifest.json](./src/screencaptureManifest.json): Defines the agent's metadata, including its description, schema, and capabilities.
- [screencaptureSchema.ts](./src/screencaptureSchema.ts): Specifies the types and parameters for the actions supported by the agent.
- [screencaptureSchema.agr](./src/screencaptureSchema.agr): Contains grammar rules for mapping user commands to actions.
- [context.ts](./src/context.ts): Manages the agent's runtime context, including active recordings and tool installation states.
- [platform/](./src/platform/): Contains platform-specific modules for Windows and Linux, handling tasks such as tool detection, window enumeration, and command execution.

### Key Components

1. **Action Handler**: The [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file is the core of the agent, implementing the behavior for all supported actions. It interacts with platform-specific modules to execute commands and manage recordings.
2. **Manifest**: The [screencaptureManifest.json](./src/screencaptureManifest.json) file describes the agent's purpose, supported actions, and schema.
3. **Schema and Grammar**: The [screencaptureSchema.ts](./src/screencaptureSchema.ts) and [screencaptureSchema.agr](./src/screencaptureSchema.agr) files define the structure of actions and the grammar for interpreting user commands.
4. **Platform-Specific Logic**: The [platform/](./src/platform/) directory contains modules for Windows and Linux, including:
   - `ffmpeg.ts`: Handles detection and setup of the `ffmpeg` tool.
   - `linux.ts`: Implements Linux-specific functionality, such as window enumeration using `wmctrl` and `xdotool`.
   - `index.ts`: Provides platform detection and abstracts platform-specific operations.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
