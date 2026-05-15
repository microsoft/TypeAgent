# Discord Agent

The Discord agent is a TypeAgent plugin that lets you interact with Discord servers through natural language. It uses the [Discord REST API v10](https://discord.com/developers/docs/reference) to send messages, list channels, create invites, and more. The agent resolves channel names to IDs automatically so you can refer to channels by name (or `#name`) instead of copying IDs around.

## Prerequisites

- Node >= 20, pnpm >= 10
- A Discord account and a server (guild) you manage
- A Discord bot token

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.

2. Go to the **Bot** tab, click **Reset Token**, and copy the token.

3. Add the token to `ts/.env`:

   ```
   DISCORD_BOT_TOKEN=your_token_here
   ```

4. Enable the **Message Content Intent** so the bot can read message text:

   - Go to **Bot → Privileged Gateway Intents**
   - Enable **Message Content Intent**
   - Save changes

5. Invite the bot to your server:

   - Go to **OAuth2 > URL Generator**
   - Select scope: **bot**
   - Select permissions: **Send Messages**, **Read Message History**
   - Open the generated URL in your browser, select your server, and click **Authorize**

   > **Note:** Discord now requires a redirect URL in the URL Generator. Go to **OAuth2 > General > Redirects**, add `https://localhost`, save, then select it in the URL Generator before generating the invite link.

6. Enable **Developer Mode** in Discord: **Settings > Advanced > Developer Mode**.

7. Get your Server ID: right-click your server name in the sidebar and click **Copy Server ID**.

## First-Time Setup in TypeAgent

After restarting TypeAgent with the bot token configured:

```
set my discord server to YOUR_SERVER_ID
```

The agent will fetch and cache all channels in the server automatically.

## Implemented Actions

| Action                | Example Phrase                                     | Notes                                                        |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `setGuild`            | "set my discord server to 123456789"               | Persists across sessions; triggers channel cache refresh     |
| `getCurrentUser`      | "who am I on Discord?"                             | Returns bot username, discriminator, and ID                  |
| `createMessage`       | "send a message to #general saying hello"          | Resolves channel names and `#name` references                |
| `getChannelMessages`  | "show me the last 5 messages in #general"          | Returns messages with human-readable timestamps and authors  |
| `listChannels`        | "list discord channels"                            | Shows channels nested under categories; includes type labels |
| `refreshChannels`     | "refresh discord channels"                         | Force-refreshes the channel name cache from Discord          |
| `createChannelInvite` | "create an invite for #general that never expires" | Supports `never_expires`, `max_age`, `max_uses`, `temporary` |

## Channel Name Resolution

You can use channel names instead of IDs in any command. The agent maintains a cached mapping of channel names to IDs.

- **`#name` syntax is supported** — you can say `#general` or `general` interchangeably.
- **Text channels are preferred** over voice channels when names conflict. If your server has both a text and voice channel named "general", saying "general" will target the text channel.
- Use **"voice channel general"** or **"text channel general"** to be explicit about which type you want.
- If a channel isn't found in the cache, the agent **automatically refreshes** the cache from Discord before failing.
- Run **"refresh discord channels"** if you just created a new channel and the agent can't find it.

## Channel Listing

The `listChannels` action displays channels grouped under their Discord categories, matching how they appear in the Discord sidebar:

```
Channels (12):

  GENERAL
    • welcome (text)
    • announcements (announcement)
    • general (text)
    • General (voice)

  GAMING
    • game-chat (text)
    • Gaming Lounge (voice)

  • rules (text)
```

Channels not assigned to a category appear at the top. The count reflects non-category channels only.

## Message Content Intent

If `getChannelMessages` returns messages with no content, your bot is missing the **Message Content Intent**. The agent will display a diagnostic message with instructions to fix this in the Discord Developer Portal.

## Unimplemented Actions

The schema defines 50+ actions covering threads, guild management, webhooks, user management, DMs, and more. These are recognized by the agent but currently return "not yet implemented" and are planned for future work. See [CAPTIONS_BOT.md](../../../docs/CAPTIONS_BOT.md) and [DISCORD_GATEWAY_BRIDGE.md](../../../docs/DISCORD_GATEWAY_BRIDGE.md) for upcoming features.

## Building

```bash
cd ts/packages/agents/discord
pnpm run build
```

## Environment Variables

| Variable            | Required | Description                                 |
| ------------------- | -------- | ------------------------------------------- |
| `DISCORD_BOT_TOKEN` | Yes      | Bot token from the Discord Developer Portal |

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=2fd7b633ca3546ebe2b7bb3164946ca554473d1151e0225227da44a9007dc279 -->

## AI Overview

> 🤖 **AI-authored summary**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer.

The `discord-agent` package is a TypeAgent agent designed to integrate with Discord for messaging and server management. It sits within the dispatcher → agent flow, where it handles actions related to Discord interactions. This package enables the TypeAgent framework to perform various operations on Discord, such as sending messages, managing channels, and handling server-related tasks.

Contributors or AI agents looking to modify this package typically start with the entry points defined in the `./agent/manifest` and `./agent/handlers` directories. The manifest file, [./src/discordManifest.json](./src/discordManifest.json), provides essential metadata and configuration for the agent, including the schema and grammar files. The action handler, [./src/discordActionHandler.ts](./src/discordActionHandler.ts), contains the logic for executing Discord actions based on the defined schema and grammar.

The most important source files to read first are:
- [./src/discordManifest.json](./src/discordManifest.json): This file outlines the agent's capabilities and configuration.
- [./src/discordActionHandler.ts](./src/discordActionHandler.ts): This file implements the action handling logic for Discord interactions.
- [./src/discordSchema.ts](./src/discordSchema.ts): This file defines the TypeScript types for the Discord actions.
- [./src/discordSchema.agr](./src/discordSchema.agr): This file contains the grammar rules for parsing user requests related to Discord actions.

Understanding the schema, grammar, and handler files is crucial for extending or modifying the agent's functionality. The schema defines the structure of the actions, the grammar specifies how user requests are interpreted, and the handler executes the actions based on the parsed requests.

For example, to add a new action for managing Discord roles, you would:
1. Update the schema file [./src/discordSchema.ts](./src/discordSchema.ts) to include the new action type.
2. Modify the grammar file [./src/discordSchema.agr](./src/discordSchema.agr) to recognize user requests related to the new action.
3. Implement the logic for the new action in the handler file [./src/discordActionHandler.ts](./src/discordActionHandler.ts).

By following these steps, contributors can effectively extend the capabilities of the `discord-agent` package to support additional Discord functionalities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this block. Hand edits inside the AUTOGEN region will be overwritten on the next run.

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

### Example

_Example snippet pending LLM authoring; will be filled in once the generator is wired to the LLM (see `ts/docs/architecture/doc-autogen.md`)._

---

_Auto-generated against commit `f9a2c5dc1de6e0ed208cb0024add2b9d55546418` on `2026-05-15T00:52:09.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter discord-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
