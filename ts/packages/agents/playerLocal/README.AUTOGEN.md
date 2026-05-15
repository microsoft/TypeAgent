<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d9fb5b6d5f736fd8f6092bdf63b292ba4f03add55f9cf68e5683b2fd9ddbfa71 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# music-local — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `music-local` package is a TypeAgent application agent designed to play local audio files without relying on external services like Spotify. It supports various audio formats and provides comprehensive playback controls, queue management, volume control, and file search capabilities. This agent is cross-platform compatible, working on Windows, macOS, and Linux.

## What it does

The `music-local` agent accepts a variety of actions related to playing and managing local audio files. These actions include:

- **Playback controls**: `playFile`, `playFolder`, `pause`, `resume`, `stop`, `next`, `previous`
- **Queue management**: `addToQueue`, `clearQueue`, `showQueue`, `playFromQueue`
- **Volume control**: `setVolume`, `changeVolume`, `mute`, `unmute`
- **Shuffle and repeat**: `shuffle`, `repeat`
- **File search and listing**: `listFiles`, `searchFiles`
- **Status and configuration**: `status`, `setMusicFolder`, `showMusicFolder`

The agent interacts with the system's built-in audio capabilities to perform these actions, making it cross-platform compatible with Windows, macOS, and Linux.

## Setup

To set up the `music-local` agent, you need to configure the following environment variables:

- `XDG_CONFIG_HOME`: Path to the configuration directory.
- `XDG_MUSIC_DIR`: Path to the music directory.

Additionally, ensure that the necessary media player is installed on your system:

- **Windows**: Uses PowerShell with Windows Media Player.
- **macOS**: Uses `afplay`.
- **Linux**: Uses `mpv` (must be installed separately; for example: Debian/Ubuntu: `sudo apt install mpv`, Fedora: `sudo dnf install mpv`, Arch: `sudo pacman -S mpv`).

No external API keys are required. The agent uses the system's built-in audio capabilities.

## Key Files
The `music-local` package is structured as follows:

- **Manifest**: [localPlayerManifest.json](./src/agent/localPlayerManifest.json) defines the agent's metadata and schema.
- **Schema**: [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts) and [localPlayerSchema.agr](./src/agent/localPlayerSchema.agr) define the actions and grammar rules.
- **Handlers**: [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts) contains the logic for handling actions.
- **Commands**: [localPlayerCommands.ts](./src/agent/localPlayerCommands.ts) defines the command interface and handlers.
- **Service**: [localPlayerService.ts](./src/localPlayerService.ts) implements the core functionality for interacting with the media player.

### Key Files

- [localPlayerManifest.json](./src/agent/localPlayerManifest.json): Contains metadata and schema definitions for the agent.
- [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts): Defines the actions and their parameters.
- [localPlayerSchema.agr](./src/agent/localPlayerSchema.agr): Contains grammar rules for parsing commands.
- [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts): Implements the logic for handling actions.
- [localPlayerCommands.ts](./src/agent/localPlayerCommands.ts): Defines the command interface and handlers.
- [localPlayerService.ts](./src/localPlayerService.ts): Implements the core functionality for interacting with the media player.

## How to extend

To extend the `music-local` agent, follow these steps:

1. **Add new actions**: Update [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts) to define new actions and their parameters.
2. **Update grammar**: Modify [localPlayerSchema.agr](./src/agent/localPlayerSchema.agr) to include grammar rules for the new actions.
3. **Implement handlers**: Add logic for the new actions in [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts).
4. **Modify commands**: Update [localPlayerCommands.ts](./src/agent/localPlayerCommands.ts) to handle new commands.
5. **Test**: Ensure your changes are tested on all supported platforms (Windows, macOS, Linux).

Start by opening [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts) and [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts). Follow the existing patterns for defining actions and implementing their handlers. Run tests to verify functionality across different operating systems.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/localPlayerManifest.json](./src/agent/localPlayerManifest.json)
- `./agent/handlers` → [./dist/agent/localPlayerHandlers.js](./dist/agent/localPlayerHandlers.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: `chalk`, `debug`, `play-sound`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/agent/localPlayerManifest.json`, `./src/agent/localPlayerSchema.agr`, `./src/agent/localPlayerSchema.ts`, …and 5 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `XDG_CONFIG_HOME`
- `XDG_MUSIC_DIR`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter music-local docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
