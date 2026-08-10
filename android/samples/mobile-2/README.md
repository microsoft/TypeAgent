# Mobile 2 - TypeAgent Android Chat Sample

An Android Jetpack Compose chat client that connects to a TypeAgent agent-server via [Microsoft DevTunnel][devtunnel].

## What this sample demonstrates

- Jetpack Compose chat UI (message history, streaming bubbles, connection status, send button)
- OkHttp WebSocket usage on Android
- TypeAgent agent-server RPC protocol:
  - `joinConversation` / `submitCommand`
  - Inbound `appendDisplay`, `setDisplay`, `setDisplayInfo`, and command completion events
  - Inbound `takeAction` client actions
- Incremental assistant response streaming into a single bubble per `requestId`, honouring
  the SDK's `DisplayAppendMode` (`inline`, `block`, `temporary`, `step`) and
  `DisplayMessageKind` styling the same way the Electron shell does
- Chat history that survives both configuration changes and process death (see
  [Session persistence](#session-persistence))
- DevTunnel authentication via `X-Tunnel-Authorization` header
- Build-time configuration via environment variables and `BuildConfig`

## Session persistence

The chat session is owned by a `ViewModel`, so rotation, theme, font-scale and
locale changes no longer tear down the socket and the transcript.

A `ViewModel` dies with its process though, which Android does routinely once the
app is backgrounded. The transcript is therefore mirrored to `SharedPreferences`
by `ChatSessionStore` and restored on the next start, capped at the most recent
`ChatSessionSerializer.MAX_PERSISTED_MESSAGES` messages. The server cannot fill
this gap: `agent-server` exposes no history RPC, so the client has to own its own
transcript.

The joined `conversationId` is stored alongside the messages. `joinConversation`
normally returns the same conversation every time, so a restored transcript still
matches what the agent remembers; if the server does hand back a different
conversation the stale transcript is dropped rather than shown as history the
agent has no memory of.

### What is stored, and for how long

Everything lives in one private `SharedPreferences` file inside the app's own
sandbox (`typeagent_chat_session.xml`), readable only by this app. Nothing is
written to shared or external storage.

Two independent limits keep it from growing without end:

| Limit | Constant | Effect |
|---|---|---|
| Size | `MAX_PERSISTED_MESSAGES` (200) | Only the newest 200 messages are kept. A full 200-message transcript measures ~59 KB. |
| Age | `MAX_MESSAGE_AGE_MILLIS` (30 days) | Messages older than the window are deleted, including while the app is not running. |

Retention runs on both save and load. Because a load only *filters* what it
reads, a read that drops anything immediately rewrites the file, so expired
messages are erased rather than merely hidden. Expiry is applied to what is
stored, not to what is already on screen: messages already visible stay for the
rest of the session rather than disappearing mid-conversation.

Saving is debounced (`ChatViewModel.SAVE_DEBOUNCE_MS`). `SharedPreferences`
rewrites its entire file on every commit and the message list re-emits on every
streaming chunk, so an undebounced save would rewrite the whole blob dozens of
times per reply.

The transcript is excluded from Android's Auto Backup (`backup_rules.xml` and
`data_extraction_rules.xml`), so conversations are never uploaded to the user's
cloud account. A direct device-to-device transfer does carry it, since that
copies straight to the new phone without a cloud round trip.

**New chat** in the header clears the transcript from both the screen and disk
after a confirmation. It is a client-side reset: the agent keeps its own
server-side memory of the conversation.

## Device actions

The app implements the `takeAction` client actions emitted by the `androidMobile`
agent. Unknown actions are logged and ignored, so the app stays compatible with
servers that emit actions this sample does not support.

| Client action | Android intent | Notes |
|---|---|---|
| `set-alarm` | `AlarmClock.ACTION_SET_ALARM` | Opens the clock app so the user can confirm the alarm. |
| `set-timer` | `AlarmClock.ACTION_SET_TIMER` | Starts the countdown in the background (`EXTRA_SKIP_UI = true`) and confirms with a toast, so a chat request never yanks the user out of the conversation. Durations outside the documented 1..86400 second range are rejected rather than clamped. |

Both actions require the app to be in the foreground: Android 10+ silently refuses
background activity starts (no exception is thrown), so the app checks its own
lifecycle state first and reports a failure rather than a false confirmation.

Both require the `com.android.alarm.permission.SET_ALARM` permission (declared in
the manifest, install-time only) and matching `<queries>` entries so
`resolveActivity` works under Android 11+ package visibility rules.

> `set-timer` requires the server-side `androidMobile` `setTimer` action. Install
> the agent with `@package install androidMobile` in the TypeAgent CLI/shell.

## Prerequisites

- Android Studio (recent stable version)
- A TypeAgent agent-server exposed via DevTunnel — see `TypeAgent/ts/examples/remoteClient/README.md` for server setup
- [DevTunnel CLI][devtunnel-cli]

## Configuration

Once your server is running and tunnelled, set these two environment variables **before building** the app:

| Variable | Required | Description |
|---|---|---|
| `TYPEAGENT_SERVER_URL` | **Yes** | DevTunnel WebSocket URL (e.g. `wss://abc123xyz-8999.devtunnels.ms`) |
| `TYPEAGENT_TUNNEL_TOKEN` | **Yes** | DevTunnel access token |

```powershell
# PowerShell (Windows)
$env:TYPEAGENT_SERVER_URL  = "wss://abc123xyz-8999.devtunnels.ms"
$env:TYPEAGENT_TUNNEL_TOKEN = "<your token>"
```

```bash
# macOS / Linux
export TYPEAGENT_SERVER_URL="wss://abc123xyz-8999.devtunnels.ms"
export TYPEAGENT_TUNNEL_TOKEN="<your token>"
```

## Build and run

1. Open this folder (`android/samples/mobile-2`) in Android Studio
2. Let Gradle sync finish
3. Run **Build → Rebuild Project** to pick up the environment variables
4. Run the `app` module on your device

The app connects automatically on launch. Tap **Retry** in the status bar if the connection fails.

> Rebuild whenever you change `TYPEAGENT_SERVER_URL` or `TYPEAGENT_TUNNEL_TOKEN` — these values are embedded at compile time.

## Security Notes

- **Token storage**: `TYPEAGENT_TUNNEL_TOKEN` is compiled into `BuildConfig`. Do not distribute APKs built with a sensitive or long-lived token.
- **Token transmission**: The token is sent only as an HTTP upgrade header and is never logged.

[devtunnel]: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/
[devtunnel-cli]: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started

