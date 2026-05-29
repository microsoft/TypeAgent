<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ee0724066bf7764fc9f636978cca59be8557ffc25e9c28a15ded77e6d6f848c1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# discord-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `discord-agent` package is a TypeAgent application agent designed to interact with Discord servers using natural language commands. It leverages the Discord REST API v10 to perform various actions such as sending messages, listing channels, creating invites, and more. This agent simplifies the process of managing Discord servers by allowing users to issue commands in plain English.

## What it does

The `discord-agent` package supports a range of actions that facilitate interaction with Discord servers. These actions include:

- `createMessage`: Sends a message to a specified channel.
- `getChannelMessages`: Retrieves messages from a specified channel.
- `getCurrentUser`: Fetches the user object of the requester's account.
- `createChannelInvite`: Creates a new invite for a channel.
- `setGuild`: Sets the default Discord server (guild) for all operations.
- `listChannels`: Lists all channels in the current Discord server.
- `refreshChannels`: Refreshes the channel cache from the Discord server.

These actions enable users to manage their Discord servers efficiently, perform administrative tasks, and interact with server members through automated commands.

## Setup

To set up the `discord-agent`, follow these steps:

1. **Prerequisites**:

   - Ensure you have Node.js >= 20 and pnpm >= 10 installed.
   - Obtain a Discord account and manage a server (guild).

2. **Discord Bot Setup**:

   - Go to the Discord Developer Portal (`https://discord.com/developers/applications`) and create a new application.
   - Navigate to the **Bot** tab, reset the token, and copy it.
   - Add the token to your environment variables in `ts/.env`:
     ```env
     DISCORD_BOT_TOKEN=your_token_here
     ```
   - Enable the **Message Content Intent** in the **Bot → Privileged Gateway Intents** section.
   - Invite the bot to your server using the OAuth2 URL Generator, selecting the appropriate scopes and permissions.
   - Enable **Developer Mode** in Discord settings and obtain your Server ID.

3. **First-Time Setup in TypeAgent**:
   - Restart TypeAgent with the bot token configured.
   - Set your Discord server ID using the command:
     ```bash
     set my discord server to YOUR_SERVER_ID
     ```

## Key Files

The `discord-agent` package consists of several key files that define its functionality:

- [discordActionHandler.ts](./src/discordActionHandler.ts): Contains the implementation of action handlers for the Discord agent.
- [discordManifest.json](./src/discordManifest.json): Defines the agent's manifest, including its description, schema, and default settings.
- [discordSchema.ts](./src/discordSchema.ts): Specifies the types and structures for the Discord actions.
- [discordSchema.agr](./src/discordSchema.agr): Contains the grammar definitions for parsing natural language commands related to Discord actions.

## How to extend

To extend the `discord-agent` package, follow these steps:

1. **Add New Actions**:

   - Define new actions in the [discordSchema.ts](./src/discordSchema.ts) file.
   - Implement the corresponding handlers in [discordActionHandler.ts](./src/discordActionHandler.ts).

2. **Update Grammar**:

   - Modify the grammar definitions in [discordSchema.agr](./src/discordSchema.agr) to support new natural language commands.

3. **Testing**:
   - Write tests for new actions and handlers to ensure they work as expected.
   - Run the tests using the following command:
     ```bash
     pnpm run test
     ```

By following these steps, you can add new functionalities to the `discord-agent` package and enhance its capabilities for managing Discord servers.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/discordManifest.json](./src/discordManifest.json)
- `./agent/handlers` → [./dist/discordActionHandler.js](./dist/discordActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/discordActionHandler.ts`, `./src/discordManifest.json`, `./src/discordSchema.agr`, …and 16 more under `./src/`.

### Agent surface

- Manifest: [./src/discordManifest.json](./src/discordManifest.json)
- Schema: [./src/discordSchema.ts](./src/discordSchema.ts)
- Grammar: [./src/discordSchema.agr](./src/discordSchema.agr)
- Handler: [./src/discordActionHandler.ts](./src/discordActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `DISCORD_BOT_TOKEN`

### Actions

_7 actions implemented by this agent, parsed deterministically from `./src/discordSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature. 43 additional actions are declared in the schema but not yet implemented; not shown._

| User says | Action |
| --- | --- |
| "Send a message to the general channel saying 'Hello everyone!'" | `createMessage` → `{ "channel_id": "…", "content": "…" }` |
| "Can you show me the latest messages from the channel with ID 12345?" | `getChannelMessages` → `{ "channel_id": "…" }` |
| "Can you show me my account details?" | `getCurrentUser` |
| _Create a new invite for a channel._ | `createChannelInvite` → `{ "channel_id": "…" }` |
| _Set the default Discord server (guild) for all operations._ | `setGuild` → `{ "guild_id": "…" }` |
| _List all channels in the current Discord server._ | `listChannels` |
| _Refresh the channel cache from the Discord server._ | `refreshChannels` |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.413Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
