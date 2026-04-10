# Async ClientIO Interactions: Design

## Status

**Implemented** | April 2026 | Open: Question 3

## Overview

Three `ClientIO` methods — `askYesNo`, `proposeAction`, and `popupQuestion` — use a **non-blocking, deferred-promise pattern** in the agent-server's `SharedDispatcher`. Rather than blocking on a synchronous RPC round-trip to the originating client, the server broadcasts a fire-and-forget notification, suspends execution via a stored `Promise`, and resumes when any connected client responds. This allows commands to survive client disconnects, supports multi-client sessions, and integrates with the `DisplayLog` for session replay.

The `ClientIO` interface signatures are unchanged — callers receive a `Promise<boolean | unknown | number>` as before. Only the server-side fulfillment mechanism differs.

---

## Architecture

### Flow

```
Agent code → askYesNoWithContext() → context.clientIO.askYesNo()
  → SharedDispatcher:
     1. Broadcast requestInteraction (fire-and-forget) to eligible clients
     2. If notified === 0: return defaultValue / throw (no log entry)
     3. Log pending-interaction to DisplayLog
     4. Store deferred Promise in PendingInteractionManager
     5. Return the Promise — server suspends here
  → Client shows UI, user responds
  → Client calls dispatcher.respondToInteraction(interactionId, value)
  → PendingInteractionManager.resolve() fulfills the Promise
  → Log interaction-resolved to DisplayLog
  → Broadcast interactionResolved to all clients
  → Agent code continues
```

`popupQuestion` is identical except it broadcasts to all clients (it has no `requestId`). `proposeAction` follows the same pattern as `askYesNo` but throws instead of returning a default when no clients are connected.

### Key invariant: log after broadcast

`logPendingInteraction` is called only after `broadcast()` confirms at least one client was notified. This prevents orphaned `pending-interaction` entries in the log for interactions that were never actionable.

### Routing

The `broadcast()` helper respects each client's `filter` setting:

- `filter: false` (default) — receives all messages, plus those routed to its own `connectionId`
- `filter: true` — receives only messages routed to its own `connectionId`

`askYesNo` and `proposeAction` broadcast to clients eligible for `requestId.connectionId`. `popupQuestion` broadcasts to all clients unconditionally.

### Pending Interaction Manager

`PendingInteractionManager` (`dispatcher/src/context/pendingInteractionManager.ts`) stores in-flight interactions:

- `create(request, connectionId, timeoutMs)` — stores the deferred Promise, sets an optional timeout
- `resolve(interactionId, value)` — fulfills the Promise; returns false if not found
- `cancel(interactionId, error)` — for `askYesNo`: resolves with `defaultValue` if provided, otherwise rejects; for `proposeAction` and `popupQuestion`: always rejects
- `cancelByConnection(connectionId, error)` — cancels all interactions for a disconnecting client
- `getPending()` — returns all in-flight `PendingInteractionRequest` objects

### Timeouts

All three types use a 10-minute timeout, kept as separate constants so they can be tuned independently. On timeout, `cancel()` is called with a timeout error.

### Client Disconnect

When a client disconnects, `cancelByConnection()` is called immediately. Each cancelled interaction triggers:

1. `interactionCancelled` broadcast to remaining clients (so they can dismiss stale UI)
2. A `interaction-cancelled` entry in the `DisplayLog`

There is no reconnect grace period — cancellation is immediate.

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

### New `Dispatcher` method (client → server)

```typescript
respondToInteraction(response: PendingInteractionResponse): Promise<void>;
```

### Types (`@typeagent/dispatcher-types`)

```typescript
export type PendingInteractionType =
  | "askYesNo"
  | "proposeAction"
  | "popupQuestion";

export type PendingInteractionRequest = {
  interactionId: string;
  type: PendingInteractionType;
  requestId?: RequestId; // absent for popupQuestion
  source: string;
  timestamp: number;
} & (
  | { type: "askYesNo"; message: string; defaultValue?: boolean }
  | { type: "proposeAction"; actionTemplates: TemplateEditConfig }
  | {
      type: "popupQuestion";
      message: string;
      choices: string[];
      defaultId?: number;
    }
);

export type PendingInteractionResponse = {
  interactionId: string;
  type: PendingInteractionType;
  value: boolean | unknown | number;
};
```

---

## Standalone Dispatcher (CLI, Electron Shell)

The standalone dispatcher continues using the direct blocking RPC pattern — only `SharedDispatcher` uses the deferred pattern. The `ClientIO` interface is unchanged.

The shell and CLI `requestInteraction`/`interactionResolved`/`interactionCancelled` implementations are currently no-ops. In agent-server connect mode, deferred interactions will time out rather than be surfaced in the UI. Full shell/CLI support is tracked as future work.

---

## Open Questions

1. **Broadcast vs. primary-client routing for `popupQuestion`**

   Currently broadcast to all clients; first responder wins. Other clients receive `interactionResolved` and dismiss their UI. Routing to a designated primary client would be more precise but requires adding a `connectionId` to the `popupQuestion` signature.

2. **Timeouts** — resolved: 10 minutes for all three types (separate constants).

3. **Unify `requestChoice`/`respondToChoice` with this system?**

   Architecturally similar but semantically distinct — `requestChoice` is agent-initiated via `ActionResult`, not system-initiated. Leave separate for now; revisit in a future iteration.

4. **Grace period on disconnect** — resolved: immediate cancellation. A reconnect grace period is not implemented; if added later, pending interactions could be replayed to a reconnecting client.

---

## Sequence Diagrams

### askYesNo: Normal Flow

```
Client              SharedDispatcher          PendingInteractionMgr     DisplayLog
  |                       |                           |                      |
  |   (command in progress, agent calls askYesNo)     |                      |
  |<-- requestInteraction-|                           |                      |
  |                       |--- logPendingInteraction --------------------->  |
  |                       |--- create(request) ------->                      |
  |                       |<-- Promise<boolean> -------|                      |
  |                       |   (server suspends here)  |                      |
  |   (user clicks Yes)   |                           |                      |
  |-- respondToInteraction -->                        |                      |
  |                       |--- resolve(id, true) ---->|                      |
  |                       |--- logInteractionResolved -------------------->  |
  |                       |   (Promise resolves, command continues)          |
```

### askYesNo: Client Disconnect

```
Client              SharedDispatcher          PendingInteractionMgr
  |                       |                           |
  |<-- requestInteraction-|                           |
  |                       |                           |
  X  (client disconnects) |                           |
  |                       |--- cancelByConnection --->|
  |                       |   (resolves with defaultValue or rejects)
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
  |                   |                     |--- resolve(id, 1) ------>|
  |                   |<-- interactionResolved (id, 1) --|              |
  |                   |   (ClientB dismisses UI)        |              |
```
