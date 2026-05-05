# timer

Timer / reminder agent. Doubles as the test fixture for agent-initiated
messages (`SessionContext.beginAgentThread` + `startBackgroundTasks` /
`stopBackgroundTasks`). When a reminder fires, the agent pushes a message
to the chat without a preceding user request.

## Usage

| Phrasing | Effect |
| --- | --- |
| `remind me to <message> in <duration>` | one-shot bubble (default) |
| `remind me to <message> in <duration> as a bubble` | one-shot bubble (explicit) |
| `remind me to <message> in <duration> as a toast` | one-shot toast |
| `remind me to <message> in <duration> as an inline` | one-shot inline |
| `toast me <message> in <duration>` | one-shot toast |
| `flash <message> in <duration>` | one-shot inline |
| `remind me to <message> every <duration>` | repeating bubble |
| `remind me to <message> every <duration> as a toast` | repeating toast |
| `remind me to <message> every <duration> as an inline` | repeating inline |
| `tick <message> every <duration>` | repeating bubble (rapid-fire) |
| `repeat reminder <message> every <duration>` | repeating bubble |
| `show reminders` / `list reminders` | list pending |
| `cancel reminder <id>` / `cancel all reminders` | cancel |

Pending reminders are persisted to `sessionStorage` (per-conversation),
so they survive a dispatcher restart. A reminder whose fire time has
passed during downtime fires on the next tick after rehydration.

`<duration>` accepts `5s`, `30 sec`, `10m`, `10 minutes`, `1h`, `2 hours`,
or an ISO 8601 timestamp like `2026-05-04T15:30:00`. If the wildcard
captures something that doesn't parse, `validateWildcardMatch` rejects the
fast-path match and the dispatcher falls back to LLM translation.

## Open work / deferred polish

These were intentionally deferred while standing up the agent-initiated
message path end to end. Track and pick up as needed.

### Shell ([packages/shell](../../shell))

- [ ] **Real toast overlay surface.** `kind: "toast"` currently routes through
      `chatView.addNotificationMessage` (`appendMode: "temporary"` — gets
      overwritten by the next message). A fixed-position overlay outside
      `messageDiv` with auto-dismiss, click-to-dismiss, and stacking would
      give toast its own visual lane separate from the chat scroll.
      Wire-up in [main.ts setDisplay/appendDisplay](../../shell/src/renderer/src/main.ts).
- [ ] **Distinct inline rendering.** `kind: "inline"` currently shares the
      same temporary-status path as `kind: "toast"`. A compact non-overwriting
      one-liner row (similar to the `notification-system-*` join/leave rows
      auto-created in [chatView.ts](../../shell/src/renderer/src/chat/chatView.ts))
      would let inline persist in the scroll without bubble chrome.
- [ ] **Auto-scroll / focus / TTS policy.** Agent-initiated messages
      currently use the same scroll + TTS behavior as response bubbles.
      Conservative default per the plan: don't auto-speak, don't steal
      scroll if the user has scrolled up, flash a "new message below"
      affordance.

### CLI ([packages/cli](../../cli))

- [ ] **Readline-aware prompt safety.** When no spinner is active and the
      user is mid-typing at the prompt, `displayContent` writes to stdout
      and corrupts the readline input line. Needs save-cursor / clear-line
      / write / restore-cursor handling. Same issue exists today for the
      `notify` path's non-spinner branch — fix both together.
      Code path: [enhancedConsole.ts renderAgentMessage](../../cli/src/enhancedConsole.ts).

### Timer agent (this package)

- [ ] **`--kind` flag / direct invocation.** Today `kind` is reachable
      via the anchored grammar patterns ("as a toast", "toast me",
      "flash"). A command-style flag (`@timer set in 5s "hello" --kind toast`)
      would match the verbatim test recipe in the plan and avoid the
      grammar gymnastics.
- [ ] **Richer `when` parsing.** Accept "in 1 hour 30 minutes", "tomorrow
      at 9am", relative phrases. Currently single-unit only.

### Cross-cutting

- [ ] **Pending-interaction policy verification.** Confirm that an
      agent-initiated message arriving during `requestChoice` /
      `popupQuestion` / `requestInteraction` renders above the prompt
      without breaking the interaction. Per the plan: bubble appears in
      chat, prompt remains interactive. No code change expected — pure
      manual verification.
- [ ] **Multi-conversation routing verification.** With two clients on
      different conversations, a reminder set in conversation A must fire
      only in A. `sessionContext` is bound to a single conversation by
      `clientIO` injection so this should already work — needs a
      verification test, no code change expected.
- [ ] **Persistent reminder replay round-trip test.** A bubble reminder
      that fires during conversation X should re-render in its original
      slot when a fresh client connects to X. The infrastructure is in
      place (logged via `setDisplay`, replayed via `replayDisplayHistory`,
      kind survives serialization) — needs a manual end-to-end test.

### Done — for reference

- ~~**DisplayLog kind preservation.**~~ Wired in
  [sharedDispatcher.ts](../../agentServer/server/src/sharedDispatcher.ts):
  `setDisplay`/`appendDisplay` skip logging when
  `message.kind === "toast" || "inline"` (matches `notify`'s
  default-not-persisted behavior). Bubble entries log normally and the
  `kind` field round-trips through `IAgentMessage` on replay; receiving
  UIs (Shell / CLI / chat-ui) honor it via the routing added in Layers
  C / D / B.
- ~~**Reminder persistence.**~~ Pending reminders are saved to
  `sessionStorage/reminders.json` on every mutation (set / cancel /
  fire) and rehydrated by `startBackgroundTasks` on session start.
  A reminder whose `fireAt` is in the past on rehydration fires on the
  next 1-second tick (intentional — "you missed this, here it is now").
- ~~**`RepeatReminder` action.**~~ Fires every `every` interval until
  cancelled (or until `count` fires have elapsed if specified). Same
  `kind` support as one-shot reminders. Useful for stress-testing
  rapid-fire back-to-back agent-initiated messages.

## Trademarks

This project may contain trademarks or logos for projects, products, or
services. Authorized use of Microsoft trademarks or logos is subject to
and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project
must not cause confusion or imply Microsoft sponsorship. Any use of
third-party trademarks or logos are subject to those third-party's policies.
