# Design: Progress output for `@package install`

Status: **Draft for review**
Scope: `ts/packages/defaultAgentProvider`
Consumer: `@package install` (the same pattern extends to `update` / `uninstall`)

## 0. Goal

`@package install` can run for a long time — the real work is an `npm install`
of the resolved package inside `materialize` — yet today the user sees almost
nothing while it runs. We want to stream live progress **during the install**,
reusing the display surface that already exists. No new dispatcher/SDK primitive
is required.

The per-command status callback (`SourceStatus` / `onStatus`) is already plumbed
from the command handler down to the resolution walk and renders via
`displayStatus`. The only gap is that the longest phase — `materialize` (the
actual `npm install`) — is never handed the callback, so it stays silent. This
design closes that one gap, entirely inside `defaultAgentProvider`.

The command is **synchronous**: the handler `await`s `source.install` to
completion, so the command's `ActionContext` is alive for the whole install and
`displayStatus` is safe throughout (§2.1). An out-of-band primitive that outlives
the turn (`SessionContext.beginAgentThread`) already exists for work that must be
*backgrounded*; the synchronous path here does not need it, and §5 notes where it
would come in if we ever background the install.

## 1. Problem

`@package install` (and `update`) can run for a long time — the actual work is an
`npm install` of the resolved package inside `materialize`. Today the user sees:

- Live status **only during source resolution** (`Resolving '<ref>'…`,
  `Trying source '<name>'…`).
- Nothing during the actual install/materialize (the longest phase).
- A single terminal line when the record is committed.

We want to surface progress **during the install work**, in the session that
issued the command. (Sibling sessions already receive the terminal
"agent added" line when the record fans out — see §2.3 — which is the state
change they care about; streaming install progress into sessions that did not
ask for it is out of scope.)

### Where the gap is today

- The command handler wires an `onStatus` callback to `displayStatus`:
  [`packageAgent.ts` InstallCommandHandler](../../packages/defaultAgentProvider/src/installSources/packageAgent.ts).
- `onStatus` reaches `registry.resolve`, which emits per-source probe messages,
  then calls `materialize` **without** forwarding the callback:
  [`registry.ts` resolveUnlocked](../../packages/defaultAgentProvider/src/installSources/registry.ts).
- The real install runs inside `materialize` → `npmInstall` with no status
  emission:
  [`feedSource.ts` materialize / defaultNpmInstall](../../packages/defaultAgentProvider/src/installSources/feedSource.ts).

## 2. Findings that constrain the design

### 2.1 `ActionContext` lifetime

- Created per command/action by `getActionContext`:
  [`actionContext.ts`](../../packages/dispatcher/dispatcher/src/execute/actionContext.ts).
- For commands, `executeCommand` awaits the handler and calls
  `closeActionContext()` in a `finally`:
  [`actionHandlers.ts` executeCommand](../../packages/dispatcher/dispatcher/src/execute/actionHandlers.ts).
- `closeActionContext()` rewrites every `actionIO` / `actionContext` property to a
  throwing getter **and nulls the closed-over `context`**, so a retained
  reference throws `"Context is closed."` after the turn ends.

**Implication:** streaming `displayStatus` *while the handler is still awaiting*
is safe — which is exactly the synchronous install path (§3). Any
**backgrounded** work (return early, keep installing) cannot use the
`ActionContext` — it must use a session-scoped channel (§5).

### 2.2 Session-scoped output channels

- `SessionContext.notify(event, message, notificationId?)` → routes to
  `clientIO.notify(...)`:
  [`sessionContext.ts`](../../packages/dispatcher/dispatcher/src/execute/sessionContext.ts).
  Rendering depends on `AppAgentEvent`:
  - `Toast` / `Inline` → chat overlays.
  - `Info` / `Warning` / `Error` → notification center (bell), **not** the inline
    chat thread. (See renderer switch in
    [`chatPanelBridge.ts`](../../packages/shell/src/renderer/src/chatPanelBridge.ts).)
- `SessionContext.beginAgentThread(kind)` → mints its own
  `agent-<name>-<uuid>` request id and returns an `AgentThreadHandle`
  (`setDisplay` / `appendDisplay` / `complete`). Renders as a first-class agent
  bubble with in-place `temporary` progress; **survives the `ActionContext`
  teardown** because it is owned by the long-lived `SessionContext`. Works over
  RPC too. Definition:
  [`agentInterface.ts`](../../packages/agentSdk/src/agentInterface.ts).

### 2.3 What already reaches other sessions

- **Provider registration fans out.** `install` calls `fanOutAdd`, which pushes
  `addProvider` to every connected session + the issuing host:
  [`defaultAgentProviders.ts` fanOutAdd](../../packages/defaultAgentProvider/src/defaultAgentProviders.ts).
- Each session applies the op through its **idle-gated FIFO applicator**
  (`AppAgentHostApplicator`):
  [`appAgentHost.ts`](../../packages/dispatcher/dispatcher/src/context/appAgentHost.ts),
  and emits its own terminal "system message" locally
  (`emitAgentChangeNotification`, `AppAgentEvent.Info` from `DispatcherName`):
  [`commandHandlerContext.ts`](../../packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts).
- So the meaningful cross-session event — the agent appearing — already lands
  everywhere. What does **not** fan out is transient *progress* (`displayStatus`
  / `beginAgentThread` are bound to the issuing session's `clientIO`), and for
  this design that is exactly the desired scope: progress is the issuer's
  concern; the terminal add is everyone's.

## 3. Design

Everything below lives in `defaultAgentProvider`. There is no SDK or dispatcher
change: the command already routes `onStatus` to `displayStatus`, so the work is
to (a) give `materialize` the callback and (b) have the feed source emit useful
phase messages while it installs.

### 3.1 Thread `onStatus` into `materialize`

`materialize` is the only step on the install path that is handed no status
callback. Add an optional `onStatus` parameter and forward it from the registry.

- Interface: add `onStatus?: SourceStatus` to `InstallSource.materialize`
  ([`config.ts`](../../packages/defaultAgentProvider/src/installSources/config.ts)).
  `SourceStatus` already exists (`(message: string) => void`).
- Registry: forward the callback the walk already receives into both
  `materialize` call sites in `resolveUnlocked`
  ([`registry.ts`](../../packages/defaultAgentProvider/src/installSources/registry.ts)):
  the explicit-`--source` branch and the ordered-walk branch.
- `path` / `catalog` sources materialize instantly (record data only), so they
  ignore the callback. Only the feed source has a long step to report.

### 3.2 Emit phases from `feedSource.materialize`

[`feedSource.ts` materialize](../../packages/defaultAgentProvider/src/installSources/feedSource.ts)
is where the `npm install` happens. Emit phase markers around it:

- **Fast path** (content-addressed root already present — dedup / same-version
  reinstall): `Reusing installed <module>@<version>…`, then return. No npm run.
- **Slow path**, in order:
  - `Downloading and installing <module>@<version>…` before `npmInstall`.
  - a **heartbeat** while `npmInstall` runs (the opaque long step):
    `Still working… (<N>s elapsed)` every ~2–3s, driven by a timer started
    before the call and cleared in a `finally`. Optional but recommended, since
    `npm install` reports nothing back to us until it exits.
  - `Finalizing…` after the install verifies, before the temp root is adopted as
    the final content-addressed root.

Because `onStatus` is optional and the messages are plain strings, this is a
purely additive change; existing callers that pass no callback are unaffected.

### 3.3 Rendering: the existing `displayStatus` path

No wiring change is needed in the command handler. `InstallCommandHandler.run`
already does
([`packageAgent.ts`](../../packages/defaultAgentProvider/src/installSources/packageAgent.ts)):

```ts
const { source: resolvedSource, warnings } = await source.install(
    name, ref, sourceName, appAgentHost,
    (message) => displayStatus(message, context), // onStatus -> ActionContext
);
```

`displayStatus` writes to the command's `ActionContext`, which is live for the
whole `await` (§2.1). The phase/heartbeat strings from §3.2 flow through the
`onStatus` already passed to `registry.resolve` and now onward into
`materialize`, so they render in-place as the command's status line and clear on
completion — no `beginAgentThread`, no new channel.

## 4. Design decisions / invariants

- **No new surface.** The change is confined to `defaultAgentProvider`: one
  optional parameter on `materialize`, its forwarding in the registry, and phase
  strings in the feed source (`config.ts`, `registry.ts`, `feedSource.ts`).
- **Additive / backward-compatible.** `onStatus` is optional; callers that omit
  it (and the `path` / `catalog` sources that ignore it) are unchanged.
- **Synchronous, so `ActionContext` is valid.** Progress renders through the
  live command context; nothing outlives the turn, so there is no teardown
  hazard (§2.1) and no need for `beginAgentThread`.
- **Fire-and-forget.** Status strings are advisory; nothing awaits them and a
  dropped message only costs a missing progress line.
- **Issuer-scoped.** Progress goes only to the session that ran the command; the
  terminal "agent added" line still fans out to every session via the existing
  `fanOutAdd` path (§2.3).
- **Cancellation (optional).** To make cancel actually stop the install, thread
  the request `abortSignal` into `npmInstall`'s child process; since the command
  is synchronous the signal is available for the whole run.

## 5. Optional: backgrounding the install

The design above keeps the install **synchronous** — the command blocks until the
record is committed. If we later want the command to return immediately and let
the install finish in the background, the only change is where progress is
rendered: the `ActionContext` is torn down at turn end, so the handler would
switch from `displayStatus` to `SessionContext.beginAgentThread("bubble")`, which
is owned by the long-lived session and survives the turn. The `onStatus` plumbing
from §3 is unchanged — it just targets the thread handle's
`appendDisplay(msg, "temporary")` instead of `displayStatus`. This mirrors how
`update` / `uninstall` already return early and report their terminal outcome via
`onOutcome`. Not needed for the first cut; noted so the phase plumbing is
forward-compatible.

## 6. Proposed increments

1. **Thread `onStatus` into `materialize`** (§3.1): add the optional parameter to
   `InstallSource.materialize` in `config.ts` and forward it from
   `resolveUnlocked` in `registry.ts`.
2. **Emit feed phases** (§3.2): `Downloading and installing …`, heartbeat, and
   `Finalizing…` (plus the fast-path `Reusing installed …`) in
   `feedSource.materialize`. The command handler is unchanged (§3.3).
3. **(Optional) Cancellation**: pass the request `abortSignal` into `npmInstall`.
4. **(Optional) Background mode** (§5): swap `displayStatus` for a
   `beginAgentThread` handle behind a `--background` flag.

## 7. Open questions

- Do we want a heartbeat at all, or is a single `Downloading and installing …`
  line (no timer) enough for the first cut?
- Is cancellation (threading `abortSignal` into the npm child) in scope now, or
  deferred with backgrounding (§5)?
