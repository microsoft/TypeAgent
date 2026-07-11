<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=987a754a12f968bfa3193fe9a72c4a68afc12a7c5346ab374f9d658979bf524a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# discord-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `discord-agent` package is a TypeAgent application agent that facilitates interaction with Discord servers using natural language commands. It leverages the Discord REST API v10 to perform a variety of tasks, such as sending messages, managing channels, creating invites, and retrieving user or server information. This agent is designed to simplify server management and communication by allowing users to interact with Discord through intuitive commands.

## What it does

The `discord-agent` provides a range of actions to manage and interact with Discord servers. These actions are grouped into the following categories:

### Message Management

- **`createMessage`**: Sends a specific message to a channel. This action is used when the user provides the exact content of the message.
- **`craftMessage`**: Drafts a message using an LLM based on a high-level intent and posts it to a channel. This is useful when the user describes the purpose or intent of the message rather than providing the exact text.
- **`getChannelMessages`**: Retrieves messages from a specified channel, with options to filter by time or limit the number of messages.

### User and Server Management

- **`getCurrentUser`**: Fetches details about the bot's account, such as its username, discriminator, and ID.
- **`setGuild`**: Sets the default Discord server (guild) for all operations. This action also triggers a refresh of the channel cache.

### Channel Management

- **`listChannels`**: Lists all channels in the current Discord server, grouped by categories.
- **`refreshChannels`**: Refreshes the cached list of channels from the server, ensuring the agent has the latest information.

### Invite Management

- **`createChannelInvite`**: Creates a new invite link for a specific channel, with options to configure expiration time, usage limits, and other parameters.

These actions enable users to perform a wide range of tasks, from sending messages to managing server settings, all through natural language commands. The agent also supports channel name resolution, allowing users to refer to channels by name or `#name` syntax instead of using channel IDs.

## Setup

To use the `discord-agent`, you need to configure a Discord bot and set up the required environment variables. Follow these steps:

### Prerequisites

- Install Node.js (version 20 or higher) and pnpm (version 10 or higher).
- Have a Discord account and access to a Discord server (guild) that you manage.

### Discord Bot Setup

1. Visit the Discord Developer Portal at `https://discord.com/developers/applications` and create a new application.
2. Navigate to the **Bot** tab, create a bot, and reset its token. Copy the token for later use.
3. Add the token to the `ts/.env` file in the project root:
   ```env
   DISCORD_BOT_TOKEN=your_token_here
   ```
4. Enable the **Message Content Intent** in the **Bot → Privileged Gateway Intents** section of the Developer Portal.
5. Use the **OAuth2 URL Generator** in the Developer Portal to create an invite link for your bot:
   - Select the **bot** scope.
   - Grant the bot permissions such as **Send Messages** and **Read Message History**.
   - Add a redirect URL (e.g., `https://localhost`) in the **OAuth2 > General > Redirects** section before generating the invite link.
   - Open the generated URL in your browser, select your server, and click **Authorize**.

### Enable Developer Mode in Discord

- In Discord, go to **Settings → Advanced → Developer Mode** and enable it.
- Right-click your server name in the sidebar and select **Copy Server ID** to obtain your server's ID.

### First-Time Setup in TypeAgent

- Restart TypeAgent with the bot token configured.
- Set your Discord server ID using the following command:
  ```bash
  set my discord server to YOUR_SERVER_ID
  ```
- The agent will automatically fetch and cache all channels in the server.

## Key Files

The `discord-agent` package is organized into several key files that define its functionality:

- [src/discordActionHandler.ts](./src/discordActionHandler.ts): Contains the implementation of the agent's actions, such as sending messages, creating invites, and managing channels.
- [src/discordManifest.json](./src/discordManifest.json): The manifest file that describes the agent's purpose, schema, and default settings.
- [src/discordSchema.ts](./src/discordSchema.ts): Defines the TypeScript types and structures for the actions supported by the agent.
- [src/discordSchema.agr](./src/discordSchema.agr): Contains the grammar definitions for parsing natural language commands into actionable intents.

These files work together to enable the agent's functionality, from defining the actions and their parameters to implementing the logic for interacting with the Discord API.

## How to extend

To extend the `discord-agent` package, follow these steps:

### 1. Define New Actions

- Add the new action's type definition to [discordSchema.ts](./src/discordSchema.ts).
- Specify the action's parameters and expected behavior.

### 2. Update the Grammar

- Modify [discordSchema.agr](./src/discordSchema.agr) to include new natural language patterns for the action.
- Ensure the grammar maps user commands to the new action and its parameters.

### 3. Implement the Action Handler

- Add the logic for the new action in [discordActionHandler.ts](./src/discordActionHandler.ts).
- Use the Discord REST API to perform the desired operation.

### 4. Test the New Functionality

- Write unit tests for the new action and its handler.
- Run the tests using:
  ```bash
  pnpm run test
  ```

### 5. Update Documentation

- Document the new action in the hand-written README or other relevant documentation files.
- Ensure the grammar and schema changes are reflected in the auto-generated documentation.

By following these steps, you can add new features to the `discord-agent` package, enabling it to support additional Discord functionalities or tailor it to specific use cases.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/discordManifest.json](./src/discordManifest.json)
- `./agent/handlers` → `./dist/discordActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/discordActionHandler.ts`, `./src/discordManifest.json`, `./src/discordSchema.agr`, …and 17 more under `./src/`.

### Agent surface

- Manifest: [./src/discordManifest.json](./src/discordManifest.json)
- Schema: [./src/discordSchema.ts](./src/discordSchema.ts)
- Grammar: [./src/discordSchema.agr](./src/discordSchema.agr)
- Handler: [./src/discordActionHandler.ts](./src/discordActionHandler.ts)

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `DISCORD_BOT_TOKEN`

### Actions

_8 actions implemented by this agent, parsed deterministically from `./src/discordSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature. 43 additional actions are declared in the schema but not yet implemented; not shown._

| User says                                                             | Action                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| "Send a message to the general channel saying 'Hello everyone!'"      | `createMessage` → `{ "channel_id": "…", "content": "…" }` |
| "Send a message to #general that welcomes everyone to the discord"    | `craftMessage` → `{ "channel_id": "…", "intent": "…" }`   |
| "Can you show me the latest messages from the channel with ID 12345?" | `getChannelMessages` → `{ "channel_id": "…" }`            |
| "Can you show me my account details?"                                 | `getCurrentUser`                                          |
| _Create a new invite for a channel._                                  | `createChannelInvite` → `{ "channel_id": "…" }`           |
| _Set the default Discord server (guild) for all operations._          | `setGuild` → `{ "guild_id": "…" }`                        |
| _List all channels in the current Discord server._                    | `listChannels`                                            |
| _Refresh the channel cache from the Discord server._                  | `refreshChannels`                                         |

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
