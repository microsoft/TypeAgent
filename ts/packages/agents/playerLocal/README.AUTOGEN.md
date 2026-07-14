<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5c6f34dc2ad2c52e7feb450939a807cac9497e95ba02ed953334882efc6fa1f3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# music-local — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `music-local` package is a TypeAgent application agent that enables users to play and manage local audio files without relying on external streaming services. It supports a wide range of audio formats and provides features such as playback controls, queue management, volume adjustment, and file search. The agent is designed to work across platforms, leveraging native audio playback capabilities on Windows, macOS, and Linux.

## What it does

The `music-local` agent provides a natural language interface for interacting with a local music library. Users can issue commands to perform various actions, which can be grouped into the following categories:

- **Playback Controls**: Actions like `playFile`, `playFolder`, `pause`, `resume`, `stop`, `next`, and `previous` allow users to control audio playback.
- **Queue Management**: Manage playback queues with actions such as `addToQueue`, `clearQueue`, `showQueue`, and `playFromQueue`.
- **Volume Control**: Adjust audio levels using actions like `setVolume`, `changeVolume`, `mute`, and `unmute`.
- **Shuffle and Repeat**: Use the `shuffle` and `repeat` actions to toggle shuffle mode and set repeat preferences (off, one, or all).
- **File Search and Listing**: Browse and locate audio files in the music folder with actions like `listFiles` and `searchFiles`.
- **Status and Configuration**: Actions such as `status`, `setMusicFolder`, and `showMusicFolder` provide playback status and allow users to configure the default music folder.

The agent uses platform-specific tools for audio playback:

- **Windows**: PowerShell with Windows Media Player.
- **macOS**: `afplay`.
- **Linux**: `mpv` (requires manual installation).

## Setup

To set up the `music-local` agent, follow these steps:

1. **Set Environment Variables**:

   - `XDG_CONFIG_HOME`: Path to the configuration directory.
   - `XDG_MUSIC_DIR`: Path to your music directory.

2. **Install Required Software**:

   - **Windows**: Ensure Windows Media Player is installed and accessible via PowerShell.
   - **macOS**: Ensure `afplay` is available (it is included by default in macOS).
   - **Linux**: Install `mpv` using your package manager:
     - Debian/Ubuntu: `sudo apt install mpv`
     - Fedora: `sudo dnf install mpv`
     - Arch: `sudo pacman -S mpv`

3. **Configure the Music Folder**:
   - Use the command `@localPlayer folder set /path/to/music` to set your music folder.
   - Alternatively, use natural language commands like `set music folder to C:\Users\Me\Music`.

No external API keys or additional accounts are required for this agent.

## Key Files

The `music-local` package is organized into several key files that define its functionality:

- **[localPlayerManifest.json](./src/agent/localPlayerManifest.json)**: Contains metadata and schema definitions for the agent, including action and entity types.
- **[localPlayerSchema.ts](./src/agent/localPlayerSchema.ts)**: Defines the actions supported by the agent, such as `playFile`, `pause`, and `setVolume`, along with their parameters.
- **[localPlayerSchema.agr](./src/agent/localPlayerSchema.agr)**: Specifies the grammar rules for parsing natural language commands into actions.
- **[localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts)**: Implements the logic for handling the defined actions, such as playing a file or managing the playback queue.
- **[localPlayerCommands.ts](./src/agent/localPlayerCommands.ts)**: Maps natural language commands to their corresponding actions and defines the command interface.
- **[localPlayerService.ts](./src/localPlayerService.ts)**: Provides the core functionality for interacting with the system's media player, including platform-specific implementations for Windows, macOS, and Linux.

## How to extend

To extend the `music-local` agent, follow these steps:

1. **Define New Actions**:

   - Add new action types and their parameters in [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts).
   - Update [localPlayerSchema.agr](./src/agent/localPlayerSchema.agr) to include grammar rules for the new actions.

2. **Implement Action Handlers**:

   - Add the logic for the new actions in [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts).
   - Follow the existing patterns for implementing action handlers.

3. **Update Commands**:

   - Modify [localPlayerCommands.ts](./src/agent/localPlayerCommands.ts) to handle new commands and map them to the corresponding actions.

4. **Test Your Changes**:

   - Test the new functionality on all supported platforms (Windows, macOS, Linux) to ensure compatibility and reliability.

5. **Update Documentation**:
   - Update the hand-written README and other relevant documentation to reflect the new features and changes.

By following these steps, you can enhance the `music-local` agent to support additional features or improve its existing functionality. Start by reviewing [localPlayerSchema.ts](./src/agent/localPlayerSchema.ts) and [localPlayerHandlers.ts](./src/agent/localPlayerHandlers.ts) to understand the current implementation and identify areas for improvement.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/localPlayerManifest.json](./src/agent/localPlayerManifest.json)
- `./agent/handlers` → `./dist/agent/localPlayerHandlers.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)

External: `chalk`, `debug`, `play-sound`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/agent/localPlayerManifest.json`, `./src/agent/localPlayerSchema.agr`, `./src/agent/localPlayerSchema.ts`, …and 6 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `XDG_CONFIG_HOME`
- `XDG_MUSIC_DIR`

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter music-local docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
