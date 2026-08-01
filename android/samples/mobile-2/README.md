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
- DevTunnel authentication via `X-Tunnel-Authorization` header
- Build-time configuration via environment variables and `BuildConfig`

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

