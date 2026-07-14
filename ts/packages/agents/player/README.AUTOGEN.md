<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=161c4cfc25ae2a226654c06d3756d28fe10bb4be9936687d36b6f7e550e644fb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# music — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `music` package, located in the `ts/packages/agents/player/` directory, is a TypeAgent application agent that integrates with the Spotify API. It enables programmatic control of Spotify playback, playlist management, and music discovery. This agent interacts with Spotify's Web API and requires a one-time setup for authentication and authorization.

Once configured, the agent allows users to perform actions such as playing tracks, managing playlists, and controlling playback on active Spotify devices. It is designed to work in conjunction with an active Spotify client, such as the desktop app, mobile app, or a browser tab on `open.spotify.com`.

## What it does

The `music` package provides a variety of actions to interact with Spotify, grouped into the following categories:

- **Playback Control**: Includes actions like `playTrack`, `pause`, `resume`, `next`, `previous`, `setVolume`, `changeVolume`, `shuffle`, and `selectDevice` to manage playback on active Spotify devices.
- **Playlist Management**: Users can create, delete, and modify playlists with actions such as `createPlaylist`, `deletePlaylist`, `addCurrentTrackToPlaylist`, `addToPlaylistFromCurrentTrackList`, and `addSongsToPlaylist`.
- **Search and Discovery**: Actions like `searchTracks`, `searchForPlaylists`, `searchArtists`, `searchAlbums`, and `searchGenres` allow users to explore Spotify's music catalog.
- **Information Retrieval**: Retrieve details about playlists, albums, and listening history using actions like `getPlaylist`, `getFavorites`, `getQueue`, `getAlbum`, and `getFromCurrentPlaylistList`.
- **Content Playback**: Actions such as `playAlbum`, `playArtist`, `playGenre`, `playRandom`, and `playPlaylist` enable users to play specific content based on their preferences.

The agent uses Spotify's OAuth-based authentication to access personalized features. Tokens are securely stored for future use, so users only need to authenticate once. Note that some features, such as playback control and playlist management, require a Spotify Premium account.

## Setup

To enable Spotify integration, follow these steps to configure a Spotify application and set up the required environment variables:

1. **Create a Spotify App**:

   - Visit the Spotify Developer Dashboard at `https://developer.spotify.com/dashboard`.
   - Log in with your Spotify account.
   - Click "Create App" and complete the form. Ensure the Redirect URI is set to `http://127.0.0.1:PORT/callback`, where `PORT` is a four-digit port number of your choice that is not already in use.

2. **Obtain Credentials**:

   - After creating the app, navigate to its settings and copy the Client ID and Client Secret. You may need to click "View client secret" to reveal it.

3. **Set Environment Variables**:

   - Add the following variables to your `.env` file or `config.local.yaml`:
     - `SPOTIFY_APP_CLI`: Your Spotify Client ID.
     - `SPOTIFY_APP_CLISEC`: Your Spotify Client Secret.
     - `SPOTIFY_APP_PORT`: The port number you specified in the Redirect URI.

4. **User Management**:

   - While your Spotify app is in Development Mode, add the Spotify accounts that will use the integration to the app's User Management page on the dashboard. Only accounts on this allowlist can access the app.

5. **Spotify Premium Requirement**:
   - Note that certain Spotify features, such as playback control and playlist management, require a Spotify Premium account. Free accounts can authenticate but may encounter limitations.

For more detailed instructions, refer to the hand-written README.

## Key Files

The `music` package is organized into several key files, each responsible for specific aspects of the agent's functionality:

- [playerManifest.json](./src/agent/playerManifest.json): Contains metadata about the agent, including its schema and description.
- [playerSchema.agr](./src/agent/playerSchema.agr): Defines the grammar for parsing user commands related to music playback and control.
- [playerSchema.ts](./src/agent/playerSchema.ts): Specifies the TypeScript types for actions and entities used by the agent.
- [playerHandlers.ts](./src/agent/playerHandlers.ts): Implements the logic for handling actions such as playback control, playlist management, and search.
- [playerCommands.ts](./src/agent/playerCommands.ts): Provides command interfaces for enabling/disabling Spotify integration, authenticating users, and loading user data.
- [client.ts](./src/client.ts): Manages communication with the Spotify API, including authentication, token management, and API requests.
- [playback.ts](./src/playback.ts): Handles playback-related functionality, such as managing active devices and playback status.

## How to extend

To add new features or modify existing functionality in the `music` package, follow these steps:

1. **Understand the Current Implementation**:

   - Review the [playerHandlers.ts](./src/agent/playerHandlers.ts) file to understand how existing actions are implemented.
   - Familiarize yourself with the [playerSchema.ts](./src/agent/playerSchema.ts) file, which defines the TypeScript types for actions and entities.

2. **Add New Actions**:

   - Define new action types in [playerSchema.ts](./src/agent/playerSchema.ts).
   - Update the grammar in [playerSchema.agr](./src/agent/playerSchema.agr) to include new commands that map to the new actions.

3. **Implement Action Logic**:

   - Add the logic for the new actions in [playerHandlers.ts](./src/agent/playerHandlers.ts). Use existing actions as a reference for structuring your implementation.

4. **Update Command Interfaces**:

   - If your new actions require user commands, update [playerCommands.ts](./src/agent/playerCommands.ts) to define the necessary command interfaces.

5. **Test Your Changes**:
   - Write unit tests for your new actions and run them to ensure they work as expected.
   - Test the integration with the Spotify API to verify that the new functionality behaves correctly.

By following these steps, you can extend the `music` package to support additional features and enhance its integration with Spotify.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/playerManifest.json](./src/agent/playerManifest.json)
- `./agent/handlers` → `./dist/agent/playerHandlers.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)

External: `chalk`, `debug`, `dotenv`, `express`, `open`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/agent/playerManifest.json`, `./src/agent/playerSchema.agr`, `./src/agent/playerSchema.ts`, …and 21 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `SPOTIFY_APP_CLI`
- `SPOTIFY_APP_CLISEC`
- `SPOTIFY_APP_PORT`

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter music docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
