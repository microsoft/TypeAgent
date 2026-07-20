<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=00f9fb4c99c20c00452f50795ecaac220a6fd99f44258f64d747a1411d746d20 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# discord-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `discord-agent` package is a TypeAgent application agent that enables interaction with Discord servers through natural language commands. By leveraging the Discord REST API v10, this agent allows users to perform various tasks such as sending messages, managing channels, creating invites, and more. It simplifies server management and communication by interpreting user commands and executing corresponding actions.

## What it does

The `discord-agent` provides a set of actions that allow users to interact with Discord servers. These actions are grouped into the following categories:

### Message Management

- **`createMessage`**: Sends a specific message to a channel. For example, "Send a message to the general channel saying 'Hello everyone!'".
- **`craftMessage`**: Uses an LLM to generate a message based on a high-level intent and posts it to a channel. For example, "Send a message to #general that welcomes everyone to the discord".
- **`getChannelMessages`**: Retrieves messages from a specified channel. For example, "Can you show me the latest messages from the channel with ID 12345?".

### User and Server Management

- **`getCurrentUser`**: Fetches details about the bot's account, such as username, discriminator, and ID.
- **`setGuild`**: Sets the default Discord server (guild) for all operations. For example, "Set my Discord server to YOUR_SERVER_ID".

### Channel Management

- **`listChannels`**: Lists all channels in the current Discord server, grouped by categories.
- **`refreshChannels`**: Refreshes the cached list of channels from the server.

### Invite Management

- **`createChannelInvite`**: Creates a new invite link for a specific channel. For example, "Create an invite for #general that never expires".

These actions allow users to perform common Discord tasks without directly interacting with the Discord interface. The agent also supports natural language processing to interpret user commands and map them to the appropriate actions.

## Setup

To use the `discord-agent`, you need to configure a Discord bot and set up the required environment variables. Follow these steps:

### Prerequisites

- Install **Node.js** (version 20 or higher) and **pnpm** (version 10 or higher).
- Create a Discord account and have access to a Discord server (guild) that you manage.

### Create and Configure a Discord Bot

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

The `discord-agent` package is structured around key files that define its functionality:

- **[src/discordActionHandler.ts](./src/discordActionHandler.ts)**: Implements the logic for handling actions such as sending messages, creating invites, and managing channels.
- **[src/discordManifest.json](./src/discordManifest.json)**: Contains metadata about the agent, including its description, schema, and default settings.
- **[src/discordSchema.ts](./src/discordSchema.ts)**: Defines the TypeScript types and structures for the actions supported by the agent.
- **[src/discordSchema.agr](./src/discordSchema.agr)**: Specifies the grammar rules for parsing natural language commands into actionable intents.

These files work together to enable the agent's functionality, from understanding user commands to executing the corresponding actions via the Discord API.

## How to extend

To extend the `discord-agent` package, you can add new actions, update the grammar, and implement the corresponding handlers. Here’s how:

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

By following these steps, you can enhance the `discord-agent` package to support additional Discord functionalities or customize it for specific use cases.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/discordManifest.json](./src/discordManifest.json)
- `./agent/handlers` → [./dist/discordActionHandler.js](./dist/discordActionHandler.js)

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

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
