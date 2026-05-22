# Request Queue Steering

> **Scope:** the operations a user (or any connected client) can
> perform on the server-side request queue: cancel, edit,
> pause/resume, interrupt, and pending-interaction handling. Plus the
> CLI slash-command UX that exposes them.
>
> **Prerequisite reading:** [`messageQueueing.md`](./messageQueueing.md)
> — the queue itself (storage, lifecycle, state machine, protocol).
> This doc assumes you already know what `QueuedRequest`,
> `QueueSnapshot`, and the `state` enum are.
>
> **Companion:** see deprecated context in
> [`_deprecated/`](./_deprecated/) if you need the original design
> history.

**Status:** Draft — decisions captured from review walkthrough.
**Last Updated:** 2026-05-21.

---

## Reading order

This doc is shorter than the queueing companion. The fastest path:

1. **§1** — what "steering" means and what it's *not*.
2. **§2** — background: the existing primitives steering builds on
   (`cancelCommand`, `respondToInteraction`). Skip if you've read
   the queueing doc carefully.
3. **§3** — operations at a glance (one table).
4. **§4** — per-op detailed semantics. The interrupt subsection (§4.5)
   has the most important framing in this doc.
5. **§5 – §7** — ownership, UX, multi-client races.
6. **§8 – §9** — testing, references.

---

## 1. What steering is

**Queueing** stores requests, runs them in order, and broadcasts
state changes. That's `messageQueueing.md`.

**Steering** is the set of operations a user (or any connected
client) can perform to *change what's in or about to be in the
queue* beyond the basic "submit and wait." The five steering ops in
this design are:

| Op | One-line gloss |
|---|---|
| `cancelCommand(requestId)` | Stop this request (queued or running). |
| `editQueued(requestId, patch)` | Change the text of a queued entry. |
| `pauseQueue()` / `resumeQueue()` | Stop / restart the drain loop. |
| `interrupt(text)` | Cancel the running entry and immediately run *this* next. |
| `respondToInteraction(id, value)` / `cancelInteraction(id)` | Answer (or abort) a pending `clientIO.question()`. |

### What steering is *not*

- **Not a new cancellation mechanism.** Cancel is still
  `cancelCommand` end-to-end, same `AbortController` plumbing as
  today. `interrupt` reuses it; see §4.5.
- **Not reorder.** We deliberately do not ship a `reorderQueued`
  primitive. "Move this earlier" is expressed by `cancel + resubmit`
  or `interrupt`. See §4.7.
- **Not a barrier mechanism.** No `addBarrier()`. A user who wants
  the queue to drain and then stop simply stops submitting.

These two omissions are explicit design decisions; see the deprecated
review docs for the original maximalist API and the trim-down
rationale.

---

## 2. Background — the primitives steering builds on

### 2.1 Existing cancellation

| API | Where | What it does |
|---|---|---|
| `Dispatcher.cancelCommand(requestId)` | `packages/dispatcher/dispatcher/src/dispatcher.ts` | Fires the request's `AbortController`. Works **even before the request acquires `commandLock`** (the abort controller is created at request entry). |
| `Dispatcher.cancelCommandByClientId(clientRequestId)` | same | Same, addressed by the opaque client-supplied id. |
| `SharedDispatcher.cancelCommand` wrapper | `packages/agentServer/server/src/sharedDispatcher.ts` | Server-side wrapper that broadcasts a cancellation event to all connected clients. |

The `AbortController`-before-lock pattern is the key enabler: it
means a queued entry that hasn't yet acquired `commandLock` (because
it's behind the drain loop) can still be cancelled cleanly — we just
remove it from the tail and signal abort to anything that's listening.

### 2.2 Existing pending-interaction handling

| API | Where | What it does |
|---|---|---|
| `clientIO.question(prompt)` | called by agent code | Pauses the running entry; broadcasts the prompt to all connected clients. |
| `Dispatcher.respondToInteraction(id, value)` | dispatcher | Resumes the paused request with `value` as the resolution. |
| `Dispatcher.cancelInteraction(id)` | dispatcher | Rejects the pending Promise. Agent code receives an error and typically fails the request. |
| `PendingInteractionManager` | `sharedDispatcher.ts` | Keeps interactions alive across client disconnect/reconnect (10-minute timeout). |

Steering layers a couple of new push events on top of these, but no
new mechanics — same plumbing, just made visible through the queue.

---

## 3. Operations at a glance

| Op | RPC | Built from | Adds vs today |
|---|---|---|---|
| Cancel queued or running | `cancelCommand(requestId)` | Existing `AbortController` + queue tail removal | Tail removal on `queued` entries; `requestCancelled` broadcast |
| Edit queued | `editQueued(requestId, patch)` | New | Tail-array mutation; rejects when `state !== "queued"` |
| Pause / Resume | `pauseQueue()` / `resumeQueue()` | New | Sets `paused` flag on `RequestQueue`; gates the drain loop |
| Interrupt | `interrupt(text, …)` | `cancelCommand` + tail prepend | **Atomic** sequencing under the queue's critical section |
| Respond to interaction | `respondToInteraction(id, value)` | Existing | New broadcast event so other clients see the interaction was answered |
| Cancel interaction | `cancelInteraction(id)` | Existing | Same |

---

## 4. Detailed semantics

### 4.1 Submit (queueing-side, included for completeness)

Anyone can submit via `submitCommand`. Entry is appended to the tail,
broadcast via `requestQueued`, logged to `DisplayLog` with state
`"queued"`. If the queue is empty and not paused, the drain loop
immediately picks it up (broadcasts `requestStarted` and starts
execution).

Submit while **paused**: entry still goes into the tail. It just
doesn't dispatch until `resumeQueue()`. (This composes naturally
with the disconnect-pause flow — when all clients drop, the queue
auto-pauses, but submits from later-reconnecting clients still
accumulate.)

> **`P2-pause-submit` — resolved:** paused queue accepts submits;
> they accumulate; do not dispatch until resume.

### 4.2 Cancel

`cancelCommand(requestId)` works for both queued and running entries
(per the existing `AbortController`-before-lock design — see §2.1).
For `queued` entries the queue removes from the tail array; for
`running` we abort. Both broadcast `requestCancelled`.

The `reason` field on the broadcast distinguishes:

- `"user"` — explicit user/client cancel.
- `"timeout"` — pending-interaction timeout exceeded.
- `"disconnect"` — connection-level abort (rare).

### 4.3 Edit queued

`editQueued(requestId, { text?, attachments?, options? })` replaces
fields on a queued entry. Records the old text in `entry.edits[]`
for audit. Broadcasts `requestEdited` with both new and old text so
clients can show the diff or just re-render.

**Hard-block while running.** The call throws `QueueStateError` when
`state !== "queued"`. A `running` entry is mid-translation,
mid-execution, or awaiting an interaction — none of those are safely
editable. To "edit a running entry" the user must cancel and
resubmit.

CLI surface: `/queue edit N <text>` (where `N` is the queue position
from `/queue list`). No Shell edit-in-place UI in v1 or v2.

> **`REVIEW 9.4` — resolved:** hard-block; CLI-only.

### 4.4 Pause / Resume

`pauseQueue()` sets `paused = true`. The in-flight entry runs to
completion; subsequent entries do not dispatch. Submitters can keep
adding to the tail; nothing executes until `resumeQueue()`.

**Use cases:**

- User wants to inspect the current result before letting the next
  item run.
- User wants to queue a batch and review before kicking it off.
- (Server-internal) all clients disconnected — the queue auto-pauses
  with `pauseReason: "no-clients"`; see queueing doc §11.4.

`pauseReason` distinguishes user-initiated pause from auto-pause so
the UI can render them differently and the reconnect flow can prompt
for an explicit resume after a disconnect.

> **`REVIEW 8.1` — resolved (negative):** no `addBarrier()`. A user
> who wants "drain then stop" simply stops submitting.

### 4.5 Interrupt (cancel-current-and-replace)

`interrupt(text, attachments?, options?)` is the **atomic** version
of "cancel whatever is running and immediately run this." Internally
it does:

1. If a request is running: `cancelCommand(running.requestId)`.
2. Insert the new entry at index 0 of the queued tail.
3. The drain loop picks it up after the cancel resolves.

**Return type:** `Promise<SubmitResult>` (same discriminated-union
shape as `submitCommand`). `queue_full` and `server_stopping`
failures are reported as data, not as thrown errors, so the RPC
layer cannot erase their identity. See `messageQueueing.md` §6.5.

The rest of the queue is preserved — if there were already entries
queued behind the running one, they stay queued, just behind the
newly-prepended interrupt.

> **Note — `interrupt` is not a new cancellation mechanism.** Step 1
> calls the existing `cancelCommand`; nothing about abort
> propagation, `AbortController` semantics, or pending-interaction
> rejection (§4.6) changes. `interrupt` exists as a single
> server-side RPC purely to make steps 1–2 **atomic** under the
> queue's critical section. A client-side composition —
> `cancelCommand` followed by `submitCommand` — has a race window
> where another connected client's submit, or a pre-existing queued
> entry, can land between the cancel and the prepend and steal the
> head slot. Same cancel plumbing, atomic sequencing — that's the
> whole delta. Authors tempted to remove `interrupt` and tell
> clients to compose the two ops themselves should preserve that
> atomicity guarantee some other way (e.g. a `submitCommand`
> priority flag) rather than dropping it outright.

Side-effects from the cancelled request are not rolled back (agents
are responsible for their own atomicity — same as today's
`cancelCommand`).

CLI surface: `/queue interrupt <text>`. **Slash command only in v1 —
no Shell interrupt button** (per the project's no-new-Shell-UI
constraint; revisit after Phase 1 usage data).

> **`P1-interrupt` — resolved:** promote `interrupt` from stretch to
> required in Phase 1; CLI surface only (no Shell button).

### 4.6 Pending interactions: respond and cancel

When a running entry calls `clientIO.question()`, the head transitions
to `state: "running"` with `blockedOn: "interaction"` (queueing doc
§6.2, §10). Two ops resolve it:

| Op | Effect |
|---|---|
| `respondToInteraction(id, value)` | Resumes the paused request with `value`. Entry continues toward `succeeded`/`failed`. |
| `cancelInteraction(id)` | Rejects the pending Promise. Agent code receives an error and typically fails the request. |

Both broadcast a small event (`interactionResponded` /
`interactionCancelled`) so other connected clients can dismiss any
prompt UI they had open.

**Multi-client race:** two clients answer the same prompt
simultaneously. The server processes them in arrival order; the
second is dropped with a `NoSuchInteractionError` (same model as
today). Clients ignore the error if they see the
`interactionResponded` event come back from someone else.

### 4.7 What we deliberately did not ship

These were in earlier drafts and were dropped during review.

- **`reorderQueued(requestId, newIndex)`** — dropped. A user who
  wants to move an entry should `cancelCommand(entry.requestId)` +
  resubmit at the desired time, or use `interrupt` if they want it
  to run *next*. Two existing primitives cover the use case; a
  dedicated reorder primitive added state-machine surface (and edit
  semantics: does a reordered entry preserve its edit history? what
  about its `submittedAt`?) for marginal benefit.

- **`addBarrier()`** — dropped. The barrier was meant to express
  "drain up to here then auto-pause." For a single human across
  multiple clients the workflow degenerates to "just stop submitting
  things until I want more to run," which doesn't need a primitive.
  Barrier only earns its keep with multi-client or auto-submit
  scenarios that we don't have.

- **`clearQueue()`** — a small convenience for the wipe-and-replace
  flow (atomic "cancel all queued, leave running"). **Not in v1.**
  Possible Phase 2 add-on if usage data shows users frequently
  composing N cancels in a row. Until then, the wipe-and-replace is
  user-composed (cancel each + submit) and should feel deliberate.

---

## 5. Ownership and multi-client semantics

**Any connected client can steer any entry**, regardless of which
client originally submitted it. The model is "one human, many
clients." If the user submits from CLI and then switches to Shell,
the Shell can edit, cancel, pause, etc., without restriction.

> **`REVIEW 9.2` — resolved:** no ownership in v1. Add an
> `owner-only` mode later if real usage demands.

### 5.1 Multi-client steering matrix

| Action | From originating client | From other connected client | While client is disconnected |
|---|---|---|---|
| Submit | OK | OK | N/A |
| Cancel queued | OK | OK | N/A |
| Cancel running | OK | OK | N/A |
| Edit queued | OK | OK (last writer wins) | N/A |
| Pause / Resume | OK | OK | N/A |
| Interrupt | OK | OK | N/A |
| Respond to interaction | OK (existing race) | OK (existing race) | N/A |

### 5.2 Edit-edit race

Two clients edit the same queued entry simultaneously. The server
processes them in RPC arrival order; the second edit overwrites the
first; both clients receive `requestEdited` events reflecting the
final state. Acceptable — same model as collaborative text editing
without OT.

### 5.3 Cancel-respond race

Client A calls `cancelCommand(running.requestId)`. Client B calls
`respondToInteraction(id, value)` for an interaction the same entry
was blocked on. Whichever lands first wins:

- Cancel first → respond gets `NoSuchInteractionError`. Entry →
  `cancelled`.
- Respond first → cancel observes `running` (no longer blocked) and
  aborts; the resumed execution sees the abort and unwinds; entry →
  `cancelled`. The respond's value is consumed but discarded.

Both paths are clean. Document, don't engineer around.

---

## 6. Client UX

> **Project constraint:** the team is conservative about Shell UI
> changes. **All Phase 1 and Phase 2 queue steering ships as CLI
> slash commands**, plus the existing Shell `stopButton` which
> continues to work on queued and running entries via the existing
> cancel path. **No new Shell buttons in v1 or v2.** Re-evaluate
> after Phase 2 usage data.

### 6.1 CLI — slash commands

Slash commands are local to the CLI (no dispatcher involvement) and
issue RPCs to the agent-server.

| Command | What it calls | Notes |
|---|---|---|
| `/queue list` | `getQueueSnapshot()` | Prints running + queued with indices, submit time, and text snippet. |
| `/queue cancel N` | `cancelCommand(queue[N].requestId)` | Cancel by queue position. Also accepts the requestId directly. |
| `/queue edit N <text>` | `editQueued(queue[N].requestId, { text })` | Errors with a clear message if entry has already started running. |
| `/queue pause` | `pauseQueue()` | |
| `/queue resume` | `resumeQueue()` | Re-prompts the user if `pauseReason === "no-clients"` ("Queue auto-paused while you were away. Resume?"). |
| `/queue interrupt <text>` | `interrupt(text)` | Or shorthand `/interrupt <text>` (alias). |

Prompt indicator (live-updated via `queueStateChanged`):

- `[idle]` — nothing running, nothing queued.
- `[1▶]` — one running, none queued.
- `[1▶ +2]` — one running, two queued.
- `[1▶ +2 ⏸]` — paused (user).
- `[1▶ +2 ⏸ ⚠]` — paused (no-clients; reconnect-needs-resume).
- `[??]` — interaction in progress (running entry blocked).

### 6.2 Shell

- **Existing `stopButton`** (in `chatView.ts`) continues to cancel
  the running entry, unchanged. After Phase 1 it also works on the
  next queued entry if there's no running one (uses the same
  `cancelCommand` path).
- **Queue display** is read-only badges below the input area, fed by
  `queueStateChanged`. Shows count, pause state, and the
  reconnect-restored banner when `joinConversation` carries a
  non-empty snapshot.
- **No new buttons in v1 or v2.** Pause, interrupt, edit are
  CLI-only. The Shell user can still cancel-and-resubmit, which is
  the manual composition of most steering ops.

This is a hard constraint for now; revisit after we have user
behaviour data from Phase 1+2.

### 6.3 VS Code / web / mobile

Incremental. These clients can implement the queue UX one piece at a
time. Backward compat: a client that ignores all the new events just
shows what it shows today (one running request).

### 6.4 The wipe-and-replace flow

A user wants to abandon everything in the queue and run a brand new
request instead. There is no dedicated RPC; the user composes:

1. `/queue cancel <each>` (or one cancel per entry).
2. `/queue interrupt <new text>` (or a fresh submit if nothing is
   running).

This is deliberate — it should feel intentional. If usage data
shows users frequently composing many cancels in a row, we add
`clearQueue()` as a Phase 2 convenience (§4.7).

---

## 7. Multi-client steering test scenarios

(Complements the per-op test list in queueing doc §14.)

- **Edit-edit race.** Two clients call `editQueued` on the same
  entry within a tight loop; assert both `requestEdited` events
  arrive at both clients; assert final state matches the
  last-arrived edit.
- **Cancel-edit race.** Client A cancels entry X; Client B edits
  entry X. Whichever lands first wins; the other gets
  `QueueStateError` ("entry not in queued state").
- **Interrupt across clients.** Client A submits a slow request;
  Client B interrupts. Assert A's entry → `cancelled`, B's entry
  becomes the new head, A's client receives `requestCancelled`,
  B's client receives `requestStarted`.
- **Pause while submitting.** Client A pauses; Client B submits
  three entries. Assert all three land in the tail; assert no
  drain. Resume; assert all three run in order.
- **Reconnect after auto-pause.** Disconnect all clients; wait 30s;
  reconnect; assert snapshot shows `paused: true`,
  `pauseReason: "no-clients"`; assert reconnect UI prompts for
  explicit resume; assert nothing dispatches until resume is called.
- **Pending-interaction multi-client respond.** Submit a request
  that calls `clientIO.question`; two clients race
  `respondToInteraction`; assert one succeeds, the other gets
  `NoSuchInteractionError`; assert both clients see
  `interactionResponded` and dismiss their prompt UI.

---

## 8. Open follow-ups

- **`clearQueue()` Phase 2 add-on** — decide post-Phase-1 based on
  usage data (do users frequently compose many cancels?).
- **Shell UX revisit** — after Phase 2 usage data, decide whether to
  add any Shell buttons for steering. Today's constraint is hard
  "no new buttons in v1 or v2."
- **Owner-only steering mode** — defer until a real use case shows
  multi-client conflict is a problem. The "one human, many clients"
  model has worked for pending interactions so far.

---

## 9. References

- [`messageQueueing.md`](./messageQueueing.md) — companion doc on
  the queue itself.
- [`_deprecated/messageQueueing-original.md`](./_deprecated/messageQueueing-original.md)
  — the original client-side design (CLI-focused). Some of its
  cancel-UX matrix and slash-command sketches informed the
  current §6.
- [`_deprecated/messageQueueing-review.md`](./_deprecated/messageQueueing-review.md)
  — the review that motivated the server-side rewrite.
- `packages/dispatcher/dispatcher/src/dispatcher.ts` — host of the
  existing `cancelCommand` and `respondToInteraction` primitives
  steering builds on.
- `packages/agentServer/server/src/sharedDispatcher.ts` —
  `PendingInteractionManager`; broadcast loop;
  `cancelCommand`/`cancelInteraction`/`respondToInteraction`
  wrappers. The new steering RPCs (`editQueued`, `pauseQueue`,
  `resumeQueue`, `interrupt`) live here too.
- `packages/agentServer/protocol/src/` — wire protocol additions for
  steering events.
