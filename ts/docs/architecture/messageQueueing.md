# Server-Side Request Queue

> **Scope:** server-side per-conversation request queue inside
> `SharedDispatcher`. Covers storage, lifecycle, state machine,
> multi-client semantics, reconnect/restart, and phasing.
>
> **Companion:** [`messageSteering.md`](./messageSteering.md) —
> operations a user/client can perform on queued entries (cancel,
> edit, pause/resume, interrupt) and the CLI slash-command UX.
>
> **Superseded:** the original client-side queue design and its review
> live in [`_deprecated/`](./_deprecated/) for historical context.

**Status:** Draft — decisions captured from review walkthrough.
**Last Updated:** 2026-05-21.

---

## Reading order

This doc is meant to be walked through in a design discussion. The
fastest path:

1. **§1** — one-paragraph elevator pitch.
2. **§2** — what's in the codebase today and which files this change
   touches. Skip if everyone already knows the dispatcher layout.
3. **§3** — before/after diagram. The whole change on one screen.
4. **§4 – §8** — the meat: architecture, data model, state machine,
   protocol.
5. **§9 – §12** — how the change interacts with existing behaviour
   (activity context, batch mode, pending interactions, reconnect,
   multi-client).
6. **§13 – §15** — phasing, testing, references.

For the **steering operations** (cancel, edit, pause/resume,
interrupt), read [`messageSteering.md`](./messageSteering.md) after
§8.

---

## 1. Summary

We replace TypeAgent's implicit serialization-via-`commandLock` with
an explicit server-side `RequestQueue` owned by `SharedDispatcher`
(`packages/agentServer/server/src/sharedDispatcher.ts`). The queue is
the canonical source of truth for pending and in-flight requests per
conversation. All connected clients see the same queue and can
**steer** it: submit, cancel, edit a queued entry, pause/resume the
drain, or interrupt the in-flight to jump a new request to the front.

The existing `Dispatcher.processCommand` contract is preserved
(`Promise<CommandResult>`); we add `submitCommand` for ack-on-enqueue
semantics, plus ClientIO push events for queue-state changes and a
small new family of `Dispatcher` methods for queue manipulation.

### Two-phase delivery

| Phase | What ships | User-visible value |
|---|---|---|
| **Phase 1 — Queueing** | `RequestQueue`, visibility events, type-ahead across all clients, cancel of queued items, reconnect-restores-queue, `interrupt` (promoted from stretch). | "Control returns to me immediately after I press Enter." |
| **Phase 2 — Steering** | `editQueued`, `pauseQueue` / `resumeQueue`. | "I can shape the queue while it runs." |
| **v1.5 polish** | Persistence across server restart (queued entries via DisplayLog). | "My queue survives deploys." |

See §13.2 for the detailed phase breakdown.

---

## 2. Background — the world this plugs into

### 2.1 Today's request flow

```
client ──► agent-server ──► SharedDispatcher ──► Dispatcher.processCommand
                                  │                       │
                                  │                       ▼
                                  │                  commandLock ◄── single in-flight
                                  │                       │
                                  │                       ▼
                                  │                  agent.executeAction
                                  ▼
                              broadcast(setUserRequest, setDisplay, …) ──► all clients
```

A client calls `processCommand` over the wire; `SharedDispatcher`
forwards to the inner `Dispatcher`; the inner dispatcher's
`commandLock` serializes any concurrent calls so only one request
executes at a time. While a request is in flight, additional submits
*block on the lock*; clients see this as "the agent is busy."

### 2.2 Modules you should know before reading further

| Module | Path | Role today |
|---|---|---|
| `SharedDispatcher` | `packages/agentServer/server/src/sharedDispatcher.ts` | Owns the conversation server-side; wraps the inner `Dispatcher`; broadcasts ClientIO events to all connected clients; already hosts `PendingInteractionManager`. **This is where `RequestQueue` will live.** |
| `Dispatcher` | `packages/dispatcher/dispatcher/src/dispatcher.ts` | The execution engine. Exposes `processCommand`, `cancelCommand`, `respondToChoice`, etc. The queue calls `processCommand` for each entry. |
| `CommandHandlerContext.commandLock` | `packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts` | A `createLimiter(1)` (mutex) acquired inside `command.ts` around every command. Today this is what makes the dispatcher serial. After the queue ships, it stays as defense-in-depth (see §5.3). |
| `Limiter` | `packages/utils/commonUtils/src/limiter.ts` | Tiny hand-rolled non-reentrant async semaphore. Backs `commandLock`. |
| `PendingInteractionManager` | `packages/agentServer/server/src/sharedDispatcher.ts` (within file) | Already-shipped pattern for keeping `clientIO.question()` interactions alive across disconnect/reconnect. The queue follows the same broadcast/restore pattern. |
| `ClientIO` protocol | `packages/agentServer/protocol/src/` (clientio.ts, protocol.ts) | The wire interface SharedDispatcher uses to push events (`setUserRequest`, `setDisplay`, `notify`, …) to every connected client. We extend it with `requestQueued`, `queueStateChanged`, etc. |
| `JoinConversationResult` | same protocol package | Returned on `joinConversation()`. Already carries `pendingInteractions`. We add `queueSnapshot` here so reconnecting clients render queue state immediately. |
| `DisplayLog` | dispatcher's persisted user-request log | The persistence target for the v1.5 server-restart-survives-queue story. Already records user requests at submit time. |
| Existing cancel paths | `Dispatcher.cancelCommand(requestId)`, `cancelCommandByClientId(...)` | Cancel a running request via the `AbortController`-before-lock design. **Already work on requests that haven't acquired the lock yet** — which is exactly the property we lean on for "cancel a queued entry." |

### 2.3 What's painful today

1. **No type-ahead.** While a request runs, the CLI's input loop is
   stuck in `await Dispatcher.processCommand`; users can't submit the
   next message until completion.
2. **Multi-client divergence.** ~10 client types exist (CLI, Shell,
   VS Code, web, mobile, MCP, copilot-plugin, browser-extension, …).
   A client-side queue forces every client to re-implement queueing.
3. **Disconnect drops in-flight visibility.** If a user submits from
   CLI and switches to Shell, the Shell has no view of what's
   pending or running.
4. **Steering needs a single source of truth.** Edit, cancel, and
   pause cannot be raced safely between clients without a server-side
   owner.
5. **Replay is incomplete.** Today's DisplayLog records execution
   start, not submission. A server-side queue lets us record both.

A more detailed motivation (with the multi-client benefit table) is
preserved in the deprecated review doc:
[`_deprecated/messageQueueing-review.md`](./_deprecated/messageQueueing-review.md).

---

## 3. The change on one screen

```
BEFORE                                       AFTER
──────                                       ─────

client.processCommand("foo")                 client.submitCommand("foo")
        │                                            │
        ▼                                            ▼
SharedDispatcher.processCommand              SharedDispatcher.submitCommand
        │                                            │
        ▼                                            ▼  (returns immediately,
Dispatcher.processCommand                            │   client sees QueuedRequest)
        │                                            │
        ▼                                            ▼
commandLock (serializes here)                RequestQueue.submit
        │                                            │
        ▼                                            ▼
agent.executeAction                          tail.push(entry); drain()
                                                     │
                                                     ▼
                                             drain loop:
                                                head = tail.shift()
                                                Dispatcher.processCommand(head, …)
                                                     │
                                                     ▼
                                             commandLock (still here, but
                                             no contention by construction)
                                                     │
                                                     ▼
                                             agent.executeAction
```

The wire-level `processCommand` RPC is kept for backward compatibility
(it's just `submitCommand` + await-completion server-side). Adding a
new `submitCommand` RPC lets steering-aware clients get ack-on-enqueue
latency without giving up the legacy fire-and-await callers.

---

## 4. Goals and non-goals

### 4.1 Goals

- **Steerable.** Cancel, edit, pause, resume, interrupt queued items
  mid-conversation (operations defined in
  [`messageSteering.md`](./messageSteering.md)).
- **Multi-client consistent.** Every connected client sees the same
  queue; every steering action broadcasts.
- **Disconnect-resilient.** Queue survives client disconnect; user
  can resume from a different client.
- **Backward-compatible.** Old clients that don't subscribe to queue
  events still work and see today's behaviour (one in-flight,
  serialized).
- **Auditable.** Queue lifecycle (enter, edit, leave, cancel) is
  logged to `DisplayLog` and replayable.

### 4.2 Non-goals

- **Cross-conversation scheduling.** Each `SharedDispatcher` manages
  its own queue; no global fairness.
- **Persistence across server restart in v1.** Deferred to v1.5
  (§11.3).
- **Multi-user conflict resolution.** All connected clients are
  assumed to represent the same human; last-writer-wins on edits.
  Multi-human collaboration is out of scope.
- **Server-side queue for direct (non-SharedDispatcher) dispatcher
  use.** The CLI's direct mode is being phased out per the CLI README
  ("connected-mode only; all commands route through `agent-server`").

---

## 5. Architecture

### 5.1 Where `RequestQueue` lives

```
┌────────────────────────────────────────────────────────────────┐
│  agent-server  (per conversation)                              │
│                                                                │
│  SharedDispatcher                                              │
│   ├── PendingInteractionManager   (existing)                   │
│   ├── broadcast loop              (existing)                   │
│   └── RequestQueue                (NEW)                        │
│           ├── head: QueuedRequest | null   ← currently running │
│           ├── tail: QueuedRequest[]        ← FIFO queue        │
│           ├── paused: boolean                                  │
│           ├── pauseReason?: "user" | "no-clients"              │
│           └── drain loop ──► Dispatcher.processCommand         │
└────────────────────────────────────────────────────────────────┘
```

The queue is **per-conversation**. Each `SharedDispatcher` instance
gets its own. No global queue, no cross-conversation interaction.

### 5.2 The drain loop (pseudocode)

```ts
class RequestQueue {
    private head: QueuedRequest | null = null;
    private tail: QueuedRequest[] = [];
    private paused = false;
    private pauseReason?: "user" | "no-clients";

    async submit(req: SubmittedRequest): Promise<QueuedRequest> {
        const entry = this.materialize(req);    // assigns requestId
        this.tail.push(entry);
        this.logToDisplayLog(entry, "queued");
        this.broadcastQueued(entry);            // fine-grained + snapshot
        this.drain();
        return entry;                           // ack-on-enqueue
    }

    /** Dispatch the head if possible. Idempotent — safe to call from
     *  submit, completion, or resumeQueue without coordination. */
    private async drain() {
        if (this.head !== null) return;         // already running
        if (this.paused) return;
        const next = this.tail.shift();
        if (!next) return;
        this.head = next;
        next.state = "running";
        this.broadcastStarted(next);
        try {
            const result = await this.dispatcher.processCommand(
                next.text, next.requestId,
                next.attachments, next.options,
            );
            this.completeHead(result);
        } catch (e) {
            this.failHead(e);
        }
        this.head = null;
        this.drain();
    }
}
```

`dispatcher.processCommand` here is the **inner** `Dispatcher`
(`packages/dispatcher/dispatcher/src/dispatcher.ts`). It's called with
the queue-assigned `requestId` so existing `setUserRequest`,
`setDisplay`, and `cancelCommand` plumbing all work unchanged.

### 5.3 `commandLock` — what stays, what becomes a no-op

> **TL;DR.** `commandLock` stays in place. It still *runs* on every
> request, but in the contention sense it becomes a no-op because the
> queue guarantees only one request can reach it at a time.

`commandLock` (`commandHandlerContext.ts`, initialized via
`createLimiter(1)`) is acquired inside `command.ts` around every
`processCommand` call. Today it serializes concurrent
`processCommand`s — the implicit FIFO is inside `Limiter`'s
`p`/`resolve` promise.

After the queue ships, the drain loop only ever calls
`dispatcher.processCommand` when `head === null`, so the lock
acquisition always wins immediately. **No removal**, because:

- **Direct-mode callers** (legacy CLI direct path, tests) bypass
  `SharedDispatcher` and still need serialization.
- **Agent-mutation paths** in `sessionContext.ts` (lines around 47,
  65, 82, 167, 254) re-acquire `commandLock` to safely mutate
  context. Removing it would risk those paths.
- **`respondToChoice`** acquires the lock independently
  (`dispatcher.ts` around line 560). The queue is unaware of choice
  responses; the lock is what prevents a choice response from racing
  with a recursive command invocation.
- **`flowInterpreter.ts`** uses lock state to avoid re-entry.

The lock is cheap when uncontended. Keeping it is pure defense in
depth.

> **`REVIEW 5.1` — resolved: keep inner `commandLock`** as
> defense-in-depth.

### 5.4 `requestId` ownership

Today the server-side UUID is generated *inside*
`command.ts`'s `processCommand`. With the queue, the queue assigns it
at enqueue time and passes it in. This requires plumbing a
`requestId` parameter through `Dispatcher.processCommand` (currently
auto-generated).

Why this matters: every steering operation refers to entries by
`requestId`. If the id were generated only at execution time, queued
entries would not yet have one, and clients couldn't address them.

**Retry model.** When an entry fails transiently and is retried, the
**same `requestId`** is reused with an `attempt: number` field
incrementing. `requestId` is "stable entry identity," not "execution
attempt identity." This lets clients diff event streams without
re-keying on every retry.

> **`REVIEW 5.2` — resolved:** plumb `requestId` through
> `processCommand`. Retries reuse it with an `attempt` counter.

### 5.5 Implementation safeguards

Four cross-cutting safety mechanisms shape the wire and runtime
behaviour of the queue. They are intentionally simple — each defends
one failure mode the explicit pipeline introduces.

**5.5.1 Bounded queue.** The queue refuses to grow past
`MAX_QUEUE_DEPTH` (currently `100`) entries (running + queued combined).
A submit that would exceed the cap fails with `SubmitResult.error =
"queue_full"`; the server records a `messageQueue:rejected` log line
with the originator's `connectionId`. The cap is a coarse DOS guard —
a malicious or runaway client within a conversation can fill the
queue but cannot blow past it. Per-client rate limiting is out of
scope for Phase 1; the cap is the only defence.

**5.5.2 Version watermark.** Every queue mutation increments a
monotonically-increasing `snapshotVersion` counter. The current value
is copied onto every push-event payload (as a separate `version`
parameter) and onto every `QueueSnapshot` (as the `version` field).
Clients store the highest version they have already applied and
**discard** any event with `version <= lastAppliedVersion`. This
neutralizes the two reorder hazards introduced by going through an
async RPC fan-out:

1. **Late delivery** — a `requestQueued` event arriving after the
   `requestStarted` for the same entry can no longer overwrite the
   "running" state.
2. **Snapshot/event interleave on reconnect** — a client that has just
   applied a fresh `getQueueSnapshot` ignores any earlier event that
   the broadcast bus delivers a moment later.

Bootstrap rule: when a client applies a snapshot (typically via
`JoinConversationResult.queueSnapshot`), it MUST set
`lastAppliedVersion = snapshot.version` **without** the usual `<=`
check, so the next legitimate event isn't suppressed.

**5.5.3 Privacy redaction.** Attachments may be large (base64 images)
and may be private. The server **strips** the `attachments` field
from every `QueuedRequest` copy that crosses the broadcast channel
(events, snapshots, and the `submitCommand` reply). Only
`attachmentCount` is broadcast — enough for other clients to render
"[N attachments]" without seeing the bytes. The originator already
holds the raw bytes locally; the drain loop forwards them to the
inner dispatcher unredacted.

**5.5.4 Graceful shutdown.** `drainAndStop(deadlineMs?)` is the
single shutdown entry point invoked by `SharedDispatcher.close()`. It:

1. Marks the queue as `stopped` — further `submit` calls fail with
   `SubmitResult.error = "server_stopping"`.
2. Lets the drain loop finish whatever entries it can before the
   deadline (default `SHUTDOWN_DRAIN_DEADLINE_MS = 30000`).
3. When the deadline fires, *abandons* every remaining entry: rejects
   their completion promises with `ServerStoppingError`, marks them
   `cancelled` with `error: "cancelled:server_stopping"`, and
   broadcasts `requestCancelled` with reason `"server_stopping"` so
   clients can render a distinct "server is shutting down" message
   instead of the generic "cancelled."
4. Returns a memoized promise — subsequent calls share the same
   promise, so a runaway shutdown loop cannot leak resolvers.

---

## 6. Data model

### 6.1 `QueuedRequest`

```ts
// packages/dispatcher/types/src/queue.ts (cross-client wire)

export interface QueuedRequest {
    /** Server-assigned UUID — same one used for RequestId.requestId. */
    requestId: string;
    /** Client-supplied opaque id (passed back for round-trip mapping). */
    clientRequestId?: unknown;
    /** The connectionId that submitted this entry. May disconnect later. */
    originatorConnectionId: string;
    /** Raw user input. Editable via editQueued. */
    text: string;
    /**
     * Raw attachments — present on the *submit* side, but the server
     * **strips this field** from every broadcast copy and from the
     * snapshot before they leave the server. Other clients only see
     * `attachmentCount`; the raw bytes never cross the queue wire.
     * See §5.5 "Privacy redaction".
     */
    attachments?: string[];
    /**
     * Always present on broadcast / snapshot copies (zero when there
     * are none); used by `/queue list` and shell badge tooltips so
     * other clients see "[N attachments]" without receiving the raw
     * bytes.
     */
    attachmentCount?: number;
    options?: ProcessCommandOptions;
    /** ms epoch when entered the queue. */
    submittedAt: number;
    startedAt?: number;
    finishedAt?: number;
    state: QueueRequestState;
    /** Sub-state while running. */
    blockedOn?: "interaction";
    /** Execution attempt for retry (1 for the first run). */
    attempt: number;
    /** lastActionSchemaName at submit time. */
    schemaHint?: string;
    /** activityContext name at submit time. */
    activityHint?: string;
    /** Set if cancelled or failed. */
    error?: string;
    /** Edit history — last N edits for audit. */
    edits?: Array<{ at: number; by: string; oldText: string }>;
}
```

### 6.2 `QueueRequestState`

```ts
export type QueueRequestState =
    | "queued"      // in tail, not yet dispatched
    | "running"     // the head; the inner dispatcher is processing it
    | "succeeded"
    | "failed"
    | "cancelled";
```

**Note on "awaiting interaction."** When a running entry calls
`clientIO.question()`, the entry stays in `state: "running"` and gets
`blockedOn: "interaction"` set. It is *not* a peer enum value — it's
a sub-state on the head. This keeps the state machine flat and avoids
the "is awaiting_interaction a kind of running or a kind of queued?"
ambiguity that an earlier draft had.

### 6.3 `QueueSnapshot`

```ts
export interface QueueSnapshot {
    running: QueuedRequest | null;
    queued: QueuedRequest[];
    paused: boolean;
    /** Why the queue is paused; absent when `paused === false`. */
    pauseReason?: "user" | "no-clients";
    /**
     * Monotonic version stamp. Bumped on every queue mutation
     * (submit, start, cancel, complete) and copied onto every
     * push-event payload. Clients track the highest version they have
     * applied and ignore events with `version <= lastAppliedVersion`
     * to suppress stale or reordered deliveries. See §5.5 "Version
     * watermark" for the full protocol.
     */
    version: number;
}
```

Snapshots are cheap (in-memory) and sent on every state change (with
coalescing — see §8.2).

### 6.4 `QueueCancelReason`

Carried by `requestCancelled` events so clients can render distinct
messages instead of a generic "cancelled."

```ts
export type QueueCancelReason =
    | "user"             // explicit user cancel (most common)
    | "timeout"          // server-imposed timeout (reserved)
    | "disconnect"       // originator's connection went away (reserved)
    | "server_stopping"  // bounded shutdown deadline elapsed; entry abandoned
    | "queue_full"       // reserved for symmetry (not broadcast in Phase 1)
    | "no_clients";      // last client disconnected; see §11.4
```

### 6.5 Error types and result wrappers

The submit / cancel surfaces use **discriminated result types** rather
than thrown errors at the RPC boundary. Cross-process RPC flattens
typed errors to generic `Error` instances and drops structured fields
like `code` and `maxDepth`; a typed result gives clients a reliable
shape to branch on.

```ts
/** Outcome of `Dispatcher.submitCommand`. */
export type SubmitResult =
    | { ok: true;  entry: QueuedRequest }
    | { ok: false; error: "queue_full"; maxDepth: number }
    | { ok: false; error: "server_stopping" };

/** Outcome of `Dispatcher.cancelCommand`. */
export type CancelResult =
    | { kind: "cancelled_queued";   requestId: string }
    | { kind: "cancelled_running";  requestId: string }
    | { kind: "not_found";          requestId: string }
    | { kind: "already_completed";  requestId: string }; // reserved for v2
```

Server-side internals still throw `QueueFullError` / `ServerStoppingError`
for in-process convenience; `SharedDispatcher.submitCommand` catches
both and maps them to the `error` variants above before they cross
the wire.

---

## 7. State machine

**Main lifecycle.** Every entry follows this spine; the happy path
runs left to right.

```
            submit              dispatch              complete
(caller) ─────────► [queued] ─────────► [running] ─────────► [succeeded | failed]
                       │                    │
                       │ cancel             │ cancel
                       ▼                    ▼
                  [cancelled]           [cancelled]
```

**Interaction sub-loop.** While in `[running]`, the entry can pause
on an `await clientIO.question(...)`. This does not leave `running`
— it sets `blockedOn: "interaction"` as a side channel:

```
            clientIO.question                          respond
[running] ─────────────────────► [running, blockedOn=interaction] ─────► [running]
                                              │
                                              │ cancel interaction
                                              ▼
                                         [cancelled]
```

**Edits.** `editQueued` does not change `state`; it mutates the
entry's text and broadcasts `requestEdited`. Valid only from
`[queued]`.

### Invariants

- At most one entry has `state === "running"` at any time.
- The drain does **not** advance past a `running` entry, including
  one with `blockedOn: "interaction"`.
- `cancel(requestId)` is valid for entries in `queued` or `running`
  state. From `queued`, it removes from the tail. From `running`, it
  fires the `AbortController` (existing path).
- **`running` → `cancelled` is direct, not via an intermediate
  `"cancelling"` state.** Once cancel is requested, the entry is
  logically cancelled and removed from the head; the abort
  propagation inside the agent may take additional ticks to unwind,
  but no other state ever observes a `"cancelling"` intermediate.
  If we ever need to surface "cancel requested but agent still
  unwinding" we can add it later without breaking clients.
- Cancelling a `[running, blockedOn=interaction]` entry takes either
  path — `cancelCommand(running.requestId)` aborts the whole entry;
  `cancelInteraction(interactionId)` rejects just the pending
  `question` Promise and lets the agent decide (typically the agent
  fails the request, which also lands in `cancelled` or `failed`).
- Edit is valid **only** from `queued` (see
  [`messageSteering.md`](./messageSteering.md) §4.3).

---

## 8. Protocol additions

This section is the **wire reference** — every RPC, every event,
every result-payload field that ships. The *semantics* of the
steering RPCs (edit, pause, interrupt, …) live in
[`messageSteering.md`](./messageSteering.md); here we just declare
them.

### 8.1 `Dispatcher` interface additions

```ts
interface Dispatcher {
    // ===== Existing =====
    processCommand(...): Promise<CommandResult | undefined>;
    cancelCommand(requestId: string): Promise<CancelResult>;
    cancelCommandByClientId(clientRequestId: unknown): void;

    // ===== New (queueing) =====

    /**
     * Capability flag — `true` for queue-backed dispatchers (server),
     * absent/false for legacy / non-queueing dispatchers (raw in-
     * process). Clients gate queue-aware UX on this flag so they
     * degrade gracefully when talking to a dispatcher that just has
     * `processCommand`.
     */
    readonly supportsQueueing?: boolean;

    /**
     * Ack-on-enqueue submit. Resolves as soon as the entry is in the
     * queue (NOT when it finishes). Returns a discriminated result so
     * cross-process clients can branch on `queue_full` / `server_stopping`
     * — see §6.5.
     */
    submitCommand(
        text: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;

    /** Snapshot of the queue (cheap, in-memory). */
    getQueueSnapshot(): Promise<QueueSnapshot>;

    // ===== New (steering) — semantics in messageSteering.md =====

    editQueued(requestId: string, patch: EditPatch): Promise<void>;
    pauseQueue(): Promise<void>;
    resumeQueue(): Promise<void>;
    interrupt(
        text: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;
}
```

> **Return type note (impl alignment):** `interrupt` returns
> `Promise<SubmitResult>` — the same discriminated-union shape as
> `submitCommand` — rather than `Promise<QueuedRequest>` so that
> `queue_full` and `server_stopping` failures travel as data instead
> of as thrown errors whose subclass identity gets erased by the RPC
> layer. See §6.5.

**What's gone vs the earlier draft:**

- `reorderQueued` — **dropped**. Cancel + resubmit (or `interrupt`)
  covers the use case. Removes a primitive whose state-machine
  interactions added test surface for marginal benefit.
- `addBarrier` — **dropped**. A user who wants to pause after the
  queue drains simply stops submitting; a barrier only earns its keep
  with multi-client or auto-submit scenarios that we don't have.

### 8.2 `ClientIO` push events

Every event payload carries the queue's current `version` so out-of-
order delivery can be suppressed by the client — see §5.5.

```ts
interface ClientIO {
    // ===== Existing (subset) =====
    setUserRequest(...);
    setDisplay(...);
    notify(...);

    // ===== New (all optional; broadcast to every connected client) =====

    requestQueued?(entry: QueuedRequest, version: number): void;
    requestStarted?(entry: QueuedRequest, version: number): void;
    requestEdited?(entry: QueuedRequest, oldText: string, version: number): void;
    requestCancelled?(
        requestId: string,
        reason: QueueCancelReason,
        version: number,
    ): void;

    /** Fired in addition to fine-grained events. Payload is the snapshot AFTER. */
    queueStateChanged?(snapshot: QueueSnapshot): void;

    queuePaused?(snapshot: QueueSnapshot): void;
    queueResumed?(snapshot: QueueSnapshot): void;
}
```

**Privacy redaction.** `QueuedRequest` payloads broadcast through these
events have their `attachments` field **stripped**; only the
`attachmentCount` summary leaks. The originator already holds the raw
bytes locally; other clients should never receive attachments via the
queue channel because (a) they may be large (base64 images) and (b)
they may be private. See §5.5.

**Why both fine-grained AND snapshot.** Fine-grained events
(`requestQueued`, `requestEdited`, …) let active clients diff
efficiently and animate. Snapshot lets simple clients re-render from
truth. The server fires **both** unconditionally; clients filter by
which callbacks they implemented. No subscription RPC needed.

**Version watermark — strict less-than.** Every fine-grained event is
emitted *paired* with a `queueStateChanged` snapshot at the **same**
`version`. Clients track `lastAppliedVersion` and admit any event with
`version >= lastAppliedVersion` (strict `<` is rejected). Admitting
the snapshot at the same version as the just-applied fine-grained
event is idempotent — the snapshot reflects state *after* the same
transition — and ensures the authoritative snapshot can always
reconcile any delta-patcher divergence on the client side. (Using
`<=` would silently suppress every paired snapshot, leaving the
client's cached state entirely at the mercy of its local delta logic.)

**Broadcast policy — coalesce snapshots only.** Fine-grained events
go out immediately (each represents a discrete state change clients
may want to animate). Snapshots are coalesced: the **last** snapshot
per 100ms window wins, and intermediate snapshots are dropped. This
keeps event volume bounded under bursty submits while preserving
event ordering for animated UI.

> **`REVIEW 8.2` / `P1-broadcasts` — resolved:** keep both; coalesce
> snapshots only.

### 8.3 RPC wire additions

`packages/agentServer/protocol/src/protocol.ts` adds:

- **Outbound RPCs:** `submitCommand`, `getQueueSnapshot`,
  `editQueued`, `pauseQueue`, `resumeQueue`, `interrupt`.
- **Push events** on the `clientio:<conversationId>` channel:
  `requestQueued`, `requestStarted`, `requestEdited`,
  `requestCancelled`, `queueStateChanged`, `queuePaused`,
  `queueResumed`.

`processCommand` RPC is **kept** for backward compatibility; the
server implements it as `submitCommand` + await-completion-event.
Legacy MCP-style "fire and await" callers continue to work unchanged.

> **`REVIEW 8.3` — resolved:** add `submitCommand` alongside
> `processCommand`. The new one is what steering-aware clients should
> use; the old one stays for back-compat.

### 8.4 `JoinConversationResult.queueSnapshot`

`JoinConversationResult` already carries `pendingInteractions`. We
add `queueSnapshot` so a reconnecting client renders queue state
immediately instead of waiting for the next event.

```ts
interface JoinConversationResult {
    // ===== Existing =====
    conversationId: string;
    pendingInteractions: PendingInteraction[];

    // ===== New =====
    queueSnapshot: QueueSnapshot;
}
```

Compat model: **additive field + protocol version bump.** Existing
clients that don't read it degrade gracefully (they just don't render
queue state on reconnect). No hard compat gate.

> **`REVIEW 12.2` — resolved:** additive field, graceful degradation.

---

## 9. Existing dispatcher state — how each interacts with the queue

Concrete answers for the dispatcher-state hooks the queue must reason
about. Detailed background in
[`_deprecated/messageQueueing-review.md`](./_deprecated/messageQueueing-review.md) §4.

### 9.1 `activityContext`

The queue captures `schemaHint` / `activityHint` at submit time and
shows them in `getQueueSnapshot()`. Each entry executes against the
*current* `activityContext` at dispatch time, not the captured one.
The client UI surfaces the hint so the user can spot drift before it
matters. **No semantic change** from today; the queue just makes it
visible.

### 9.2 `batchMode` / `@run`

`@run <file>` is **enqueued as a single entry**, not exploded into
per-line entries. Inside the dispatcher,
`runScriptCommandHandler.ts` still sets `batchMode = true` for the
duration. The queue sees one entry; DisplayLog sees one "executing
`@run`" record. No new dispatcher hooks needed.

### 9.3 `pendingToggleTransientAgents`

Already drained inside `commandLock` per command. The queue preserves
serial execution, so this works unchanged.

### 9.4 `setUserRequest` ordering

`setUserRequest` continues to fire when execution *starts*, not when
queued. But the new `requestQueued` event fires at *submit time*, so
DisplayLog now has both records: a queued-entry record and an
execution-start record. Replay reconstructs the full timeline.

### 9.5 `isInsideReasoningLoop`

MCP sub-action dispatch happens *inside* a running entry. The queue
treats the parent request as the single entry; sub-actions are
invisible to the queue. No interaction.

### 9.6 `@conversation switch` while queue is non-empty

The switch handler in the CLI's `conversationCommands.ts` (and the
Shell equivalent) calls `connection.joinConversation()`. With a
server-side queue:

- The user's current conversation's queue is untouched (it lives on
  that `SharedDispatcher`).
- When the user comes back, the queue is still there.
- No "drop N queued" prompt needed — the queue persists naturally.

This is a clear win over the client-side design.

### 9.7 Slash commands

Local CLI slash commands (`/help`, `/clear`, `/queue list`, …) stay
client-side, do not touch the dispatcher, and bypass the queue. They
are pure UI controls.

`@`-commands and natural-language requests both flow through the
queue. The slash-command-invokes-processCommand audit from the
deprecated review doc is moot — those calls now go through
`submitCommand` and are visible in the queue.

---

## 10. Pending interactions interplay

The async ClientIO pattern is unchanged. When a running entry calls
`clientIO.question()`:

1. The head stays in `state: "running"` but gains
   `blockedOn: "interaction"`.
2. The queue does **not** drain past it.
3. Any connected client can answer the interaction via the existing
   `dispatcher.respondToInteraction`.
4. Once resolved, `blockedOn` clears, the dispatcher continues, the
   request completes, and the queue drains the next entry.

**Concurrent interactions** (e.g. an agent that issues
`await Promise.all([clientIO.question(...), clientIO.proposeAction(...)])`)
are handled by *reference counting* the `blockedOn` flag inside
`RequestQueue`. `markBlocked` increments an internal `blockedOnDepth`
counter; `markUnblocked` decrements it. The wire-visible `blockedOn`
field is `"interaction"` iff the count is positive, so a sibling
interaction that is still pending keeps the running entry visibly
blocked even after the other resolves. Without the counter, the first
`markUnblocked` would clear the flag and the no-clients grace timer
(§11.4) would misclassify the entry as "making progress" and leave it
stalled. The counter is internal to the queue — `markBlocked` /
`markUnblocked` callers in `sharedDispatcher.ts` do not need to know.

### Cancel semantics during a pending interaction

| Op | Effect |
|---|---|
| `cancelCommand(running.requestId)` | Calls `RequestQueue.cancelRunning(rid, "user")` (which broadcasts `requestCancelled` immediately so other clients see the explicit cancel), then triggers the underlying `AbortController`; the dispatcher's pending `question` Promise rejects via the existing path. Entry → `cancelled`. |
| `cancelInteraction(interactionId)` | Cancels just the interaction; the dispatcher receives a rejection and decides what to do (typically also fails the request — agent-defined). |

> Both the queued-cancel and running-cancel paths broadcast
> `requestCancelled(rid, reason, version)` — see §8.2. The running
> path uses `RequestQueue.cancelRunning` rather than waiting for the
> drain loop's completion broadcast so other clients render the
> cancel intent immediately, not after the inner command tears down.
>
> Unlike `cancelQueued`, `cancelRunning` does **not** also emit a
> paired `queueStateChanged`. At the moment the cancel is recorded
> the head's wire-visible `state` is still `"running"` (the drain
> loop hasn't tear-down yet), so a paired snapshot would carry stale
> `running.state === "running"` and — under strict-`<` admission
> (§8.2) — race-resurrect the cancelled entry on the client. The
> drain loop's completion broadcast one version higher is the
> authoritative snapshot for the cancel transition.

> Steering of pending interactions (UX, multi-client races on
> `respondToInteraction`) is covered in
> [`messageSteering.md`](./messageSteering.md) §4.6.

---

## 11. Reconnect / disconnect / server restart

### 11.1 Client disconnect

The submitting client disconnects (network drop, client crash, lid
close). The queue is **kept intact**. The entry's
`originatorConnectionId` becomes orphaned but the entry remains
addressable by `requestId`. Any other connected client can interact
with it.

Broadcast events for the running entry continue going to remaining
connected clients (this is already how `SharedDispatcher` works —
the broadcast loop in `sharedDispatcher.ts` iterates all live
connections per conversation).

### 11.2 Client reconnect

On `joinConversation()`, the server returns
`JoinConversationResult.queueSnapshot` alongside `pendingInteractions`.
The reconnecting client renders the full queue state immediately and
subscribes to future events.

### 11.3 Server restart

Queue is in-memory; **lost on restart in v1**. Clients see an empty
queue on reconnect with a clear "queue lost" indicator.

**v1.5 plan:** persist queued entries (state `"queued"`) via
`DisplayLog.saveQueued()` at submit time; reconstruct on startup. The
in-flight entry is **marked `failed` with `error: "server-restart"`**
on restart — the user sees it in the snapshot and decides to retry
or skip. We do **not** auto-resurrect the in-flight, because it may
have already had side effects (sent emails, written files) that
re-execution would duplicate.

> **`REVIEW 12.3` — resolved:** defer persistence to v1.5; in-flight
> marked failed on restart.

### 11.4 All clients disconnect

When the **last** connected client drops, the server starts a 30
second grace timer. If a client reconnects within that window the
timer is cleared and the queue continues normally.

If the deadline elapses with no clients connected, the server:

1. **Lets the running entry continue if it is making progress.** Its
   side effects matter — an in-flight email send shouldn't be aborted
   because the user closed their terminal.
2. **Cancels the running entry if it is blocked on a `clientIO.question`**
   (`state: "running"`, `blockedOn: "interaction"`). With no client to
   answer the prompt, the entry will stall indefinitely; cancellation
   is the honest outcome. The grace-expiry callback in
   `sharedDispatcher.ts` does three things in order:
   - calls `RequestQueue.cancelRunning(rid, "no_clients")` to record
     the cancel reason on the head entry and broadcast
     `requestCancelled(rid, "no_clients")` immediately,
   - rejects any matching pending interaction with an `Error` whose
     `name === "AbortError"` (so `command.ts`'s standard AbortError
     classification translates the agent's thrown rejection into
     `cancelled: true` rather than `failed`),
   - fires the `AbortController` via the inner
     `bareDispatcher.cancelCommand(rid)` for completeness.

   When the drain loop sees the resulting `cancelled: true`, it
   stamps `entry.error = "cancelled:no_clients"` from the
   pre-recorded reason and broadcasts the final
   `queueStateChanged`.
3. **Cancels every queued entry** (`state: "queued"`).
4. Broadcasts `requestCancelled` for each cancelled entry with reason
   `"no_clients"` (a distinct value so a future reconnecting client
   could in principle log "I cancelled these because you were gone").
5. Leaves pending interactions to their existing 10-minute timeout.

When a client reconnects later, it sees an empty (or running-only)
queue via `getQueueSnapshot` and the usual lifecycle events on
subsequent submits.

**Phase 2 evolution.** When the steering layer adds `pauseQueue` /
`resumeQueue` (see [`messageSteering.md`](./messageSteering.md)), this
behaviour switches from *cancel-on-grace-expiry* to *auto-pause-on-
grace-expiry* with `pauseReason: "no-clients"`, so the queue contents
survive reconnect and the user is prompted to resume. The Phase 1
choice is intentionally lossy to keep the steering surface small;
users who care about durability can avoid queueing while disconnected.

> **`REVIEW 12.4` — resolved:** Phase 1 cancels on grace expiry;
> Phase 2 will switch to auto-pause once pause/resume exists.

---

## 12. Multi-client semantics

The full steering-ops matrix (who can do what to whom) lives in
[`messageSteering.md`](./messageSteering.md) §5. The queueing-side
summary:

| Action | From originating client | From other connected client | While client is disconnected |
|---|---|---|---|
| Submit | OK | OK | N/A |
| Cancel queued / running | OK | OK | N/A |
| Pause / Resume | OK | OK | N/A |
| Respond to interaction | OK (existing race) | OK (existing race) | N/A |

**No queue-ownership in v1.** Any connected client can steer any
entry, regardless of which client originally submitted it. Model is
"one human, many clients." Add an `owner-only` mode later if real
usage demands.

> **`REVIEW 9.2` — resolved:** no ownership in v1.

---

## 13. Phasing

> TypeAgent isn't shipped externally yet, so this section is about
> **dev-time delivery order**, not gated production rollout. There
> are no feature flags; each phase merges to main when its scope is
> complete and tested.

### 13.1 Phased delivery

```
Phase 1 (Queueing)              Phase 2 (Steering)           v1.5 polish
─────────────────               ──────────────────           ────────────
RequestQueue impl           ──► editQueued                ──►  persistence
events + snapshot           ──► pauseQueue / resumeQueue
cancel queued
reconnect restore
type-ahead UX
interrupt                       (no Shell UI in either phase —
                                 slash commands only; see steering doc)
```

#### Phase 1 — Queueing

**Goal:** user submits a request and immediately regains control.
The next request can be typed/submitted right away. All connected
clients see the same queue.

**Server scope:**

- `RequestQueue` class inside `SharedDispatcher`, drain loop from §5.2.
- New RPCs: `submitCommand` (ack-on-enqueue), `getQueueSnapshot`,
  `interrupt`.
- New push events: `requestQueued`, `requestStarted`,
  `requestCancelled`, `queueStateChanged`.
- `cancelCommand` extended to handle queued state (the existing
  `AbortController`-before-lock design already supports it; the queue
  also removes from the tail array).
- `JoinConversationResult.queueSnapshot` field for reconnect restore.
- Backward-compat: `processCommand` RPC still works (server delegates
  to `submitCommand` + await completion event).
- `schemaHint` / `activityHint` captured at submit time.
- Telemetry (§13.2).

**Client scope (CLI + Shell):**

- **CLI** — `/queue list`, `/queue cancel`, `/queue interrupt` slash
  commands. Prompt indicator `(queue: N) ❯` re-derived live at render
  time from the cached snapshot so it updates the instant the queue
  changes (not only on the next Enter). Input loop is unblocked (the
  `await processCommand` becomes `submitCommand` + return). Reconnect
  banner "Queue restored: N entries." **Double-Escape** within a
  short window (`DOUBLE_ESCAPE_WINDOW_MS = 1000`) clears the queue —
  cancels the running entry plus every queued entry via
  `cancelAllInQueue`, printing a one-line summary.

- **Shell** — **per-bubble queue status chips**: each user message
  bubble grows a small "queued" / "running" pill driven by the four
  queue push events (`requestQueued` / `requestStarted` /
  `requestCancelled` / `queueStateChanged`). The previous global
  "Queue: N" badge was removed — the chat history itself is the
  queue surface, so a header was redundant. The chip flips queued →
  running when execution starts (so peer-originated requests get a
  per-bubble indicator they otherwise lack — local requests still
  show the chat-input spinner alongside) and is cleared via the
  `queueStateChanged` reconcile pass when the entry leaves the
  snapshot (normal completion) or by `requestCancelled` (user
  cancel / server stopping). Shared helper
  `reconcileChipsToSnapshot(prev, next)` drives the
  `applyQueueSnapshot` (bootstrap / reconnect) and
  `onQueueStateChanged` paths so chip lifecycle stays consistent.
  Existing `stopButton` (`chatView.ts`) still cancels the running
  entry. **Double-Escape** within the same 1s window calls
  `cancelAllQueuedAndRunning` (Shell counterpart to the CLI helper):
  cancels every entry in the snapshot via `dispatcher.cancelCommand`.
  Chips that fire before their MessageGroup is created (e.g.
  `requestQueued` racing ahead of local-pending promotion, or a
  peer-originated request arriving before `addRemoteUserMessage`)
  are stashed in `pendingQueueStatus` and drained when the MG
  materializes. **No new Shell buttons in v1** (interrupt is
  CLI-only via slash command for now —
  [`messageSteering.md`](./messageSteering.md) §6.2).

> **Version-gate detail.** Both CLI (`admitVersion`) and Shell
> (`ChatView.admitVersion`) use **strict** `version < lastApplied`
> for the watermark check — same-version events ARE admitted. The
> server intentionally pairs each fine-grained event (e.g.
> `requestStarted`) with an authoritative `queueStateChanged` at the
> SAME version so the snapshot can overwrite any partial mutation
> the granular event produced. Using `<=` here would drop the
> snapshot and let the client drift.

**User-visible at end of Phase 1:**

- Type-ahead across all opted-in clients.
- Visible queue with counts.
- Cancel queued items.
- Single-client disconnect/reconnect preserves the queue. If the
  **last** client disconnects, a 30s grace timer protects against
  transient drops; if it elapses with no clients, the queue is
  cleared (running entry continues unless blocked on an interaction
  — see §11.4). Auto-pause-on-grace is Phase 2.
- Interrupt via `/queue interrupt <text>`.

**Out of scope for Phase 1:** edit, pause/resume.

#### Phase 2 — Steering

**Goal:** user can actively shape the queue — edit a queued entry's
text, pause to think, resume when ready.

**Server scope:**

- New RPCs: `editQueued`, `pauseQueue`, `resumeQueue`.
- New push events: `requestEdited`, `queuePaused`, `queueResumed`.
- Validation: `editQueued` throws `QueueStateError` if
  `state !== "queued"` (hard-block — see steering doc §4.3).
- Edit history (`entry.edits[]`) for audit.

**Client scope:**

- **CLI** — `/queue edit N <text>`, `/queue pause`, `/queue resume`.
- **Shell** — still read-only display; no new Shell buttons in v2
  either. Re-evaluate after Phase 2 usage data.

**User-visible at end of Phase 2:** edit queued entries; pause to
batch-up requests, then resume.

#### v1.5 polish

- Queue persistence across server restart (§11.3).
- Re-evaluate any Phase 1/2 deferrals based on usage data.

### 13.2 Telemetry

`requestQueue:submit`, `:start`, `:complete`, `:cancel`, `:edit`,
`:pause`, `:resume`, `:interrupt`, `:reconnect-restore`.

Payloads include `connectionId` of the actor so we can answer
"which client steered the queue most?" type questions.

Note for anyone migrating from earlier sketches: events are prefixed
`requestQueue:` (not `messageQueue:`) and there is no `:reorder`
event. See the deprecated docs for the earlier draft that had both.

---

## 14. Testing

Server-side tests live in
`packages/agentServer/server/test/requestQueue.spec.ts`. Wire-level
tests in `packages/agentServer/client/test/queue.spec.ts`.

Key scenarios:

- **Drain order.** Submit A, B, C; assert they run in order; each
  fires `requestStarted` then `requestCompleted`.
- **Cancel queued.** Submit A; submit B; cancel B; assert B never
  starts.
- **Cancel running.** Submit A (slow); cancel A; assert
  `AbortController` fires; entry → `cancelled`; next entry drains.
- **Edit-while-running rejection.** Submit; let it start; attempt
  `editQueued(running.requestId)`; assert `QueueStateError`.
- **Pause + submit + resume.** Pause; submit two entries; assert
  neither dispatches; resume; assert both run in order.
- **Interrupt cancels current and prepends new.** Submit slow
  request; interrupt; assert original cancelled, new runs as next
  head.
- **Pending interaction + queue.** Submit A; A triggers
  `clientIO.question`; submit B; respond to interaction; assert A
  completes then B runs.
- **Multi-client consistency.** Two test harness clients connected to
  the same conversation; one submits, the other cancels; assert both
  see the same final snapshot.
- **Reconnect with non-empty queue.** Disconnect client mid-queue;
  reconnect; assert `JoinConversationResult.queueSnapshot` matches
  expected state.
- **All-clients-disconnect.** Disconnect all; assert running entry
  completes; assert queue auto-pauses with
  `pauseReason: "no-clients"` after 30s; reconnect; assert no
  auto-resume.
- **Snapshot coalescing.** Fire 20 rapid submits; assert at most one
  snapshot event per 100ms window; assert all fine-grained
  `requestQueued` events are delivered.
- **Retry preserves requestId.** Submit; force transient failure;
  assert retry uses same `requestId` with `attempt: 2`.

---

## 15. References

- [`messageSteering.md`](./messageSteering.md) — companion doc on
  steering operations and UX.
- [`_deprecated/messageQueueing-original.md`](./_deprecated/messageQueueing-original.md)
  — the original client-side design; preserved for the §4
  dispatcher-state analysis.
- [`_deprecated/messageQueueing-review.md`](./_deprecated/messageQueueing-review.md)
  — the review of the client-side design that motivated the
  server-side rewrite.
- `packages/agentServer/server/src/sharedDispatcher.ts` — host of the
  new `RequestQueue`.
- `packages/dispatcher/dispatcher/src/dispatcher.ts` — the inner
  dispatcher the queue calls into.
- `packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts`
  — declares `commandLock`.
- `packages/utils/commonUtils/src/limiter.ts` — the `Limiter` backing
  `commandLock`.
- `packages/agentServer/protocol/src/` — wire protocol additions land
  here.
- `packages/agentServer/docs/async-clientio-design.md` — the
  established pattern for async, disconnect-resilient ClientIO that
  the queue follows.
