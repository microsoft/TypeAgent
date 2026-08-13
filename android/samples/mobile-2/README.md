# Mobile 2 - TypeAgent Android Chat Sample

An Android Jetpack Compose chat client that connects to a TypeAgent agent-server via [Microsoft DevTunnel][devtunnel].

## What this sample demonstrates

- Jetpack Compose chat UI (message history, streaming bubbles, connection status, send button)
- OkHttp WebSocket usage on Android
- TypeAgent agent-server RPC protocol:
  - `joinConversation` / `submitCommand`
  - `registerClientAgent` with an inline action schema
  - Client-hosted `executeAction` callbacks
  - Inbound `appendDisplay`, `setDisplay`, `setDisplayInfo`, and command completion events
- Incremental assistant response streaming into a single bubble per `requestId`, honouring
  the SDK's `DisplayAppendMode` (`inline`, `block`, `temporary`, `step`) and
  `DisplayMessageKind` styling the same way the Electron shell does
- DevTunnel authentication via `X-Tunnel-Authorization` header
- Build-time configuration via environment variables and `BuildConfig`

## Client-hosted Android agent

After joining a conversation, the app registers `androidDevice` as a
client-hosted agent. Its action schema is packaged in the APK and sent inline to
TypeAgent. TypeAgent translates or directly invokes the typed action, then calls
`executeAction` on the app over the existing WebSocket connection, and the app
reports success or failure back as the action result.

This is the only path for device actions. The legacy fire-and-forget
`takeAction` path served by the server-side `androidMobile` agent has been
removed; the `clientio:` channel is still used, but only for display and user
interaction traffic.

| Schema action | Android intent | Notes |
|---|---|---|
| `setAlarm` | `AlarmClock.ACTION_SET_ALARM` | Opens the clock app so the user can confirm the alarm. |
| `setTimer` | `AlarmClock.ACTION_SET_TIMER` | Starts the countdown in the background (`EXTRA_SKIP_UI = true`) and confirms with a toast, so a chat request never yanks the user out of the conversation. Durations outside the documented 1..86400 second range are rejected rather than clamped. |
| `searchNearby` | `Intent.ACTION_VIEW` with a `geo:0,0?q=` URI | Opens the device's maps app on a local search. The intent is implicit rather than pinned to Google Maps, so it resolves on any device with a maps app. |

All actions require the app to be in the foreground: Android 10+ silently refuses
background activity starts (no exception is thrown), so the app checks its own
lifecycle state first and reports a failure rather than a false confirmation.

The clock actions require the `com.android.alarm.permission.SET_ALARM` permission
(declared in the manifest, install-time only). Every action needs a matching
`<queries>` entry so `resolveActivity` works under Android 11+ package
visibility rules.

The registered client agent does not require installing the server-side
`androidMobile` package. Use `@action` for a deterministic registration test:

```text
@action --parameters {"originalRequest":"timer","durationInSeconds":30} androidDevice setTimer
```

```text
@action --parameters {"originalRequest":"alarm","time":"12:00"} androidDevice setAlarm
```

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
