# Discord Agent

The Discord agent is a TypeAgent plugin that lets you interact with Discord servers through natural language. It uses the [Discord REST API v10](https://discord.com/developers/docs/reference) to send messages, list channels, create invites, and more. The agent resolves channel names to IDs automatically so you can refer to channels by name instead of copying IDs around.

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

4. Invite the bot to your server:

   - Go to **OAuth2 > URL Generator**
   - Select scope: **bot**
   - Select permissions: **Send Messages**, **Read Message History**
   - Open the generated URL in your browser, select your server, and click **Authorize**

   > **Note:** Discord now requires a redirect URL in the URL Generator. Go to **OAuth2 > General > Redirects**, add `https://localhost`, save, then select it in the URL Generator before generating the invite link.

5. Enable **Developer Mode** in Discord: **Settings > Advanced > Developer Mode**.

6. Get your Server ID: right-click your server name in the sidebar and click **Copy Server ID**.

## First-Time Setup in TypeAgent

After restarting TypeAgent with the bot token configured:

```
set my discord server to YOUR_SERVER_ID
```

The agent will fetch and cache all channels in the server automatically.

## Implemented Actions

| Action                | Example Phrase                                   | Notes                                                        |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `setGuild`            | "set my discord server to 123456789"             | Persists across sessions; triggers channel cache refresh     |
| `getCurrentUser`      | "what's my discord bot info?"                    | Returns bot username, discriminator, and ID                  |
| `createMessage`       | "send 'hello' to the general channel"            | Resolves channel names; prefers text over voice channels     |
| `getChannelMessages`  | "show me the last 5 messages in announcements"   | Returns up to 10 messages with timestamps and authors        |
| `listChannels`        | "list discord channels"                          | Shows `(text)`/`(voice)` labels when names are ambiguous     |
| `refreshChannels`     | "refresh discord channels"                       | Force-refreshes the channel name cache                       |
| `createChannelInvite` | "create an invite to general that never expires" | Supports `never_expires`, `max_age`, `max_uses`, `temporary` |

## Channel Name Resolution

You can use channel names instead of IDs in any command. The agent maintains a cached mapping of channel names to IDs.

- **Text channels are preferred** over voice channels when names conflict. If your server has both a text and voice channel named "general", saying "general" will target the text channel.
- Use **"voice channel general"** or **"text channel general"** to be explicit about which type you want.
- If a channel isn't found in the cache, the agent **automatically refreshes** the cache from Discord before failing.
- Run **"refresh discord channels"** if you just created a new channel and the agent can't find it.

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
