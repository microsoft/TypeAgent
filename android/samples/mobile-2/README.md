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
- Chat history that survives both configuration changes and process death, and
  resumes the same server-side conversation (see
  [Conversation persistence](#conversation-persistence))
- DevTunnel authentication via `X-Tunnel-Authorization` header
- Build-time configuration via environment variables and `BuildConfig`

## Conversation persistence

The chat conversation is owned by a `ViewModel`, so rotation, theme, font-scale
and locale changes no longer tear down the socket and the transcript.

A `ViewModel` dies with its process though, which Android does routinely once the
app is backgrounded. The transcript is therefore mirrored to `SharedPreferences`
by `ConversationStore` and restored on the next start, capped at the most recent
`ConversationSerializer.MAX_PERSISTED_MESSAGES` messages. The server cannot fill
this gap for this client: it reads no display history, so the client has to own
its own transcript.

The joined `conversationId` is stored alongside the messages and passed back into
`joinConversation` as a connect option on the next launch, so the client resumes
the exact conversation the transcript belongs to rather than landing on the
server's default one. If the server no longer has that conversation it answers
`Conversation not found`; the join then falls back to the default conversation
once and the orphaned transcript is dropped from both screen and disk. Every
other join failure - transport, tunnel auth - still surfaces as a connection
error, so an outage cannot silently move the user into a different conversation.

> **Terminology.** This is a *conversation* (user-facing identity and chat
> history), not a dispatcher *session* (configuration, caches, agent state).
> The `SharedPreferences` file is still named `typeagent_chat_session.xml`
> because that name is pinned in the backup rules and already exists on devices;
> renaming it would orphan stored transcripts.

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
rest of the conversation rather than disappearing mid-chat.

Saving is debounced (`ChatViewModel.SAVE_DEBOUNCE_MS`). `SharedPreferences`
rewrites its entire file on every commit and the message list re-emits on every
streaming chunk, so an undebounced save would rewrite the whole blob dozens of
times per reply.

The transcript is excluded from Android's Auto Backup (`backup_rules.xml` and
`data_extraction_rules.xml`), so conversations are never uploaded to the user's
cloud account. A direct device-to-device transfer does carry it, since that
copies straight to the new phone without a cloud round trip.

**Clear chat** in the header removes the transcript from both the screen and disk
after a confirmation. It is a client-side reset only, matching `@clear` on the
other TypeAgent canvases: the conversation itself is untouched, so the agent
keeps its memory and the next launch resumes the same conversation.

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
| `setAlarm` | `AlarmClock.ACTION_SET_ALARM` | Scheduled in the background (`EXTRA_SKIP_UI = true`) and confirmed with a toast. The optional `days` parameter takes lowercase weekday names and becomes a repeating alarm via `EXTRA_DAYS`; an unrecognised name fails the whole action rather than setting the alarm on a subset of the days asked for. |
| `setTimer` | `AlarmClock.ACTION_SET_TIMER` | Starts the countdown in the background (`EXTRA_SKIP_UI = true`) and confirms with a toast, so a chat request never yanks the user out of the conversation. Durations outside the documented 1..86400 second range are rejected rather than clamped. |
| `showAlarms` | `AlarmClock.ACTION_SHOW_ALARMS` | Opens the clock app's alarm list. Takes no parameters, so the dispatcher sends no `parameters` object and the parser must not require one. |
| `showTimers` | `AlarmClock.ACTION_SHOW_TIMERS` | Opens the clock app's timer list. Added in API 26; on API 24–25 the action reports that the device does not support it instead of throwing. |
| `searchNearby` | `Intent.ACTION_VIEW` with a `geo:0,0?q=` URI | Opens the device's maps app on a local search. The intent is implicit rather than pinned to Google Maps, so it resolves on any device with a maps app. |
| `showLocation` | `Intent.ACTION_VIEW` with a `geo:0,0?q=` URI | Shows one named place. `0,0` means "wherever the query resolves to", so no location permission is involved and no device coordinates are read. |
| `dialPhoneNumber` | `Intent.ACTION_DIAL` with a `tel:` URI | Only pre-fills the dialer — the user still presses call, so no `CALL_PHONE` permission is needed and a hallucinated number cannot dial itself. Numbers are held to a dialable charset and rejected, never rewritten. |
| `composeSms` | `Intent.ACTION_SENDTO` with an `smsto:` URI and `sms_body` | Opens a pre-filled draft — the user still presses send, so no `SEND_SMS` permission is needed. With no recipient the draft opens with an empty To field; an *unusable* recipient is rejected rather than silently dropped. |
| `webSearch` | `Intent.ACTION_WEB_SEARCH` with `SearchManager.QUERY` | The query travels as an extra rather than being spliced into a URL, so it needs no encoding. |
| `openWebPage` | `Intent.ACTION_VIEW` with an `http`/`https` URI | The scheme allowlist is the load-bearing check: `ACTION_VIEW` would otherwise follow `market:`, `file:` or any app's own deep-link scheme, turning "open this page" into an arbitrary-app launcher driven by text the model read. URLs containing whitespace are refused rather than repaired into a different host. |
| `composeEmail` | `Intent.ACTION_SENDTO` with a bare `mailto:` URI plus `EXTRA_EMAIL`/`EXTRA_CC`/`EXTRA_BCC` | Opens a draft — the user still presses send, so nothing leaves the device unattended. `ACTION_SENDTO` is used rather than `ACTION_SEND` so only mail apps resolve, not every share target. Recipients ride as extras rather than being spliced into the URI, which keeps encoding out of the picture. One unusable address fails the whole action: a draft addressed to fewer people than asked for looks like success. |
| `shareText` | `Intent.ACTION_SEND` (`text/plain`) wrapped in `Intent.createChooser` | The user picks the destination app, so the model never chooses where the text goes. `createChooser` always resolves, so the inner `ACTION_SEND` intent is resolved first — otherwise a device with no text handler would report a false success. Newlines survive here (unlike the URI-bound actions) because shared text is a document, not a query. |
| `openSettings` | `Settings.ACTION_*` for a fixed screen | The model picks from a closed `AndroidSettingsScreen` enum, never a raw action string, so it cannot be steered into an arbitrary system activity. Screens only *display* settings; nothing is toggled. `appInfo` is pinned to this app's own package. |
| `createCalendarEvent` | `Intent.ACTION_INSERT` on `CalendarContract.Events.CONTENT_URI` | Opens the calendar app's pre-filled *new event* editor — the user still saves it, so no `WRITE_CALENDAR` permission is needed. Times are ISO-8601 and are resolved without `java.time` (minSdk 24). All-day events are anchored at UTC midnight as `CalendarContract` requires; an all-day event that also carries a time of day is rejected rather than guessed at. Spans longer than 366 days are refused. |
| `playMusicFromSearch` | `MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH` | Asks whichever music app claims the intent to play the best match. What actually plays is up to that app, so the action reports what it dispatched, not what started. An unrecognised `focus` fails rather than falling back to `any`, which would quietly search for something broader than asked. |

All actions require the app to be in the foreground: Android 10+ silently refuses
background activity starts (no exception is thrown), so the app checks its own
lifecycle state first and reports a failure rather than a false confirmation.

The clock actions require the `com.android.alarm.permission.SET_ALARM` permission
(declared in the manifest, install-time only). Every action needs a matching
`<queries>` entry so `resolveActivity` works under Android 11+ package
visibility rules.

The registered client agent needs nothing installed on the server side. Use
`@action` for a deterministic registration test:

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
