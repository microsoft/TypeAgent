<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ee0724066bf7764fc9f636978cca59be8557ffc25e9c28a15ded77e6d6f848c1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# discord-agent â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `discord-agent` package is a TypeAgent application agent designed to interact with Discord servers using natural language commands. It leverages the Discord REST API v10 to perform various actions such as sending messages, listing channels, creating invites, and more. This agent simplifies the process of managing Discord servers by allowing users to refer to channels by name rather than by ID.

## What it does

The `discord-agent` package implements several actions that enable interaction with Discord servers. These actions include:

- `createMessage`: Sends a message to a specified channel.
- `getChannelMessages`: Fetches messages from a specified channel.
- `getCurrentUser`: Retrieves the user object of the requester's account.
- `createChannelInvite`: Creates a new invite for a channel.
- `setGuild`: Sets the default Discord server (guild) for all operations.
- `listChannels`: Lists all channels in the current Discord server.
- `refreshChannels`: Refreshes the channel cache from the Discord server.

These actions allow users to manage their Discord servers efficiently through natural language commands.

## Setup

To set up the `discord-agent`, you need to configure a Discord bot and obtain a bot token. Follow these steps:

1. **Create a Discord Bot**:

   - Go to the Discord Developer Portal (`https://discord.com/developers/applications`) and create a new application.
   - Navigate to the **Bot** tab, reset the token, and copy it.

2. **Configure Environment Variables**:

   - Add the bot token to your environment variables in `ts/.env`:
     ```env
     DISCORD_BOT_TOKEN=your_token_here
     ```

3. **Enable Message Content Intent**:

   - In the **Bot** tab, enable the **Message Content Intent** under **Privileged Gateway Intents**.

4. **Invite the Bot to Your Server**:

   - Generate an invite URL in the **OAuth2 > URL Generator** section, select the necessary scopes and permissions, and authorize the bot in your server.

5. **Enable Developer Mode**:

   - Enable **Developer Mode** in Discord settings to obtain your Server ID.

6. **Set Up the Discord Server in TypeAgent**:
   - After restarting TypeAgent with the bot token configured, set your Discord server ID:
     ```bash
     set my discord server to YOUR_SERVER_ID
     ```

For detailed setup instructions, see the hand-written README.

## Key Files
The `discord-agent` package is structured into several key components:

- **Manifest**: [discordManifest.json](./src/discordManifest.json) defines the agent's metadata and schema configuration.
- **Schema**: [discordSchema.ts](./src/discordSchema.ts) outlines the types and actions supported by the agent.
- **Grammar**: [discordSchema.agr](./src/discordSchema.agr) contains patterns for user requests.
- **Handler**: [discordActionHandler.ts](./src/discordActionHandler.ts) implements the logic for handling actions.

The agent uses the TypeAgent SDK to manage actions and sessions, and it interacts with the Discord API to perform operations.

## How to extend

To extend the `discord-agent` package, follow these steps:

1. **Add New Actions**:

   - Define new actions in the schema file [discordSchema.ts](./src/discordSchema.ts).
   - Update the grammar file [discordSchema.agr](./src/discordSchema.agr) with patterns for the new actions.

2. **Implement Action Handlers**:

   - Implement the logic for new actions in [discordActionHandler.ts](./src/discordActionHandler.ts). Use the existing handlers as a reference.

3. **Test Your Changes**:

   - Run tests to ensure your new actions work correctly. Add test cases for new actions in the appropriate test files.

4. **Build the Package**:
   - Build the package using the following command:
     ```bash
     cd ts/packages/agents/discord
     pnpm run build
     ```

By following these steps, you can extend the functionality of the `discord-agent` package to support additional Discord operations.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` â†’ [./src/discordManifest.json](./src/discordManifest.json)
- `./agent/handlers` â†’ [./dist/discordActionHandler.js](./dist/discordActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/discordActionHandler.ts`, `./src/discordManifest.json`, `./src/discordSchema.agr`, â€¦and 16 more under `./src/`.

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
| "Send a message to the general channel saying 'Hello everyone!'" | `createMessage` â†’ `{ "channel_id": "â€¦", "content": "â€¦" }` |
| "Can you show me the latest messages from the channel with ID 12345?" | `getChannelMessages` â†’ `{ "channel_id": "â€¦" }` |
| "Can you show me my account details?" | `getCurrentUser` |
| _Create a new invite for a channel._ | `createChannelInvite` â†’ `{ "channel_id": "â€¦" }` |
| _Set the default Discord server (guild) for all operations._ | `setGuild` â†’ `{ "guild_id": "â€¦" }` |
| _List all channels in the current Discord server._ | `listChannels` |
| _Refresh the channel cache from the Discord server._ | `refreshChannels` |

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:27:49.365Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
