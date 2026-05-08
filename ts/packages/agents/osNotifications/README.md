# OS Notifications Agent

Forwards OS-level notifications (Windows Action Center, Linux freedesktop) into TypeAgent chat as **ephemeral** toasts/inline messages. macOS is not supported.

The agent is **off by default** and must be enabled explicitly:

```
@config agent enable osNotifications
```

## Lifecycle

The watcher lives in `startBackgroundTasks` / `stopBackgroundTasks` rather than `updateAgentContext`. Even though the agent now has actions (and so `updateAgentContext` would fire when actions are enabled), the watcher is conceptually a session-scoped background task — exactly what `startBackgroundTasks` is for, per the SDK comment.

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
initializeAgentContext()        ← returns empty agent context (with ChoiceManager)
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

## Diagnostic actions and commands

Two diagnostic operations exposed both as actions (natural-language) and as `@osNotifications` subcommands. Both forms drive the same code path — the action handler is the source of truth, the commands are thin wrappers.

| Action                | NL examples                                                                     | Command                       | What it does                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `syncOsNotifications` | "sync os notifications", "show my notifications", "replay system notifications" | `@osNotifications sync`       | Re-emits currently-present notifications through the agent pipeline (filters, rate limit, dismiss tracking apply).                    |
| `testOsNotification`  | "test notification saying hi", "send me a test notification with foo"           | `@osNotifications test "msg"` | Synthesizes an `OsNotificationAdded` event and feeds it into `onWatcherEvent` — verifies the agent end-to-end with no real OS source. |

### Sync and setup

`syncOsNotifications` is Windows-only (Linux's freedesktop spec doesn't expose existing notifications, only new ones — the action surfaces a clear warning instead).

On Windows, the agent participates in the dispatcher's [readiness/setup framework](../../dispatcher/dispatcher/src/context/appAgentManager.ts):

- `checkReadiness` → `setup-required` when `OsNotificationListener.exe` isn't present, `ready` otherwise.
- `setup` → returns the in-chat yes/no card asking whether to build the helper now. Click "Yes" and `buildAndRetrySync` runs the full WinAppSDK build/sign/register pipeline (see "Per-platform setup → Windows" below), then restarts the watcher.

Pre-flight at the dispatcher level means `@osNotifications sync` (or any NL form like "sync os notifications") on a system without the helper is blocked before the agent's code runs and the user is pointed at:

```
@config agent setup osNotifications
```

That command surfaces the build prompt. The choice card is wired via the standard `ChoiceManager` + `handleChoice` pattern (`ChoiceManager` lives on `AgentContext`; the AppAgent's `handleChoice` delegates back to it). A build mutex (`AgentContext.buildInProgress`) protects against two clients each clicking "Yes" on their own card before either build completes.

### Commands sharing the action code path

`@osNotifications sync` and `@osNotifications test` live alongside the actions because some users prefer explicit command invocation over conversational form. Each command builds the corresponding `TypeAgentAction` object and `return`s the result of the same `performSync` / `performTest` helper the action handler uses.

This works because command handlers can now opt in to returning an `ActionResult` (signature: `Promise<ActionResult | undefined | void>`). The dispatcher's command pipeline runs the same post-execution processing as the action pipeline — display content, `pendingChoice` (in-chat yes/no card), `dynamicDisplayId` — so command and NL invocations render identically. Returning `void` keeps the legacy "use `actionIO` directly" pattern; both are supported.

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

**The exe needs package identity to subscribe to `NotificationChanged`.** That's the API that gives us realtime events (no polling, no 3-second delay). On a plain unpackaged exe the subscription silently fails. We solve this with a [WinAppSDK sparse package](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps): a tiny MSIX containing only an `AppxManifest.xml` that declares the identity + `userNotificationListener` capability, signed with our dev cert, and registered against the unpackaged exe via `Add-AppxPackage -ExternalLocation`. The exe carries a side-by-side `<msix>` element in its `app.manifest` linking it to the identity package.

**One-time prereqs:**

1. **Pull the dev code-signing cert from Azure Key Vault** — the dev cert is held in the `aisystems` Key Vault as `TypeAgent-Development-Certificate` (with its PFX password as a sibling secret). The included [`getCert.mjs`](../../../tools/getCert.mjs) tool wraps the download:

    ```powershell
    # Pull cert + password to %TEMP%\TypeAgent-Development-Certificate.pfx
    node ts/tools/scripts/getCert.mjs pull
    ```

2. **Install the cert into both CurrentUser and LocalMachine stores.** AppX deployment runs in SYSTEM context and only honors LocalMachine certs, so the cert must live there for `Add-AppxPackage` to accept the MSIX signature. SignTool itself uses CurrentUser. Use the helper in elevated PowerShell:

    ```powershell
    node ts/tools/scripts/getCert.mjs install --trusted-root
    ```

    `install` puts the cert in `CurrentUser\My`, `CurrentUser\TrustedPeople`, `LocalMachine\My`, `LocalMachine\TrustedPeople`. `--trusted-root` additionally adds it to `LocalMachine\Root` so AppX deployment trusts the chain (interactive — Windows will prompt for consent on the root install).

3. **Cert renewal.** If signtool fails with "no Code Signing EKU found", the cert needs a new version with the right EKU:

    ```powershell
    node ts/tools/scripts/getCert.mjs renew
    node ts/tools/scripts/getCert.mjs install --trusted-root
    ```

**Build the helper:**

The agent's `setup` hook does this end-to-end — clean + publish the exe, pack the identity manifest, sign the MSIX, register the sparse package. From chat:

```
@config agent setup osNotifications
```

The yes/no card spells out what's about to happen. Build progress streams inline.

For manual builds (debugging, CI):

```powershell
cd dotnet/osNotificationListener
dotnet publish -c Release -r win-x64 -o publish

# pack identity MSIX
makeappx pack /o /d identity /nv /p TypeAgent.OsNotificationListener.msix
signtool sign /sha1 <thumbprint> /fd SHA256 TypeAgent.OsNotificationListener.msix

# register sparse package against the unpackaged exe
Add-AppxPackage -Path TypeAgent.OsNotificationListener.msix -ExternalLocation publish
```

The exe ends up in `dotnet/osNotificationListener/publish/OsNotificationListener.exe`. The TypeScript watcher locates it via `import.meta.url` — checks `publish/` first, falls back to the project root for legacy hand-built copies.

See [`../../../../dotnet/osNotificationListener/README.md`](../../../../dotnet/osNotificationListener/README.md) for the C# helper details.

### Linux

In-process via `dbus-next`. Eavesdrops on `org.freedesktop.Notifications.Notify` calls on the session bus. No build step required.

The agent surfaces a one-time warning if `AddMatch` fails — typically because the bus policy denies eavesdropping. On most user desktops this works out of the box.

### macOS

Unsupported. Apple does not expose other apps' notifications via a public API. The agent emits a one-time info notification explaining this and otherwise idles.

## Caveats

### Windows: package identity

`UserNotificationListener` works from unpackaged hosts on most modern builds, but its `NotificationChanged` event (the one that gives us realtime updates instead of polling) requires package identity. The sparse-package setup above gives the helper exe identity without bundling it as a full MSIX app — the WinAppSDK side-by-side manifest (`<msix>` element pointing at `TypeAgent.OsNotificationListener` in the exe's `app.manifest`) tells Windows where to find the identity package at runtime.

If something is wrong with the sparse-package setup (missing cert trust, expired signature, registration failed), the helper emits a `kind:"error"` event with details and the agent surfaces it once. Run `@config agent refresh osNotifications` after fixing the underlying issue.

### Windows: first-run consent

Windows shows a system-level prompt the first time `RequestAccessAsync` is called. The user can revoke consent later from **Settings → Privacy & security → Notifications**. The helper exits with code 2 if access is denied.

### Windows: cert trust store split

`Add-AppxPackage` runs the signature check from a SYSTEM-context process and only consults `LocalMachine` cert stores. SignTool, which runs as the user, only consults `CurrentUser`. The cert must therefore live in **both** trees, and the chain has to terminate in `LocalMachine\Root` for AppX deployment to accept it. The two-step `getCert.mjs install --trusted-root` flow handles all of that, but the underlying fact is worth knowing — failures present as `CERT_E_UNTRUSTEDROOT (0x800B0109)` from `Add-AppxPackage` even when SignTool succeeded.

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

- **Prebuilt Windows artifacts.** The C# helper exe is shipped as source — every checkout needs `dotnet publish` + the sparse-package register flow to make Windows work. CI should produce a signed MSIX + the published exe and bundle them into `dist/`. Bigger lift than just shipping a binary because of the cert + sparse-package angle, but this is the long-pole prereq for a one-click install.

- **Production cert.** Today we use a dev cert from the `aisystems` Key Vault. Shipping outside the dev team needs an actual EV / publicly-trusted cert and a different MSIX publisher subject; the manifest's `<Identity Publisher="...">` is hard-coded today.

## Files

```
src/
  osNotificationsManifest.json     # agent metadata, defaultEnabled: false, schema ref
  osNotificationsSchema.ts         # action types: SyncOsNotifications, TestOsNotification
  osNotificationsSchema.agr        # NL grammar — "sync os notifications" / "test notification …"
  osNotificationsConfig.ts         # render config + defaults
  osNotificationsActionHandler.ts  # AppAgent: actions, commands, watcher lifecycle
  watcherProtocol.ts               # added / removed / error wire types (+ fromSync flag)
  watchers/
    index.ts                       # platform dispatcher
    windowsWatcher.ts              # spawns the helper; isWindowsHelperBuilt(); buildWindowsHelper() (full sign+register pipeline)
    linuxWatcher.ts                # in-process dbus-next eavesdrop
    noopWatcher.ts                 # macOS / unsupported platforms
```

The C# helper lives outside this package, alongside the other repo .NET projects: [`dotnet/osNotificationListener/`](../../../../dotnet/osNotificationListener/) (Program.cs, OsNotificationListener.csproj, identity/AppxManifest.xml).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
