<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=bf3ea8a2bf675e78ea8bddbfc85245e44ffdd5963f273823b8550bbc395cb59e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# music — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `music` package in the TypeAgent monorepo is an application agent designed to integrate with Spotify and provide music playback capabilities. It allows users to search for, play, and control music through various actions.

## What it does

The `music` package supports a range of actions related to music playback and control. These actions include `playTrack`, `pause`, `resume`, `next`, `playAlbum`, `playArtist`, `setVolume`, `createPlaylist`, and many more. The agent interacts with the Spotify API to perform these actions, enabling users to manage their music experience programmatically. The package also handles authentication and token management for Spotify integration.

## Setup

To enable Spotify integration, you need to set up a Spotify application and configure environment variables. Follow these steps:

1. Go to the Spotify Developer Dashboard at `https://developer.spotify.com/dashboard`.
2. Log in with your Spotify account.
3. Create a new app and set the Redirect URI to `http://127.0.0.1:PORT/callback`, where `PORT` is a four-digit port number you choose.
4. Copy the Client ID and Client Secret from the app settings.
5. Set the following environment variables in your `.env` file:
   - `SPOTIFY_APP_CLI`: Your Spotify Client ID.
   - `SPOTIFY_APP_CLISEC`: Your Spotify Client Secret.
   - `SPOTIFY_APP_PORT`: The port number you chose for the Redirect URI.

See the hand-written README for the full walk-through.

## Key Files
The `music` package is structured around several key files:

- [playerManifest.json](./src/agent/playerManifest.json): Defines the agent's metadata and schema.
- [playerSchema.agr](./src/agent/playerSchema.agr): Contains the grammar for parsing music-related commands.
- [playerSchema.ts](./src/agent/playerSchema.ts): Defines the TypeScript types for actions and entities.
- [playerHandlers.ts](./src/agent/playerHandlers.ts): Implements the logic for handling music actions.
- [playerCommands.ts](./src/agent/playerCommands.ts): Provides command interfaces for enabling and disabling Spotify integration and loading user data.
- [client.ts](./src/client.ts): Manages interactions with the Spotify API, including authentication and data retrieval.

## How to extend

To extend the `music` package, follow these steps:

1. Start by exploring the [playerHandlers.ts](./src/agent/playerHandlers.ts) file to understand how actions are implemented.
2. Add new actions to the [playerSchema.ts](./src/agent/playerSchema.ts) file by defining new TypeScript types.
3. Update the grammar in [playerSchema.agr](./src/agent/playerSchema.agr) to include new commands.
4. Implement the logic for new actions in [playerHandlers.ts](./src/agent/playerHandlers.ts).
5. Test your changes thoroughly to ensure they work as expected.

By following this pattern, you can add new capabilities to the music agent and enhance its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/playerManifest.json](./src/agent/playerManifest.json)
- `./agent/handlers` → [./dist/agent/playerHandlers.js](./dist/agent/playerHandlers.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: `chalk`, `debug`, `dotenv`, `express`, `open`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/agent/playerManifest.json`, `./src/agent/playerSchema.agr`, `./src/agent/playerSchema.ts`, …and 20 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `SPOTIFY_APP_CLI`
- `SPOTIFY_APP_CLISEC`
- `SPOTIFY_APP_PORT`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter music docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
