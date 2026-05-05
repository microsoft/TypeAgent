# OS Notifications Agent

Forwards OS-level notifications (Windows Action Center, Linux freedesktop) into TypeAgent chat as **ephemeral** toasts/inline messages. macOS is not supported.

The agent is **off by default** and must be enabled explicitly:

```
@config agent enable osNotifications
```

## Lifecycle

Because this agent has no schema, no actions, and no commands, it relies on the `startBackgroundTasks` / `stopBackgroundTasks` lifecycle hooks rather than `updateAgentContext` (which is only called when an action is enabled — see [`appAgentManager.setState()`](../../dispatcher/dispatcher/src/context/appAgentManager.ts) for the reasoning).

```
@config agent enable osNotifications
        │
        ▼   AgentToggle.Agent flips schemas/actions/commands
        │
[appAgentManager.setState — commands enable]
        │
        ▼
[ensureSessionContext]
        │
        ▼
initializeAgentContext()        ← returns empty agent context
        │
        ▼
startBackgroundTasks(ctx)       ← watcher starts, attached to ctx.agentContext
        │
        ▼
   (running) — watcher callback emits via context.notify(...)
        │
@config agent disable osNotifications
        │
        ▼
[closeSessionContext]
        │
        ▼
stopBackgroundTasks(ctx)        ← watcher.stop() awaited first, no notify races
        │
        ▼
closeAgentContext(ctx)          ← (not implemented — no extra cleanup needed)
```

## How it works

```
[per-OS watcher]                                [chat clients]
     │  added/removed events                          ▲
     ▼                                                │
[osNotifications agent] ── sessionContext.notify ──── │
     - app filter                                     │
     - rate limit                                     │ broadcast
     - "new only" timestamp gate                      │ (every connected
     - dismiss tracking                               │  client)
                                                      │
                                          [shell renderer / CLI]
                                          - chat bubble (toast / inline / info)
                                          - removed on osDismiss
                                          - NOT recorded in @notify show
                                          - NOT persisted to DisplayLog
```

The agent uses `sessionContext.notify(...)` with no `persist` flag, so notifications never enter the `displayLog.json`. Lifecycle is bounded by the OS notification center: when the OS reports a notification has been dismissed, the agent emits an `osDismiss` event and the chat bubble is removed from the DOM.

## Configuration

Defaults live in [`src/osNotificationsConfig.ts`](src/osNotificationsConfig.ts):

| Field          | Default       | Notes                                                                       |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| `mode`         | `"toast"`     | `toast` / `inline` / `info` — maps to `AppAgentEvent.{Toast,Inline,Info}`   |
| `routing`      | `"broadcast"` | `broadcast` to every client; `currentOnly` is a TODO (see below)            |
| `redactBody`   | `false`       | When true, drop body and forward title + app only                           |
| `bodyMaxChars` | `200`         | Body truncated with `…` past this length                                    |
| `allowList`    | _(unset)_     | When set + non-empty, only these app names pass (case-insensitive equality) |
| `blockList`    | _(unset)_     | Drop matching apps. Ignored if `allowList` is set                           |
| `maxPerMinute` | `20`          | Rolling 60s window — excess notifications are silently dropped              |

> **Privacy note.** Notification bodies often contain message previews, calendar event titles, and 2FA codes. We do **not** filter 2FA — the user usually needs to see those. If you want stricter privacy, set `redactBody: true` or use `allowList` to forward only specific apps.

## Per-platform setup

### Windows

The Windows watcher spawns a small .NET console exe that subscribes to `Windows.UI.Notifications.Management.UserNotificationListener` and streams events as JSON-per-line on stdout.

**Build the helper:**

```powershell
cd packages/agents/osNotifications/bin/OsNotificationListener
dotnet publish -c Release -r win-x64 -o ../../dist/bin/OsNotificationListener
```

The agent's `postbuild` script (`copyfiles -u 1 "bin/**/*" dist`) only copies the source files — the exe must be built separately and ends up in `dist/bin/OsNotificationListener/OsNotificationListener.exe`. The TypeScript watcher locates the exe via `import.meta.url`.

See [`bin/OsNotificationListener/README.md`](bin/OsNotificationListener/README.md) for build details and the package-identity caveat.

### Linux

In-process via `dbus-next`. Eavesdrops on `org.freedesktop.Notifications.Notify` calls on the session bus. No build step required.

The agent surfaces a one-time warning if `AddMatch` fails — typically because the bus policy denies eavesdropping. On most user desktops this works out of the box.

### macOS

Unsupported. Apple does not expose other apps' notifications via a public API. The agent emits a one-time info notification explaining this and otherwise idles.

## Caveats

### Windows: package identity

`UserNotificationListener` was originally a UWP API. Microsoft has loosened the requirement over time, but on some Windows builds the API returns `AccessStatus.Denied` when called from an unpackaged Electron host. The helper emits a `kind:"error"` event in that case; the agent surfaces the error once and stops trying. If you ship via MSIX / sparse package, the API just works.

### Windows: first-run consent

Windows shows a system-level prompt the first time `RequestAccessAsync` is called. The user can revoke consent later from **Settings → Privacy & security → Notifications**. The helper exits with code 2 if access is denied.

### Windows: WinAppSDK coverage

WinAppSDK has been moving some notification types onto its own APIs in Windows 11. The listener still surfaces standard toast notifications, but very new app frameworks may bypass it.

### Linux: eavesdrop policy

Modern `dbus-broker` configurations may require a permissive policy or specific group membership for eavesdropping to succeed. The agent surfaces the error and continues idling — no graceful degradation to "your own notifications only".

### Linux: GNOME / KDE coverage gap

GNOME and some KDE apps have moved certain notification types onto their own portals (e.g. GNOME's notification daemon's private interface). Those will not appear in our stream. v1 accepts the gap.

### Linux: dismiss correlation

The freedesktop `Notify` method returns a u32 id, but eavesdropping doesn't see method replies, only calls. We can correlate `NotificationClosed` signals with our `added` events only when `replaces_id > 0`. Notifications without a replace id are best-effort dismissed when the platform reports closure on a matching id; otherwise the chat bubble stays until the agent is disabled.

## TODOs

- **`currentOnly` routing.** Today this falls back to broadcast — agent-server has no signal for "the conversation the user is currently focused on" (only `connectionId` per client). Add a "primary client" or "active conversation" concept to `sharedDispatcher` and have this agent build a synthetic `RequestId` in that mode.

- **Initial-sync option.** Currently we drop notifications older than `enabledAt` (with a 2s grace). A future config knob `initialSync: "none" | "current"` could let users opt into flushing the existing action center contents on agent enable.

- **Per-app config UX.** `allowList` / `blockList` are static today. A discovery flow ("you just dropped a notification from Slack — add it to the allowlist?") would be much friendlier than asking users to edit JSON.

- **Body redaction templates.** `redactBody: true` is all-or-nothing. Per-app rules (e.g. "for Authy show title only") would be a richer privacy story.

- **Reconciliation with `beginAgentThread`.** A parallel work-in-progress feature adds `beginAgentThread()` — an agent-initiated UI message API with its own `bubble | toast | inline` `kind` field. There's overlap with this agent's render-mode config. Worth a design pass once both have landed.

- **Prebuilt Windows binary.** The C# helper exe is shipped as source, not a prebuilt binary — every checkout needs `dotnet publish` to make Windows work. CI should produce and bundle the `.exe` alongside the agent's `dist/`.

## Files

```
src/
  osNotificationsManifest.json     # agent metadata, defaultEnabled: false
  osNotificationsConfig.ts         # config types + defaults
  osNotificationsActionHandler.ts  # AppAgent — filter, rate limit, dismiss
  watcherProtocol.ts               # added / removed / error wire types
  watchers/
    index.ts                       # platform dispatcher
    windowsWatcher.ts              # spawns the C# helper, parses JSON-per-line
    linuxWatcher.ts                # in-process dbus-next eavesdrop
    noopWatcher.ts                 # macOS / unsupported platforms

bin/
  OsNotificationListener/          # C# helper source (Windows only)
    Program.cs
    OsNotificationListener.csproj
    README.md
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
