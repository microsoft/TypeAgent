<!-- Copyright (c) Microsoft Corporation. Licensed under the MIT License. -->

# Stale-server notice — design & reference

When the agent-server's code is rebuilt on disk while the process keeps
running, it is serving **out-of-date code**. On connect it pushes a notice to
each client so the user knows to restart it. This doc records the design
decision for how that notice appears and how the (reusable) affordance works.

## Files in this folder

- [`stale-server-notice.html`](./stale-server-notice.html) — the design
  exploration: five treatments compared side by side (interactive).
- [`stale-server-notice-live.html`](./stale-server-notice-live.html) — a
  preview of the chosen design rendered with the **real** `../styles/chat.css`
  (stays accurate as the styles change).

## Options considered → decision

| #     | Treatment                                             | Verdict                                                                                                                  |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0     | Notifications bell (the original ephemeral `warning`) | Too easy to miss; no call to action.                                                                                     |
| A     | Persistent toast (top-right, until dismissed)         | Good, but once dismissed it's gone while still stale.                                                                    |
| B     | Pinned banner across the top                          | Most "can't miss it"; heavier.                                                                                           |
| C     | Compact pinned strip                                  | Subtle; easy to tune out.                                                                                                |
| **D** | **Toast that collapses to a pinned pill**             | **Chosen** — loud on arrival, dismiss _minimizes_ to a pill so it's never lost while stale, click the pill to re-expand. |

## The affordance (option D)

A persistent, dismissible **status notice** rendered by chat-ui as a
bottom-right toast (title, message, optional action button, and a `×`). The `×`
collapses it to a small **pinned pill** in the same corner; clicking the pill
re-expands it. Unlike `showToast()` (which auto-hides after 5s), it stays until
dismissed. Colors are self-contained amber/red/blue (like `.chat-reconnect-banner`)
so it reads on both light and dark host themes.

It lives almost entirely in **chat-ui** so the Electron shell and vscode-shell
share it:

- **Model + event** — `packages/chat-ui/src/statusNotice.ts`
  (`StatusNotice`, `parseStatusNotice`, `STATUS_NOTICE_EVENT = "statusNotice"`).
- **Renderer** — `ChatPanel.showStatusNotice()` / `clearStatusNotice()` in
  `packages/chat-ui/src/chatPanel.ts`, styled in
  `packages/chat-ui/styles/chat.css` (`.chat-status-notice*`, `.csn-*`).
  The action button runs its command through `injectCommand()`, so it works in
  every host with no extra wiring.

## Wire path

```
agent-server (stale) --notify("statusNotice", {...})--> client
  Electron shell   : chatPanelBridge.ts  -> chatPanel.showStatusNotice()
  vscode-shell     : webview/main.ts     -> chatPanel.showStatusNotice()
  CLI              : enhancedConsole.ts   -> yellow console line
```

The server payload lives in
`packages/agentServer/server/src/connectionHandler.ts` (id `stale-build`,
level `warning`, action `@server restart`).

## Reusable

Not stale-build-specific. Any source can raise one:

```ts
clientIO.notify(
  undefined,
  "statusNotice",
  {
    id: "my-notice",
    level: "warning", // info | warning | error
    title: "…",
    message: "…",
    actionLabel: "Do it", // optional button…
    actionCommand: "@…", // …runs this via the chat input
  },
  "my-source",
);
```

## Lifecycle

Ephemeral: not written to the DisplayLog, so it does not replay on rejoin; a
fresh connect re-sends it (once per connection) while the condition holds.
Cleared on `ChatPanel.clear()` (conversation switch / reconnect replay).

## Test on demand

```
@notify status                         # warning notice, no button
@notify status "custom body text"
@notify status --level info|warning|error
@notify status --restart               # include the real "Restart server" button
```

Implemented in
`packages/dispatcher/dispatcher/src/context/system/handlers/notifyCommandHandler.ts`.

## Related

The server-side staleness detection and self-restart that this notice pairs
with: `packages/agentServer/server/src/staleBuild.ts` (watcher + console
banner) and the `@server restart` / `/restart` commands.
