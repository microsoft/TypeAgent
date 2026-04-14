# Async ClientIO Interactions: Design

## Status

**Implemented** | April 2026 | Open: Question 3

## Overview

Two `ClientIO` methods — `question` and `proposeAction` — use a **non-blocking, deferred-promise pattern** in the agent-server's `SharedDispatcher`. Rather than blocking on a synchronous RPC round-trip to the originating client, the server broadcasts a fire-and-forget notification, suspends execution via a stored `Promise`, and resumes when any connected client responds. This allows commands to survive client disconnects, supports multi-client sessions, and integrates with the `DisplayLog` for session replay.

The `ClientIO` interface signatures are unchanged — callers receive a `Promise<number | unknown>` as before. Only the server-side fulfillment mechanism differs.

---

## Architecture

### Flow

```
Agent code → askYesNoWithContext() → context.clientIO.question()
  → SharedDispatcher:
     1. Broadcast requestInteraction (fire-and-forget) to eligible clients
     2. Log pending-interaction to DisplayLog
     3. Store deferred Promise in PendingInteractionManager
     4. Return the Promise — server suspends here
  → Client shows UI, user responds
  → Client calls dispatcher.respondToInteraction(interactionId, value)
  → PendingInteractionManager.resolve() fulfills the Promise
  → Log interaction-resolved to DisplayLog
  → Broadcast interactionResolved to all clients
  → Agent code continues
```

`popupQuestion` (via `SessionContext`) follows the same path as `askYesNoWithContext` — both delegate to `clientIO.question()`. `proposeAction` follows the same deferred pattern but throws instead of returning a default when no clients are connected.

### Key invariant: always log

`logPendingInteraction` is called unconditionally for both interaction types — even when no clients are currently connected. This ensures that a client which reconnects within the timeout window can see the pending interaction in `JoinSessionResult.pendingInteractions` and respond to it. The log and `PendingInteractionManager` entry are created before the broadcast so the interaction is visible to any client joining concurrently.

### Routing

The `broadcast()` helper respects each client's `filter` setting:

- `filter: false` (default) — receives all messages, plus those routed to its own `connectionId`
- `filter: true` — receives only messages routed to its own `connectionId`

`question` and `proposeAction` broadcast to clients eligible for `requestId.connectionId`. `popupQuestion` (which passes no `requestId`) broadcasts to all clients unconditionally.

### Pending Interaction Manager

`PendingInteractionManager` (`dispatcher/src/context/pendingInteractionManager.ts`) stores in-flight interactions:

- `create(request, timeoutMs)` — stores the deferred Promise, sets an optional timeout
- `resolve(interactionId, value)` — fulfills the Promise; returns false if not found
- `cancel(interactionId, error)` — for `question` with a `defaultId`: resolves with that index; otherwise rejects; for `proposeAction`: always rejects
- `getPending()` — returns all in-flight `PendingInteractionRequest` objects

### Timeouts

Both types use a 10-minute timeout, kept as separate constants so they can be tuned independently. On timeout, `cancel()` is called with a timeout error.

### Client Disconnect

Disconnecting a client does **not** automatically cancel pending interactions. Interactions remain pending until they time out or a client explicitly calls `cancelInteraction`. This allows a reconnecting client to respond to the same interaction within the timeout window.

Both interaction types log unconditionally and survive in the pending map if no client is connected, so a later-joining client will see them in `JoinSessionResult.pendingInteractions`. However, with the current ephemeral `connectionId` design, a reconnecting client's new `connectionId` will not match the stored one for `question`/`proposeAction` interactions and they will be filtered out — see Open Question 5.

Clients that want to cancel an interaction (e.g., on user dismissal) call `dispatcher.cancelInteraction(interactionId)`, which triggers:

1. `interactionCancelled` broadcast to all clients (so they can dismiss stale UI)
2. An `interaction-cancelled` entry in the `DisplayLog`

### DisplayLog Integration

Three entry types are logged to `DisplayLog`:

- `pending-interaction` — uses `interaction.timestamp` (the creation time of the request, not wall-clock at log time) to keep replay order consistent
- `interaction-resolved` — response is JSON-safe normalized before storage
- `interaction-cancelled`

### Session Join / Reconnection

`JoinSessionResult` includes `pendingInteractions: PendingInteractionRequest[]`, populated by `getPendingInteractions(connectionId, filter)`. This mirrors the `broadcast` eligibility rules exactly — a joining client only receives interactions it would have been sent during normal operation.

Clients can immediately render UI for unresolved interactions on connect.

---

## Protocol

### New `ClientIO` call functions (fire-and-forget, server → client)

```typescript
requestInteraction(interaction: PendingInteractionRequest): void;
interactionResolved(interactionId: string, response: unknown): void;
interactionCancelled(interactionId: string): void;
```

### New `Dispatcher` methods (client → server)

```typescript
respondToInteraction(response: PendingInteractionResponse): Promise<void>; // invoke (awaited)
cancelInteraction(interactionId: string): void;                            // send (fire-and-forget)
```

### Types (`@typeagent/dispatcher-types`)

```typescript
export type PendingInteractionType = "question" | "proposeAction";

export type PendingInteractionRequest = {
  interactionId: string;
  type: PendingInteractionType;
  requestId?: RequestId;
  source: string;
  timestamp: number;
} & (
  | { type: "question"; message: string; choices: string[]; defaultId?: number }
  | { type: "proposeAction"; actionTemplates: TemplateEditConfig }
);

export type PendingInteractionResponse =
  | { interactionId: string; type: "question"; value: number }
  | { interactionId: string; type: "proposeAction"; value: unknown };
```

---

## Standalone Dispatcher (CLI, Electron Shell)

The standalone dispatcher continues using the direct blocking RPC pattern — only `SharedDispatcher` uses the deferred pattern. The `ClientIO` interface is unchanged.

The shell and CLI `requestInteraction`/`interactionResolved`/`interactionCancelled` implementations are currently no-ops. In agent-server connect mode, deferred interactions will time out rather than be surfaced in the UI. Full shell/CLI support is tracked as future work.

---

## Open Questions

1. **Broadcast vs. primary-client routing for `popupQuestion`**

   Currently broadcast to all clients; first responder wins. Other clients receive `interactionResolved` and dismiss their UI. Routing to a designated primary client would be more precise but requires adding a `connectionId` to the `popupQuestion` signature.

2. **Timeouts** — resolved: 10 minutes for all types (separate constants).

3. **Unify `requestChoice`/`respondToChoice` with this system?**

   Architecturally similar but semantically distinct — `requestChoice` is agent-initiated via `ActionResult`, not system-initiated. Leave separate for now; revisit in a future iteration.

4. **Grace period on disconnect** — disconnecting a client does not auto-cancel pending interactions. Interactions remain pending until they time out or a client explicitly calls `cancelInteraction`. Reconnecting clients see pending interactions in `JoinSessionResult.pendingInteractions` and can respond or cancel them.

5. **Stable client identity for reconnect routing** — `question`/`proposeAction` interactions capture `requestId.connectionId` at creation time, but `connectionId` is ephemeral: each `join()` call mints a new value. A reconnecting client therefore gets a new `connectionId` that never matches the stored one, so `getPendingInteractions()` filters those interactions out and they become permanently unresolvable until timeout.

   Two candidate fixes:

   - **Stable `clientId` in `DispatcherConnectOptions`** _(preferred)_: the client generates a persistent UUID once and passes it on every `join()`. On reconnect, `SharedDispatcher` looks up the previous `connectionId` for that `clientId` and calls `PendingInteractionManager.retargetConnection(oldId, newId)` to rewrite `requestId.connectionId` on all matching pending interactions. This restores correct routing for both `broadcast`-based interactions and `callback`-based ones (`requestChoice`, `takeAction`).
   - **Clear `connectionId` on disconnect**: strip `requestId.connectionId` from pending interactions when their originating client disconnects, demoting them to "broadcast to all unfiltered clients". Simpler, but breaks isolation in multi-client sessions and does not help `filter: true` clients.

   Tracked in `sharedDispatcher.ts` `join()` with a `// TODO` comment.

---

## Sequence Diagrams

### question: Normal Flow

```
Client              SharedDispatcher          PendingInteractionMgr     DisplayLog
  |                       |                           |                      |
  |   (command in progress, agent calls question())   |                      |
  |<-- requestInteraction-|                           |                      |
  |                       |--- logPendingInteraction --------------------->  |
  |                       |--- create(request) ------->                      |
  |                       |<-- Promise<number> --------|                      |
  |                       |   (server suspends here)  |                      |
  |   (user picks "1")    |                           |                      |
  |-- respondToInteraction -->                        |                      |
  |                       |--- resolve(id, 0) ------->|                      |
  |                       |--- logInteractionResolved -------------------->  |
  |                       |   (Promise resolves, command continues)          |
```

### question: Client Disconnect (interaction survives)

```
Client              SharedDispatcher          PendingInteractionMgr
  |                       |                           |
  |<-- requestInteraction-|                           |
  |                       |--- logPendingInteraction->|
  |                       |--- create(request) ------->
  |                       |                           |
  X  (client disconnects) |                           |
  |                       |   (interaction stays pending until timeout)
  |                       |                           |
  | (same or new client reconnects and calls cancelInteraction)
  |-- cancelInteraction(id) -->                       |
  |                       |--- cancel(id, error) ---->|
  |                       |<-- interactionCancelled --|
  |<-- interactionCancelled broadcast                 |
```

### popupQuestion: Multi-Client Broadcast

```
ClientA             ClientB           SharedDispatcher          PendingInteractionMgr
  |                   |                     |                           |
  |                   |  (agent calls popupQuestion)                   |
  |<-- requestInteraction ------------------|                          |
  |                   |<-- requestInteraction --|                      |
  |  (user answers 1) |                     |                           |
  |-- respondToInteraction ---------------->|                           |
  |                   |                     |--- resolve(id, 0) ------>|
  |                   |<-- interactionResolved (id, 0) --|              |
  |                   |   (ClientB dismisses UI)        |              |
```
