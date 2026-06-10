# Discord Gateway Bridge — Design Document

## 1. Overview

The Discord Gateway Bridge allows Discord users to interact with TypeAgent by sending chat messages to a bot in a Discord server. Rather than exposing a public HTTP webhook (which would require a publicly reachable endpoint and carries SSRF/replay attack risks), the bridge uses Discord's persistent Gateway WebSocket connection — the bot process initiates an outbound WSS connection to Discord's servers and receives push events. TypeAgent's dispatcher runs entirely locally and in-process; no port is opened, no public URL is needed, and no external system can trigger execution without first passing through Discord's authentication and the agent's own allowlist.

---

## 2. Architecture

```
Discord App (user types "!ta <request>")
        │
        ▼
Discord Gateway (WSS — outbound from bot)
        │  messageCreate event
        ▼
┌──────────────────────────────────────────────┐
│           Persistent Bot Process             │
│  (discord.js Client — shared with captions)  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         Message Filter                 │  │
│  │  • prefix check  (!ta ...)             │  │
│  │  • channel allowlist (BRIDGE_CHANNEL)  │  │
│  │  • user allowlist (ALLOWED_USER_IDS)   │  │
│  └──────────────┬─────────────────────────┘  │
│                 │ pass                        │
│  ┌──────────────▼─────────────────────────┐  │
│  │   TypeAgent Dispatcher (in-process)    │  │
│  │   createDispatcher() — local only      │  │
│  │   no network exposure                  │  │
│  └──────────────┬─────────────────────────┘  │
│                 │ ActionResult                │
│  ┌──────────────▼─────────────────────────┐  │
│  │   Discord REST API (reply to channel)  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 3. Security Model

| Mechanism                        | Detail                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User allowlist**               | `DISCORD_ALLOWED_USER_IDS` — comma-separated Discord user snowflake IDs. Messages from any non-listed user are silently ignored.                                  |
| **Channel gating**               | Bot only processes messages in the channel named by `DISCORD_BRIDGE_CHANNEL`. Configured at runtime via `setGuild` + channel name; stored in agent session state. |
| **Command prefix**               | Only messages starting with `DISCORD_COMMAND_PREFIX` (default `!ta`) are processed. Normal conversation is invisible to the dispatcher.                           |
| **Role-based gating** (optional) | Check `message.member.roles.cache` against a configured role ID before passing to dispatcher. Useful for multi-user servers.                                      |
| **No public endpoint**           | The Gateway connection is outbound from the bot. There is no listening port, no webhook URL, and no way for an external actor to trigger execution directly.      |
| **Local dispatcher**             | `createDispatcher()` runs in the same Node process. Actions execute on the local machine under the user's own credentials — no remote code execution surface.     |

### Why Gateway beats a public webhook

A webhook requires Discord to POST to a URL you own, meaning you need a public IP/domain and TLS termination. Any actor who discovers that URL could send forged requests (Discord signature verification helps but adds complexity). Gateway inverts the connection — the bot calls out, not in — so there is literally nothing to reach from the internet.

---

## 4. Discord Gateway Intents Required

| Intent            | Type           | Purpose                                                         |
| ----------------- | -------------- | --------------------------------------------------------------- |
| `GUILDS`          | Standard       | Receive guild/channel metadata                                  |
| `GUILD_MESSAGES`  | Standard       | Receive `messageCreate` events in guild channels                |
| `MESSAGE_CONTENT` | **Privileged** | Read the actual text of messages (required for prefix matching) |

> **Important:** `MESSAGE_CONTENT` must be explicitly enabled in the Discord Developer Portal under the bot's settings page. For bots in fewer than 100 servers this is self-service; beyond 100 servers Discord requires verification and approval.

---

## 5. Key Packages

| Package                                 | Role                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `discord.js`                            | Gateway WebSocket client, `messageCreate` event handling, REST reply via `message.reply()`        |
| `agent-dispatcher` (`createDispatcher`) | Local TypeAgent dispatcher — routes natural language to registered agents, returns `ActionResult` |

Both are already planned or in use in this package. No new external dependencies required beyond `discord.js`.

---

## 6. New TypeAgent Actions

Add to `discordSchema.ts`:

```typescript
export type StartGatewayBridgeAction = {
  actionName: "startGatewayBridge";
  parameters: {
    /** Discord channel name to monitor (e.g. "typeagent-bot") */
    channelName: string;
    /** Comma-separated Discord user IDs to allow */
    allowedUserIds?: string;
    /** Command prefix; defaults to "!ta" */
    commandPrefix?: string;
  };
};

export type StopGatewayBridgeAction = {
  actionName: "stopGatewayBridge";
  parameters: Record<string, never>;
};

export type GetBridgeStatusAction = {
  actionName: "getBridgeStatus";
  parameters: Record<string, never>;
};
```

Handler behavior:

- `startGatewayBridge` — initializes (or reuses) the shared bot process, registers the `messageCreate` listener, persists config to agent session state.
- `stopGatewayBridge` — removes the `messageCreate` listener; leaves the bot process alive if the captions bot is also running.
- `getBridgeStatus` — returns whether the listener is active, which channel is monitored, how many users are on the allowlist, and the command prefix in use.

---

## 7. Shared Bot Process with Captions Bot

The same `discord.js` `Client` instance that drives voice transcription (see `CAPTIONS_BOT.md`) handles message bridging. Both features are registered as event listeners on the same client:

```
Client
 ├── on("voiceStateUpdate") → captions bot logic
 ├── on("messageCreate")    → gateway bridge logic
 └── (shared Gateway connection, single token auth)
```

Lifecycle: the process starts when either feature is activated and shuts down only when both are deactivated. Each feature tracks its own `enabled` flag in agent session state.

---

## 8. Implementation Sketch

```typescript
// Startup
import { awaitCommand } from "@typeagent/dispatcher-types";

const client = getOrCreateSharedClient(); // shared with captions bot
client.login(process.env.DISCORD_BOT_TOKEN);

// messageCreate handler
client.on("messageCreate", async (message) => {
  // 1. Ignore bots
  if (message.author.bot) return;

  // 2. Prefix check
  const prefix = config.commandPrefix ?? "!ta";
  if (!message.content.startsWith(prefix)) return;

  // 3. Channel check
  if (message.channel.name !== config.bridgeChannelName) return;

  // 4. User allowlist check
  if (!config.allowedUserIds.includes(message.author.id)) return;

  // 5. Signal processing (typing indicator)
  await message.channel.sendTyping();

  // 6. Strip prefix, dispatch
  const userInput = message.content.slice(prefix.length).trim();
  const result = await awaitCommand(dispatcher, userInput);

  // 7. Format and reply (respect 2000-char Discord limit)
  const text = formatActionResult(result);
  const chunks = splitAt2000(text);
  for (const chunk of chunks) {
    await message.reply(chunk);
  }
});

// helpers
function splitAt2000(text: string): string[] {
  const MAX = 1990; // leave room for Discord overhead
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX));
  }
  return chunks;
}
```

---

## 9. Configuration

| Env Var                    | Required | Default | Description                                          |
| -------------------------- | -------- | ------- | ---------------------------------------------------- |
| `DISCORD_BOT_TOKEN`        | Yes      | —       | Bot token from Discord Developer Portal              |
| `DISCORD_ALLOWED_USER_IDS` | Yes      | —       | Comma-separated snowflake IDs of permitted users     |
| `DISCORD_BRIDGE_CHANNEL`   | Yes      | —       | Channel name the bot monitors (e.g. `typeagent-bot`) |
| `DISCORD_COMMAND_PREFIX`   | No       | `!ta`   | Prefix that triggers TypeAgent dispatch              |

These can be loaded from `.env` (already used by the agent package) or overridden at runtime via `startGatewayBridge` action parameters, which take precedence and are stored in agent session state.

---

## 10. Known Challenges

| Challenge                               | Mitigation                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Response latency (3–10 s)**           | Call `message.channel.sendTyping()` immediately — Discord shows a "Bot is typing…" indicator for up to 10 s. Chain `sendTyping()` calls if dispatch takes longer.                                     |
| **2000-char message limit**             | Use `splitAt2000()` helper to chunk long `ActionResult` text into sequential replies. Consider a `…(truncated)` suffix if content is excessively long.                                                |
| **`MESSAGE_CONTENT` privileged intent** | Must be manually enabled in Dev Portal. Document clearly in README. For bots joining 100+ guilds, Discord requires verification — keep this bot private/single-server.                                |
| **Gateway disconnects**                 | `discord.js` automatically reconnects on transient drops. For persistent failures, add a `client.on("error")` / `client.on("shardDisconnect")` handler that logs and attempts re-login after backoff. |
| **Dispatcher initialization cost**      | `createDispatcher()` is expensive — call once at bot startup, not per message. Hold a module-level reference.                                                                                         |
| **Concurrent requests**                 | Discord users could fire multiple `!ta` commands quickly. Add a per-user in-flight lock or queue to avoid dispatcher re-entrancy issues.                                                              |
