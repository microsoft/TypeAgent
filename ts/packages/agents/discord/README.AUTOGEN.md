<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=987a754a12f968bfa3193fe9a72c4a68afc12a7c5346ab374f9d658979bf524a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# discord-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `discord-agent` package is a TypeAgent application agent that enables interaction with Discord servers through natural language commands. It integrates with the Discord REST API v10 to perform actions such as sending messages, listing channels, creating invites, and more. This agent simplifies server management by allowing users to interact with Discord using plain English commands.

## What it does

The `discord-agent` provides a range of actions to manage and interact with Discord servers. Key implemented actions include:

- **Message Management**:

  - `createMessage`: Sends a specific message to a designated channel.
  - `craftMessage`: Uses an LLM to generate a message based on a high-level intent and posts it to a channel.
  - `getChannelMessages`: Retrieves messages from a specified channel.

- **User and Server Management**:

  - `getCurrentUser`: Fetches details about the bot's account, such as username and ID.
  - `setGuild`: Sets the default Discord server (guild) for all subsequent operations.

- **Channel Management**:

  - `listChannels`: Lists all channels in the current Discord server, grouped by categories.
  - `refreshChannels`: Refreshes the cached list of channels from the Discord server.

- **Invite Management**:
  - `createChannelInvite`: Creates a new invite link for a specified channel with customizable options like expiration time and usage limits.

These actions allow users to perform a variety of tasks, from sending messages to managing server settings, all through natural language commands.

## Setup

To use the `discord-agent`, follow these steps:

### Prerequisites

- Ensure you have **Node.js >= 20** and **pnpm >= 10** installed.
- Have a Discord account and manage a Discord server (guild).

### Discord Bot Setup

1. **Create a Discord Application**:

   - Visit the Discord Developer Portal at `https://discord.com/developers/applications`.
   - Create a new application and navigate to the **Bot** tab.
   - Click **Reset Token** to generate a bot token and copy it.

2. **Configure the Bot Token**:

   - Add the bot token to the `ts/.env` file in the project root:
     ```env
     DISCORD_BOT_TOKEN=your_token_here
     ```

3. **Enable Message Content Intent**:

   - In the Developer Portal, go to **Bot → Privileged Gateway Intents**.
   - Enable the **Message Content Intent** and save the changes.

4. **Invite the Bot to Your Server**:

   - Use the **OAuth2 URL Generator** in the Developer Portal:
     - Select the **bot** scope.
     - Choose permissions such as **Send Messages** and **Read Message History**.
   - Generate the invite link, open it in your browser, select your server, and click **Authorize**.

   > **Note**: Discord requires a redirect URL in the URL Generator. Add `https://localhost` under **OAuth2 > General > Redirects**, save, and select it before generating the invite link.

5. **Enable Developer Mode in Discord**:

   - Go to **Settings → Advanced → Developer Mode** in Discord and enable it.

6. **Obtain Your Server ID**:
   - Right-click your server name in the sidebar and select **Copy Server ID**.

### First-Time Setup in TypeAgent

After configuring the bot token, restart TypeAgent and set your Discord server ID:

```bash
set my discord server to YOUR_SERVER_ID
```

This command initializes the agent and caches all channels in the server.

## Key Files

The `discord-agent` package is organized into several key files that define its functionality:

- **[discordActionHandler.ts](./src/discordActionHandler.ts)**:

  - Implements the logic for handling actions such as `createMessage`, `craftMessage`, and `listChannels`.
  - Contains helper functions for interacting with the Discord API, such as sending HTTP requests and managing channel caches.

- **[discordManifest.json](./src/discordManifest.json)**:

  - Defines the agent's metadata, including its description, schema, and default settings.
  - Specifies the agent's capabilities and the files that define its schema and grammar.

- **[discordSchema.ts](./src/discordSchema.ts)**:

  - Declares the types and structures for all actions supported by the agent.
  - Includes both implemented actions and schema-only stubs for future development.

- **[discordSchema.agr](./src/discordSchema.agr)**:
  - Contains grammar definitions for parsing natural language commands into structured actions.
  - Defines patterns for user input, such as "send a message to #general saying hello."

## How to extend

To add new features or actions to the `discord-agent`, follow these steps:

1. **Define New Actions**:

   - Add the new action type to [discordSchema.ts](./src/discordSchema.ts).
   - Include the action's parameters and expected behavior.

2. **Implement Action Handlers**:

   - Extend [discordActionHandler.ts](./src/discordActionHandler.ts) with a new handler function for the action.
   - Use the existing helper functions for interacting with the Discord API.

3. **Update Grammar**:

   - Modify [discordSchema.agr](./src/discordSchema.agr) to include patterns for the new action.
   - Ensure the grammar supports natural language variations for the new command.

4. **Test the Changes**:

   - Write unit tests for the new action and its handler.
   - Run the tests using:
     ```bash
     pnpm run test
     ```

5. **Update Documentation**:
   - Document the new action in the hand-written README and ensure the grammar and schema are correctly reflected in the auto-generated documentation.

By following these steps, you can extend the `discord-agent` to support additional Discord API features or custom functionality tailored to your needs.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
