<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3f1207cafde048d46bc14e01483ca57f34c752178f81db419af434bda8576fbd -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# screencapture-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `screencapture-agent` is a TypeAgent application agent designed for screen capture and recording. It supports taking screenshots and recording the screen on Windows and Linux (X11), including targeting specific program or window names.

## What it does

This agent provides several actions for screen capture and recording:

- `takeScreenshot`: Takes a screenshot of the entire screen or a specified window.
- `startRecording`: Starts recording the screen or a specified window.
- `stopRecording`: Stops the currently active screen recording.
- `listWindows`: Lists all currently visible windows to help users target them by name.
- `recording`: Tracks the activity while a recording is in progress.

Captured files are stored under the agent's session storage (`screenshots/` and `recordings/` siblings) and surfaced as entities in the action result.

## Setup

To use the `screencapture-agent`, ensure the following tools are installed on your system:

### Windows

- `ffmpeg`: Install via `winget install Gyan.FFmpeg` or download from `https://ffmpeg.org`.

### Linux

- `ffmpeg`: Install via `sudo apt install ffmpeg`, `sudo dnf install ffmpeg`, or `sudo pacman -S ffmpeg`.
- `wmctrl`: Install via `sudo apt install wmctrl`.
- `xdotool`: Install via `sudo apt install xdotool`.

Additionally, set the following environment variables:

- `DISPLAY`
- `XDG_SESSION_TYPE`

For detailed setup instructions, see the hand-written README.

## Key Files

The `screencapture-agent` is structured into several key files:

- [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts): Contains the logic for handling screen capture and recording actions.
- [screencaptureManifest.json](./src/screencaptureManifest.json): Defines the agent's manifest, including its description and schema.
- [screencaptureSchema.ts](./src/screencaptureSchema.ts): Defines the types and parameters for the actions supported by the agent.
- [screencaptureSchema.agr](./src/screencaptureSchema.agr): Contains the grammar rules for parsing user commands.
- [context.ts](./src/context.ts): Manages the context for active recordings and tool installations.
- [platform/](./src/platform/): Contains platform-specific logic for Windows and Linux, including tool detection and command execution.

### Key Components

- **Action Handler**: The [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) file is responsible for implementing the logic for each action, such as taking screenshots, starting and stopping recordings, and listing windows.
- **Manifest**: The [screencaptureManifest.json](./src/screencaptureManifest.json) file describes the agent, including its capabilities and the schema it uses.
- **Schema**: The [screencaptureSchema.ts](./src/screencaptureSchema.ts) file defines the types and parameters for the actions, ensuring that the agent can correctly interpret and execute user commands.
- **Grammar**: The [screencaptureSchema.agr](./src/screencaptureSchema.agr) file contains the grammar rules that map user utterances to specific actions.
- **Context Management**: The [context.ts](./src/context.ts) file manages the context for active recordings and tool installations, ensuring that the agent can track ongoing activities and handle tool setup prompts.
- **Platform-Specific Logic**: The [platform/](./src/platform/) directory contains modules for Windows and Linux, handling tasks such as tool detection, command execution, and window enumeration.

## How to extend

To extend the `screencapture-agent`, follow these steps:

1. **Add new actions**: Define new action types in [screencaptureSchema.ts](./src/screencaptureSchema.ts).
2. **Update grammar**: Add corresponding grammar rules in [screencaptureSchema.agr](./src/screencaptureSchema.agr).
3. **Implement handlers**: Extend the logic in [screencaptureActionHandler.ts](./src/screencaptureActionHandler.ts) to handle the new actions.
4. **Test**: Run tests to ensure the new actions work correctly. You can use the TypeAgent Shell or CLI to invoke the actions and verify their behavior.

By following these steps, you can add new capabilities to the `screencapture-agent` and enhance its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/screencaptureManifest.json](./src/screencaptureManifest.json)
- `./agent/handlers` → [./dist/screencaptureActionHandler.js](./dist/screencaptureActionHandler.js)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter screencapture-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
