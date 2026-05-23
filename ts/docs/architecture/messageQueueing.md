# Request Queue

> **Scope:** the **core mechanism** of the per-conversation request
> queue — storage, drain loop, lifecycle, state machine, broadcast
> protocol, reconnect/restart. Layered design: the queue lives **in
> `Dispatcher`** (so every host gets type-ahead, not just
> agent-server-mediated clients), and `SharedDispatcher` adds the
> multi-client orchestration on top (broadcast fan-out, reconnect
> snapshot, no-clients grace timer, server-restart persistence).
>
> **Out of scope (separate doc):** a forthcoming steering design
> document will cover everything a user/client can do to actively
> shape the queue beyond submit and cancel: `editQueued`,
> `pauseQueue` / `resumeQueue`, `interrupt`, respond-to-interaction,
> the CLI slash-command UX, and the multi-client steering matrix.
> That document is not yet included in this branch.
>
> **Superseded:** the original client-side queue design and its review
> live in [`_deprecated/`](./_deprecated/) for historical context.

**Status:** Draft — design landed.
**Last Updated:** 2026-05-22 (editorial pass; removed forward-pointers to
forthcoming steering doc).

---

## Reading order

§1 – §3 give the elevator pitch, today's dispatcher layout, and a
one-screen before/after. §4 – §8 are the meat: layering, data model,
state machine, wire protocol. §9 – §12 cover interactions with
existing dispatcher state (activity context, batch mode, pending
interactions, reconnect, multi-client). §13 – §14 are testing and
references.

Steering operations (`editQueued`, `pauseQueue` / `resumeQueue`,
`interrupt`, the CLI slash-command UX) are intentionally out of
scope; they will be specified in a separate steering design document
when it lands.

---

## 1. Summary

We replace TypeAgent's implicit serialization-via-`commandLock` with
an explicit `RequestQueue` owned by **`Dispatcher`**
(`packages/dispatcher/dispatcher/src/`). The queue is the canonical
source of truth for pending and in-flight requests per conversation.
Every host that creates a `Dispatcher` — agent-server, Shell direct,
Web API direct, tests — runs the same queue mechanism with the same
execution semantics.

`SharedDispatcher`
(`packages/agentServer/server/src/sharedDispatcher.ts`) layers
multi-client orchestration on top: it wraps the queue's lifecycle
`ClientIO` events with its existing broadcast fan-out, restores the
queue snapshot on `joinConversation`, runs the no-clients grace
timer, and (in v1.5) drives server-restart persistence. It owns no
queue state — `Dispatcher` is the source of truth.

The existing `Dispatcher.processCommand` contract is preserved
(`Promise<CommandResult>`); we add `submitCommand` for ack-on-enqueue
semantics plus `ClientIO` push events so every connected client sees
the queue's lifecycle in real time.

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
_block on the lock_; clients see this as "the agent is busy."

### 2.2 Modules you should know before reading further

| Module                              | Path                                                                  | Role today                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dispatcher`                        | `packages/dispatcher/dispatcher/src/dispatcher.ts`                    | The execution engine. Exposes `processCommand`, `cancelCommand`, `respondToChoice`, etc. **This is where `RequestQueue` will live.** Every host (agent-server, Shell direct, Web API, tests) creates a `Dispatcher`; putting the queue here gives all of them type-ahead.                      |
| `RequestQueue` (new)                | `packages/dispatcher/dispatcher/src/requestQueue.ts` (proposed)       | Standalone per-conversation queue. Storage + drain loop + lifecycle events. Constructed by `Dispatcher`; fires events through the host's `ClientIO`. Currently lives in `agentServer/server/src/` as legacy; the move to dispatcher package is part of this design.                            |
| `SharedDispatcher`                  | `packages/agentServer/server/src/sharedDispatcher.ts`                 | Wraps a `Dispatcher` to add multi-client orchestration: fans out `ClientIO` events to all connected clients via its existing `broadcast()` helper, returns queue snapshot on `joinConversation`, runs the no-clients grace timer, drives v1.5 server-restart persistence. Owns no queue state. |
| `CommandHandlerContext.commandLock` | `packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts` | A `createLimiter(1)` (mutex) acquired inside `command.ts` around every command. Today this is what makes the dispatcher serial. After the queue ships, it stays as defense-in-depth (see §5.3).                                                                                                |
| `Limiter`                           | `packages/utils/commonUtils/src/limiter.ts`                           | Tiny hand-rolled non-reentrant async semaphore. Backs `commandLock`.                                                                                                                                                                                                                           |
| `PendingInteractionManager`         | `packages/agentServer/server/src/sharedDispatcher.ts` (within file)   | Already-shipped pattern for keeping `clientIO.question()` interactions alive across disconnect/reconnect. The reconnect-snapshot pattern for the queue mirrors it.                                                                                                                             |
| `ClientIO` protocol                 | `packages/agentServer/protocol/src/` (clientio.ts, protocol.ts)       | The interface the dispatcher uses to push events (`setUserRequest`, `setDisplay`, `notify`, …) to its host. `SharedDispatcher` wraps `ClientIO` to fan out to every connected client. We extend it with `requestQueued`, `queueStateChanged`, etc., which inherit the same wrapping.           |
| `JoinConversationResult`            | same protocol package                                                 | Returned on `joinConversation()`. Already carries `pendingInteractions`. `SharedDispatcher` adds `queueSnapshot` here (sourced from `dispatcher.getQueueSnapshot()`) so reconnecting clients render queue state immediately.                                                                   |
| `DisplayLog`                        | dispatcher's persisted user-request log                               | The persistence target for the v1.5 server-restart-survives-queue story. Already records user requests at submit time.                                                                                                                                                                         |
| Existing cancel paths               | `Dispatcher.cancelCommand(requestId)`, `cancelCommandByClientId(...)` | Cancel a running request via the `AbortController`-before-lock design. **Already work on requests that haven't acquired the lock yet** — which is exactly the property we lean on for "cancel a queued entry."                                                                                 |

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

---

## 3. The change on one screen

```
BEFORE                                       AFTER
──────                                       ─────

client.processCommand("foo")                 client.submitCommand("foo")
        │                                            │
        ▼                                            ▼
SharedDispatcher.processCommand              SharedDispatcher.submitCommand    (1)
        │                                            │
        ▼                                            ▼
Dispatcher.processCommand                    Dispatcher.submitCommand          (2)
        │                                            │
        ▼                                            ▼
commandLock (serializes here)                RequestQueue.submit               (3)
        │                                            │
        ▼                                            ▼
agent.executeAction                          tail.push(entry); drain()
                                                     │
                                                     ▼
                                             drain loop (inside Dispatcher):
                                                head = tail.shift()
                                                emits requestStarted via ClientIO
                                                processCommand(head, …)        (4)
                                                     │
                                                     ▼
                                             commandLock — no contention
                                                     │
                                                     ▼
                                             agent.executeAction
```

(1) Thin wrapper; the `ClientIO` wrapper fans queue lifecycle events
(`requestQueued`, `requestStarted`, `requestCancelled`,
`queueStateChanged`) out to every connected client.
(2) Returns immediately once the entry is on the queue (ack-on-enqueue).
(3) Emits `requestQueued` through `ClientIO` at this point.
(4) Original `processCommand` body, unchanged. `commandLock` is kept as
defense-in-depth (see §5.3); the drain loop guarantees no contention.

The queue lives **inside `Dispatcher`**, so direct callers (Shell, Web,
tests) get the same submit-then-drain semantics as agent-server-mediated
clients. `SharedDispatcher` adds nothing to the execution path — it only
wraps the host `ClientIO` so lifecycle events reach every connected
client. The wire-level `processCommand` RPC is preserved (server-side it
is `submitCommand` + await-completion), keeping legacy fire-and-await
callers working unchanged.

---

## 4. Goals and non-goals

### 4.1 Goals

- **Ack-on-enqueue.** Submission returns control immediately; clients
  do not block until execution completes.
- **Universal type-ahead.** Every host that creates a `Dispatcher`
  benefits: agent-server-mediated clients, the Electron Shell's
  direct path, the Web API, dispatcher tests. No fallback code path
  that drifts from the real implementation.
- **Multi-client consistent.** When the host is `SharedDispatcher`,
  every connected client sees the same queue and every queue
  lifecycle event fans out to all of them. Single-consumer hosts
  see the same events on their one `ClientIO`.
- **Disconnect-resilient.** Queue survives client disconnect; a
  reconnecting client (or a different client representing the same
  human) restores queue state from a snapshot.
- **Backward-compatible.** Old clients that don't subscribe to queue
  events still work and see today's behaviour (one in-flight,
  serialized) via the preserved `processCommand` RPC. See §8.5 for
  the full transparent-upgrade matrix.
- **Auditable.** Queue lifecycle (enter, leave, cancel) is logged to
  `DisplayLog` and replayable.

### 4.2 Non-goals

- **Steering operations** (`editQueued`, `pauseQueue` / `resumeQueue`,
  `interrupt`). Out of scope — see opening note.
- **Cross-conversation scheduling.** Each `Dispatcher` manages its own
  queue; no global fairness.
- **Persistence across server restart.** Queue is in-memory; queued
  entries are lost on restart (see §11.3).
- **Multi-user conflict resolution.** All connected clients are
  assumed to represent the same human; last-writer-wins on any
  concurrent mutation. Multi-human collaboration is out of scope.

---

## 5. Architecture

### 5.1 Where `RequestQueue` lives — the layering

The queue is **owned by `Dispatcher`**. `SharedDispatcher` only adds
multi-client orchestration on top; it holds no queue state of its own.

```
┌──────────────────────────────────────────────────────────────────┐
│  agent-server  (per conversation, optional layer)                │
│                                                                  │
│  SharedDispatcher           (multi-client orchestration only)    │
│   ├── PendingInteractionManager   (existing)                     │
│   ├── ClientIO wrapper / broadcast()                             │
│   │     ── fans out queue events from inner Dispatcher's         │
│   │        ClientIO to every connected client                    │
│   ├── joinConversation() returns                                 │
│   │     queueSnapshot = dispatcher.getQueueSnapshot()            │
│   ├── no-clients grace timer (calls dispatcher.cancelCommand)    │
│   └── v1.5: server-restart persistence (DisplayLog ↔ queue)      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Dispatcher  (per conversation — SAME class used by Shell, │  │
│  │              Web, tests directly without SharedDispatcher) │  │
│  │   ├── processCommand / cancelCommand   (existing)          │  │
│  │   ├── submitCommand / getQueueSnapshot (NEW, queue-backed) │  │
│  │   └── RequestQueue                                         │  │
│  │         ├── head: QueuedRequest | null   ← running         │  │
│  │         ├── tail: QueuedRequest[]        ← FIFO queue      │  │
│  │         ├── paused: boolean                                │  │
│  │         ├── pauseReason?: "user" | "no-clients"            │  │
│  │         ├── version: number       (monotonic watermark)    │  │
│  │         └── drain loop ──► this.processCommand             │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

The queue is **per-conversation**. Each `Dispatcher` instance gets
its own. No global queue, no cross-conversation interaction.

**Who creates `Dispatcher` directly (no `SharedDispatcher`):**

| Host                       | Path                                            | Gets queueing via this design                                                  |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron Shell (main proc) | `packages/shell/src/main/instance.ts`           | Yes — renderer becomes a real queue-aware client across the local RPC channel. |
| Web API server             | `packages/api/src/webDispatcher.ts`             | Yes — web frontend gets type-ahead.                                            |
| CLI test commands          | `packages/cli/src/commands/test/translate.ts`   | Yes (irrelevant for batch testing).                                            |
| Dispatcher / agent tests   | `packages/dispatcher/dispatcher/test/*.spec.ts` | Yes — can exercise queue behavior directly.                                    |
| Onboarding / benchmarks    | `packages/agents/.../benchmark/*.mts`           | Yes (one-shot scripts; queue is effectively pass-through).                     |

**Who creates `Dispatcher` via `SharedDispatcher`:**

| Host                         | Path                          | Extra wins from orchestration                                                       |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| CLI (connected mode)         | `packages/cli/`               | Queue events broadcast to all connected clients; reconnect restores queue snapshot. |
| Any agent-server-mediated UI | (various, via `agent-server`) | Same.                                                                               |

### 5.1.1 Division of responsibilities

| Concern                                       | Owner              | Notes                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tail / head storage                           | `Dispatcher`       | The `RequestQueue` instance.                                                                                                                                                                                                 |
| Drain loop                                    | `Dispatcher`       | Calls `this.processCommand` (no recursive RPC).                                                                                                                                                                              |
| State machine + transitions                   | `Dispatcher`       | Queued / running / cancelled / succeeded / failed.                                                                                                                                                                           |
| `requestId` assignment (at submit)            | `Dispatcher`       | The queue assigns it; `processCommand` accepts it as a parameter.                                                                                                                                                            |
| `version` watermark                           | `Dispatcher`       | Monotonic counter incremented on every mutation.                                                                                                                                                                             |
| Bounded queue (`MAX_QUEUE_DEPTH`)             | `Dispatcher`       | Coarse DOS guard.                                                                                                                                                                                                            |
| `drainAndStop` (graceful shutdown)            | `Dispatcher`       | Called by whoever owns the Dispatcher lifecycle (`agent-server`, Shell main, etc.).                                                                                                                                          |
| Privacy redaction (`attachments` stripping)   | `Dispatcher`       | Already needed for any host with > 1 observer; cheap to always apply.                                                                                                                                                        |
| Snapshot coalescing                           | `Dispatcher`       | Bounds event volume even for single-client hosts.                                                                                                                                                                            |
| **Firing** lifecycle events                   | `Dispatcher`       | Calls `clientIO.requestQueued?(…)` etc. — exactly one call per transition.                                                                                                                                                   |
| **Fanning out** lifecycle events              | `SharedDispatcher` | Its `ClientIO` wrapper (`sharedDispatcher.ts:122-165`) intercepts every method call and routes to all connected clients. Queue events inherit this for free — no new plumbing.                                               |
| Reconnect snapshot (`JoinConversationResult`) | `SharedDispatcher` | Calls `dispatcher.getQueueSnapshot()` inside `joinConversation()`.                                                                                                                                                           |
| No-clients grace timer                        | `SharedDispatcher` | Observes client connect/disconnect, cancels via `dispatcher.cancelCommand(rid)` when the deadline expires (§11.4). Direct hosts have no concept of "no clients."                                                             |
| Server-restart persistence (v1.5)             | `SharedDispatcher` | Hooks into `DisplayLog` writes and agent-server startup. Direct hosts manage their own process lifecycle.                                                                                                                    |
| Originator-disconnected fallback              | n/a (gone)         | No longer needed — the queue's execute callback is `Dispatcher.processCommand` itself; there is no per-connection wrapper to fall back from. The current `bareDispatcher` workaround in `sharedDispatcher.ts:414` goes away. |

### 5.2 The drain loop (pseudocode)

```ts
// Lives in Dispatcher, not SharedDispatcher.
class RequestQueue {
  private head: QueuedRequest | null = null;
  private tail: QueuedRequest[] = [];
  private paused = false;
  private pauseReason?: "user" | "no-clients";
  private version = 0;

  constructor(
    private readonly execute: (entry: QueuedRequest) => Promise<CommandResult>,
    private readonly clientIO: ClientIO, // host's ClientIO (wrapped by SharedDispatcher if applicable)
  ) {}

  async submit(req: SubmittedRequest): Promise<QueuedRequest> {
    const entry = this.materialize(req); // assigns requestId
    this.tail.push(entry);
    this.bumpVersion();
    this.logToDisplayLog(entry, "queued");
    this.clientIO.requestQueued?.(entry, this.version); // one call; fan-out happens above
    this.emitSnapshot();
    this.drain();
    return entry; // ack-on-enqueue
  }

  /** Dispatch the head if possible. Idempotent — safe to call from
   *  submit, completion, or resumeQueue without coordination. */
  private async drain() {
    if (this.head !== null) return; // already running
    if (this.paused) return;
    const next = this.tail.shift();
    if (!next) return;
    this.head = next;
    next.state = "running";
    this.bumpVersion();
    this.clientIO.requestStarted?.(next, this.version);
    this.emitSnapshot();
    try {
      const result = await this.execute(next);
      this.completeHead(result);
    } catch (e) {
      this.failHead(e);
    }
    this.head = null;
    this.drain();
  }
}
```

The `execute` callback is `Dispatcher.processCommand` bound to the
queue-assigned `requestId`, so existing `setUserRequest`,
`setDisplay`, and `cancelCommand` plumbing all work unchanged.
`Dispatcher` constructs the queue and supplies its own
`processCommand` as the execute callback — `RequestQueue` is purely
mechanical and has no Dispatcher-internal knowledge.

### 5.3 `commandLock` — kept as defense-in-depth

`commandLock` (`commandHandlerContext.ts`, initialized via
`createLimiter(1)`) is acquired inside `command.ts` around every
`processCommand` call. Today it serializes concurrent
`processCommand`s — the implicit FIFO is inside `Limiter`'s
`p`/`resolve` promise.

After the queue ships, the drain loop only ever calls
`processCommand` when `head === null`, so the lock acquisition
always wins immediately. The lock stays in place because three other
paths still depend on it:

- **Agent-mutation paths** in `sessionContext.ts` (lines around 47,
  65, 82, 167, 254) re-acquire `commandLock` to safely mutate
  context.
- **`respondToChoice`** acquires the lock independently
  (`dispatcher.ts` around line 560). The queue is unaware of choice
  responses; the lock is what prevents a choice response from racing
  with a recursive command invocation.
- **`flowInterpreter.ts`** uses lock state to avoid re-entry.

The lock is cheap when uncontended, so keeping it costs nothing.

### 5.4 `requestId` ownership

Today the server-side UUID is generated _inside_
`command.ts`'s `processCommand`. With the queue, the queue assigns it
at enqueue time and passes it in. This requires plumbing a
`requestId` parameter through `Dispatcher.processCommand` (currently
auto-generated).

Why this matters: clients need a stable handle on an entry as soon as
it's submitted — for cancellation, snapshot diffing, and future
steering operations. If the id were generated only at execution time,
queued entries would not yet have one, and clients couldn't address
them.

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
single shutdown entry point invoked by `Dispatcher.close()` (which
`SharedDispatcher.close()` calls into for agent-server hosts). It:

1. Marks the queue as `stopped` — further `submit` calls fail with
   `SubmitResult.error = "server_stopping"`.
2. Lets the drain loop finish whatever entries it can before the
   deadline (default `SHUTDOWN_DRAIN_DEADLINE_MS = 30000`).
3. When the deadline fires, _abandons_ every remaining entry: rejects
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
  /** Raw user input. */
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
  /** Set if cancelled or failed. */
  error?: string;
}
```

### 6.2 `QueueRequestState`

```ts
export type QueueRequestState =
  | "queued" // in tail, not yet dispatched
  | "running" // the head; the inner dispatcher is processing it
  | "succeeded"
  | "failed"
  | "cancelled";
```

**Note on "awaiting interaction."** When a running entry calls
`clientIO.question()`, the entry stays in `state: "running"` and gets
`blockedOn: "interaction"` set. It is _not_ a peer enum value — it's
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
  | "user" // explicit user cancel (most common)
  | "timeout" // server-imposed timeout (reserved)
  | "disconnect" // originator's connection went away (reserved)
  | "server_stopping" // bounded shutdown deadline elapsed; entry abandoned
  | "queue_full" // reserved for symmetry (not broadcast in Phase 1)
  | "no_clients"; // last client disconnected; see §11.4
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
  | { ok: true; entry: QueuedRequest }
  | { ok: false; error: "queue_full"; maxDepth: number }
  | { ok: false; error: "server_stopping" };

/** Outcome of `Dispatcher.cancelCommand`. */
export type CancelResult =
  | { kind: "cancelled_queued"; requestId: string }
  | { kind: "cancelled_running"; requestId: string }
  | { kind: "not_found"; requestId: string }
  | { kind: "already_completed"; requestId: string }; // reserved for v2
```

Internals still throw `QueueFullError` / `ServerStoppingError` for
in-process convenience; `Dispatcher.submitCommand` catches both and
maps them to the `error` variants above before returning (and so
before they cross any RPC boundary).

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

---

## 8. Protocol additions

This section is the **wire reference** — every RPC, every event,
every result-payload field the core queue mechanism ships.

### 8.1 `Dispatcher` interface additions

These methods are implemented in `Dispatcher` itself — there is no
SharedDispatcher fallback. Every host (Shell main, Web API, tests,
agent-server) gets the same submit / cancel / snapshot semantics.

```ts
interface Dispatcher {
    // ===== Existing =====
    processCommand(...): Promise<CommandResult | undefined>;
    cancelCommand(requestId: string): Promise<CancelResult>;
    cancelCommandByClientId(clientRequestId: unknown): void;

    // ===== New (queueing) =====

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
}
```

`cancelCommand` is **existing** API; the queue mechanism extends its
reach to `queued` entries (tail removal) on top of the existing
`AbortController`-before-lock plumbing for `running` entries.

### 8.2 `ClientIO` push events

Every event payload carries the queue's current `version` so out-of-
order delivery can be suppressed by the client — see §5.5.

```ts
interface ClientIO {
    // ===== Existing (subset) =====
    setUserRequest(...);
    setDisplay(...);
    notify(...);

    // ===== New (all optional) =====

    requestQueued?(entry: QueuedRequest, version: number): void;
    requestStarted?(entry: QueuedRequest, version: number): void;
    requestCancelled?(
        requestId: string,
        reason: QueueCancelReason,
        version: number,
    ): void;

    /** Fired in addition to fine-grained events. Payload is the snapshot AFTER. */
    queueStateChanged?(snapshot: QueueSnapshot): void;
}
```

**How fan-out works.** `Dispatcher` makes exactly one call per
transition into its host-provided `ClientIO`. For direct hosts
(Shell, Web), that's the one consumer and the call lands locally.
For agent-server, `SharedDispatcher` wraps `ClientIO` (see
`sharedDispatcher.ts:122–165` — same wrapper that already fans out
`setUserRequest`, `setDisplay`, `notify`, etc.) and rebroadcasts each
queue event to every connected client. **No new fan-out plumbing is
needed**; queue events inherit the existing pattern.

**Privacy redaction.** `QueuedRequest` payloads emitted through these
events have their `attachments` field **stripped**; only the
`attachmentCount` summary leaks. The originator already holds the raw
bytes locally; other clients should never receive attachments via the
queue channel because (a) they may be large (base64 images) and (b)
they may be private. Redaction happens inside `RequestQueue` before
firing the `ClientIO` call, so it applies uniformly regardless of
host. See §5.5.

**Why both fine-grained AND snapshot.** Fine-grained events
(`requestQueued`, `requestStarted`, `requestCancelled`) let active
clients diff efficiently and animate. Snapshot lets simple clients
re-render from truth. `Dispatcher` fires **both** unconditionally;
clients filter by which callbacks they implemented. No subscription
RPC needed.

**Version watermark — strict less-than.** Every fine-grained event is
emitted _paired_ with a `queueStateChanged` snapshot at the **same**
`version`. Clients track `lastAppliedVersion` and admit any event with
`version >= lastAppliedVersion` (strict `<` is rejected). Admitting
the snapshot at the same version as the just-applied fine-grained
event is idempotent — the snapshot reflects state _after_ the same
transition — and ensures the authoritative snapshot can always
reconcile any delta-patcher divergence on the client side. (Using
`<=` would silently suppress every paired snapshot, leaving the
client's cached state entirely at the mercy of its local delta logic.)

**Broadcast policy — coalesce snapshots only.** Fine-grained events
go out immediately (each represents a discrete state change clients
may want to animate). Snapshots are coalesced inside `RequestQueue`:
the **last** snapshot per 100ms window wins, and intermediate
snapshots are dropped. This keeps event volume bounded under bursty
submits while preserving event ordering for animated UI.

### 8.3 RPC wire additions

For agent-server-mediated clients,
`packages/agentServer/protocol/src/protocol.ts` adds:

- **Outbound RPCs:** `submitCommand`, `getQueueSnapshot` — both are
  thin pass-throughs to the inner `Dispatcher`.
- **Push events** on the `clientio:<conversationId>` channel:
  `requestQueued`, `requestStarted`, `requestCancelled`,
  `queueStateChanged` — emitted by `Dispatcher` via `ClientIO`, fanned
  out by `SharedDispatcher`'s existing wrapper.

`processCommand` RPC is **kept** for backward compatibility; the
server implements it as `submitCommand` + await-completion-event.
Legacy MCP-style "fire and await" callers continue to work unchanged.

Direct hosts (Shell, Web) call the same `Dispatcher` methods over
their own RPC channel (e.g. Electron IPC for Shell) — the same wire
shapes apply, just without the SharedDispatcher hop.

### 8.4 `JoinConversationResult.queueSnapshot`

`JoinConversationResult` already carries `pendingInteractions`. We
add `queueSnapshot` so a reconnecting client renders queue state
immediately instead of waiting for the next event.

`SharedDispatcher` (not `Dispatcher`) populates this field by calling
`dispatcher.getQueueSnapshot()` inside its `joinConversation()`
handler — reconnect semantics are a multi-client concern that direct
hosts don't have.

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

### 8.5 Client compatibility — what existing `processCommand` callers get for free

The queue lives inside `Dispatcher`, and the legacy
`processCommand(text, ...)` entry point is implemented as
`requestQueue.submit(...)` + await `entry.completion`. **Every caller
of `processCommand` is automatically queued** with no API changes —
they inherit FIFO ordering, single-in-flight execution, and
per-request cancellation the moment the upgrade lands:

| Client / caller                                             | Path                        | Free with queueing             |
| ----------------------------------------------------------- | --------------------------- | ------------------------------ |
| `vscode-shell/agentServerBridge.ts`                         | `dispatcher.processCommand` | ordering, cancel, backpressure |
| `api/webDispatcher.ts` (web/mobile)                         | `dispatcher.processCommand` | ordering, cancel, backpressure |
| `copilot-plugin/mcp/server.ts`                              | `dispatcher.processCommand` | ordering, cancel, backpressure |
| `commandExecutor/commandServer.ts`                          | `dispatcher.processCommand` | ordering, cancel, backpressure |
| `uriHandler/src/index.ts`                                   | `dispatcher.processCommand` | ordering, cancel, backpressure |
| Benchmarks (`taskflow`, `powershell`, `browser`)            | `dispatcher.processCommand` | ordering, cancel               |
| Agent recursive callers (`onboarding/testing`, `replay`, …) | `dispatcher.processCommand` | ordering, cancel               |

#### What's free vs. what's opt-in

| Capability                                            | Mechanism                                                    | Free for `processCommand` callers? |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| FIFO across overlapping submits                       | `requestQueue.submit` inside `Dispatcher.processCommand`     | ✅                                 |
| Single in-flight per Dispatcher                       | `RequestQueue` drain loop                                    | ✅                                 |
| Cancel a specific request by id                       | `dispatcher.cancelCommand(rid)`                              | ✅                                 |
| Queue-full backpressure (rejected promise)            | `QueueFullError` thrown from submit                          | ✅                                 |
| Ack-only submit (don't await completion)              | `dispatcher.submitCommand(...)`                              | ✋ opt-in (new API)                |
| Inspect queue contents / depth                        | `dispatcher.getQueueSnapshot()`                              | ✋ opt-in (new API)                |
| Jump-the-line                                         | `dispatcher.interrupt(...)`                                  | ✋ opt-in (new API)                |
| Per-request UI affordances ("queued"/"running" chips) | `ClientIO.requestQueued / requestStarted / requestCancelled` | ✋ opt-in (implement push events)  |
| Authoritative re-render                               | `ClientIO.queueStateChanged`                                 | ✋ opt-in (implement push event)   |
| Multi-client snapshot on (re)connect                  | `JoinConversationResult.queueSnapshot`                       | ✋ opt-in (read additive field)    |

A client only needs to touch its codebase if it wants to _surface_
queue state to the user (chips, badge, queue list, cancel buttons) or
use the new ack-only / interrupt / snapshot APIs. The underlying
queuing semantics — including ordering and cancellation — are
transparent to every existing `processCommand` caller.

---

## 9. Existing dispatcher state — how each interacts with the queue

Concrete answers for the dispatcher-state hooks the queue must reason
about.

### 9.1 `activityContext`

Each entry executes against the _current_ `activityContext` at
**dispatch** time, not at submit time. **No semantic change** from
today — the current `commandLock`-serialized world also reads
activity at dispatch.

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

`setUserRequest` continues to fire when execution _starts_, not when
queued. But the new `requestQueued` event fires at _submit time_, so
DisplayLog now has both records: a queued-entry record and an
execution-start record. Replay reconstructs the full timeline.

### 9.5 `isInsideReasoningLoop`

MCP sub-action dispatch happens _inside_ a running entry. The queue
treats the parent request as the single entry; sub-actions are
invisible to the queue. No interaction.

### 9.6 `@conversation switch` while queue is non-empty

The switch handler in the CLI's `conversationCommands.ts` (and the
Shell equivalent) calls `connection.joinConversation()`. With a
queue owned by `Dispatcher` (and a per-conversation `Dispatcher`):

- The user's current conversation's queue is untouched (it lives on
  that conversation's `Dispatcher`).
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
are handled by _reference counting_ the `blockedOn` flag inside
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

| Op                                 | Effect                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cancelCommand(running.requestId)` | Calls `RequestQueue.cancelRunning(rid, "user")` (which broadcasts `requestCancelled` immediately so other clients see the explicit cancel), then triggers the underlying `AbortController`; the dispatcher's pending `question` Promise rejects via the existing path. Entry → `cancelled`. |
| `cancelInteraction(interactionId)` | Cancels just the interaction; the dispatcher receives a rejection and decides what to do (typically also fails the request — agent-defined).                                                                                                                                                |

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

---

## 11. Reconnect / disconnect / server restart

> **Scope note.** Everything in this section is `SharedDispatcher`'s
> responsibility, not `Dispatcher`'s. Direct hosts (Shell main, Web)
> have no concept of "client disconnect" or "no clients" because
> there is exactly one consumer in-process. Direct hosts also own
> their own process lifecycle, so "server restart" is meaningless to
> them. The Dispatcher-resident queue is unchanged; the orchestration
> wrapper provides these behaviours on top.

### 11.1 Client disconnect

The submitting client disconnects (network drop, client crash, lid
close). The queue is **kept intact** — it lives in `Dispatcher`,
which is unaffected by client-side connection events.
`SharedDispatcher` notices the disconnect via its existing connection
tracking. The entry's `originatorConnectionId` becomes orphaned but
the entry remains addressable by `requestId`. Any other connected
client can interact with it.

Broadcast events for the running entry continue going to remaining
connected clients via the existing `SharedDispatcher` `ClientIO`
wrapper (`sharedDispatcher.ts:122–165`), which iterates all live
connections per conversation.

### 11.2 Client reconnect

On `joinConversation()`, `SharedDispatcher` calls
`dispatcher.getQueueSnapshot()` and returns it as
`JoinConversationResult.queueSnapshot` alongside
`pendingInteractions`. The reconnecting client renders the full
queue state immediately and subscribes to future events.

### 11.3 Server restart

Queue is in-memory inside `Dispatcher`; **lost on restart in v1**.
For agent-server hosts, clients see an empty queue on reconnect with
a clear "queue lost" indicator. Direct hosts simply don't notice —
the queue and the process live and die together.

**v1.5 plan:** `SharedDispatcher` persists queued entries (state
`"queued"`) via `DisplayLog.saveQueued()` at submit time;
reconstructs them into a fresh `Dispatcher` on startup. The in-flight
entry is **marked `failed` with `error: "server-restart"`** on
restart — the user sees it in the snapshot and decides to retry or
skip. We do **not** auto-resurrect the in-flight, because it may
have already had side effects (sent emails, written files) that
re-execution would duplicate.

This persistence layer lives entirely in `SharedDispatcher` because
only agent-server has the restart problem; pure `Dispatcher` hosts
are unaffected.

### 11.4 All clients disconnect

`SharedDispatcher` observes the connection roster. When the **last**
connected client drops, it starts a 30 second grace timer. If a
client reconnects within that window the timer is cleared and the
queue continues normally. (Direct hosts skip this entire section —
no concept of "no clients" applies.)

If the deadline elapses with no clients connected, `SharedDispatcher`:

1. **Lets the running entry continue if it is making progress.** Its
   side effects matter — an in-flight email send shouldn't be aborted
   because the user closed their terminal.
2. **Cancels the running entry if it is blocked on a `clientIO.question`**
   (`state: "running"`, `blockedOn: "interaction"`). With no client to
   answer the prompt, the entry will stall indefinitely; cancellation
   is the honest outcome. The grace-expiry callback in
   `sharedDispatcher.ts`:

   - calls `dispatcher.cancelCommand(rid)` with reason `"no_clients"`
     (the queue records the cancel reason on the head entry and the
     `ClientIO.requestCancelled` event fans out via the wrapper, and
     the same call fires the `AbortController` for the running entry),
   - rejects any matching pending interaction with an `Error` whose
     `name === "AbortError"` (so `command.ts`'s standard AbortError
     classification translates the agent's thrown rejection into
     `cancelled: true` rather than `failed`).

   When the drain loop sees the resulting `cancelled: true`, it
   stamps `entry.error = "cancelled:no_clients"` from the
   pre-recorded reason and the `queueStateChanged` event fans out.

3. **Cancels every queued entry** (`state: "queued"`) via
   `dispatcher.cancelCommand(rid)` for each.
4. The `requestCancelled` events with reason `"no_clients"` fan out
   for every cancelled entry. (Distinct from `"user"` cancel so a
   future reconnecting client could log "I cancelled these because
   you were gone".)
5. Leaves pending interactions to their existing 10-minute timeout.

When a client reconnects later, it sees an empty (or running-only)
queue via `JoinConversationResult.queueSnapshot` and the usual
lifecycle events on subsequent submits.

---

## 12. Multi-client semantics

The core queue mechanism is **conversation-scoped**: every connected
client of a `SharedDispatcher` sees the same queue and receives the
same lifecycle events. Direct `Dispatcher` hosts (Shell, Web) have
exactly one consumer per conversation, so multi-client semantics
collapse to single-consumer — the same code paths, just with one
receiver instead of N.

For agent-server-mediated conversations, any connected client can
submit and any connected client can cancel any entry — the model is
"one human, many clients."

| Action                                    | From originating client | From other connected client | While client is disconnected |
| ----------------------------------------- | ----------------------- | --------------------------- | ---------------------------- |
| Submit (`submitCommand`)                  | OK                      | OK                          | N/A                          |
| Cancel queued / running (`cancelCommand`) | OK                      | OK                          | N/A                          |
| Respond to interaction                    | OK (existing race)      | OK (existing race)          | N/A                          |

**No queue-ownership in v1.** Any connected client can act on any
entry regardless of which client originally submitted it. Add an
`owner-only` mode later if real usage demands.

---

## 13. Testing

Tests split along the layering. **Dispatcher-level queue tests** live
with the queue itself (proposed
`packages/dispatcher/dispatcher/test/requestQueue.spec.ts`) and
exercise the mechanism without any agent-server. They run against a
Dispatcher constructed in-process with a stub `ClientIO`, so they
catch queue regressions for direct hosts (Shell, Web) as well as
agent-server-mediated ones.

- **Drain order.** Submit A, B, C; assert they run in order; each
  fires `requestStarted` then `requestCompleted`.
- **Cancel queued.** Submit A; submit B; cancel B; assert B never
  starts.
- **Cancel running.** Submit A (slow); cancel A; assert
  `AbortController` fires; entry → `cancelled`; next entry drains.
- **Pending interaction + queue.** Submit A; A triggers
  `clientIO.question`; submit B; respond to interaction; assert A
  completes then B runs.
- **Snapshot coalescing.** Fire 20 rapid submits; assert at most one
  snapshot event per 100ms window; assert all fine-grained
  `requestQueued` events are delivered.
- **Bounded queue.** Submit `MAX_QUEUE_DEPTH + 1` entries; assert the
  last fails with `SubmitResult.error = "queue_full"`.
- **Graceful shutdown.** Submit several entries; call
  `drainAndStop(0)`; assert all unfinished entries are cancelled with
  reason `"server_stopping"` and the returned promise resolves.
- **Version watermark.** Assert `version` increments monotonically on
  every transition; assert paired `queueStateChanged` snapshot
  carries the same `version` as the fine-grained event.

**SharedDispatcher integration tests** (in
`packages/agentServer/server/test/sharedDispatcherQueue.spec.ts`)
cover the multi-client orchestration that only matters when the
inner Dispatcher is wrapped:

- **Multi-client broadcast fan-out.** Two test harness clients
  connected to the same conversation; one submits; assert both
  receive `requestQueued`, `requestStarted`, `queueStateChanged` via
  their respective `ClientIO` mocks. Assert the inner Dispatcher
  fired each call exactly once.
- **Cross-client cancel.** Client A submits; Client B cancels;
  assert both see the same final snapshot.
- **Reconnect with non-empty queue.** Disconnect client mid-queue;
  reconnect; assert `JoinConversationResult.queueSnapshot` returned
  by `SharedDispatcher.joinConversation()` matches
  `dispatcher.getQueueSnapshot()`.
- **All-clients-disconnect.** Disconnect all; assert running entry
  completes if not blocked; assert blocked-on-interaction running
  entry and all queued entries are cancelled with reason
  `"no_clients"` after the 30s grace timer (§11.4). Verify
  cancellation paths go through `dispatcher.cancelCommand`.
- **Privacy redaction.** Submit with attachments; assert the
  originator's local `ClientIO` callback sees full attachments while
  fanned-out copies to other clients see only `attachmentCount`.

### 13.1 Telemetry

`requestQueue:submit`, `:start`, `:complete`, `:cancel`,
`:reconnect-restore`.

Payloads include `connectionId` of the actor so we can answer
"which client submitted what?" type questions. Direct-host events
record the host kind (`"shell"`, `"api"`) in place of `connectionId`.

Note for anyone migrating from earlier sketches: events are prefixed
`requestQueue:` (not `messageQueue:`) and there is no `:reorder`
event. See the deprecated docs for the earlier draft that had both.

---

## 14. References

- [`_deprecated/messageQueueing-original.md`](./_deprecated/messageQueueing-original.md)
  — the original client-side design; preserved for the §4
  dispatcher-state analysis.
- [`_deprecated/messageQueueing-review.md`](./_deprecated/messageQueueing-review.md)
  — the review of the client-side design that motivated the
  earlier server-side rewrite.
- `packages/dispatcher/dispatcher/src/dispatcher.ts` — owns the
  queue under this design; gains `submitCommand` and
  `getQueueSnapshot` as real (non-fallback) implementations.
- `packages/dispatcher/dispatcher/src/requestQueue.ts` — the
  `RequestQueue` class.
- `packages/dispatcher/types/src/queue.ts` — wire types
  (`QueuedRequest`, `QueueSnapshot`, `SubmitResult`,
  `QueueCancelReason`).
- `packages/agentServer/server/src/sharedDispatcher.ts` — orchestrates
  multi-client fan-out, reconnect snapshot, no-clients grace timer,
  and v1.5 server-restart persistence. Owns no queue state.
- `packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts`
  — declares `commandLock`.
- `packages/utils/commonUtils/src/limiter.ts` — the `Limiter` backing
  `commandLock`.
- `packages/agentServer/protocol/src/` — wire protocol additions land
  here (`submitCommand` RPC, `requestQueued` / `requestStarted` /
  `requestCancelled` / `queueStateChanged` push events,
  `JoinConversationResult.queueSnapshot`).
- `packages/agentServer/docs/async-clientio-design.md` — the
  established pattern for async, disconnect-resilient ClientIO that
  the queue's `ClientIO`-mediated event routing extends.
- Direct hosts that exercise `Dispatcher` outside of agent-server
  and so benefit from this design without going through
  `SharedDispatcher`:
  `packages/shell/src/main/instance.ts` (Electron Shell main),
  `packages/api/src/webDispatcher.ts` (Web API server),
  `packages/cli/src/commands/test/translate.ts` (CLI test commands),
  `packages/dispatcher/dispatcher/test/**` (dispatcher tests).
