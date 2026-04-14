---
layout: docs
title: Multi-Client Interaction Protocol
---

## Overview

When multiple clients are connected to the same session via the AgentServer, the dispatcher needs to present interactive prompts (yes/no confirmations, choice menus, template editing) to the user. Because any connected client could be the active one, these interactions follow a **broadcast-and-race** pattern: the server sends the prompt to all clients simultaneously, and the first client to respond wins.

This document describes the protocol, the server-side machinery, and the responsibilities of each client implementation.

## Server-Side: SharedDispatcher

A `SharedDispatcher` is a single dispatcher instance shared among all clients connected to the same session. It owns a `PendingInteractionManager` — a map of in-flight interactions, each backed by a deferred promise that the dispatcher awaits to unblock execution.

### Interaction lifecycle

```
Server dispatcher                 Client A              Client B
─────────────────                 ────────              ────────
askYesNo() called
  create PendingInteraction
  broadcast requestInteraction ──► show prompt          show prompt
  await promise...

                                  user answers "y"
                                  respondToInteraction ──► server resolves promise
                                                           broadcast interactionResolved ──► dismiss prompt
  promise resolves
  execution continues
```

The same flow applies to `proposeAction` and `popupQuestion`.

### Broadcast vs. targeted routing

Most `ClientIO` calls are **targeted**: they carry a `requestId.connectionId` that identifies which client initiated the request, and the server routes the call only to that client.

Interaction calls are **broadcast** to all clients, regardless of which client initiated the originating request. This is intentional: in a multi-client session the active user may be on any client.

| ClientIO method        | Routing                           | Notes                                                              |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `setDisplay`           | Broadcast (filtered by requestId) | All clients see output                                             |
| `askYesNo`             | Deferred broadcast                | Creates a `PendingInteraction`; broadcast via `requestInteraction` |
| `proposeAction`        | Deferred broadcast                | Same pattern                                                       |
| `popupQuestion`        | Deferred broadcast                | Same pattern                                                       |
| `requestInteraction`   | Broadcast                         | Sent to all clients to show the prompt                             |
| `interactionResolved`  | Broadcast                         | Sent to all clients after any one responds                         |
| `interactionCancelled` | Broadcast                         | Sent to all clients after `cancelInteraction` or timeout           |

### Timeouts

Pending interactions have a 10-minute timeout (configurable per-type in `sharedDispatcher.ts`). On timeout the deferred promise rejects and `interactionCancelled` is broadcast to all clients.

### Reconnects

Each `join()` call mints a new ephemeral `connectionId`. On reconnect a client receives a fresh `connectionId`, so interactions created before the disconnect (whose `requestId.connectionId` names the old connection) are not re-broadcast to the new connection. A joining client receives any still-pending interactions via `JoinSessionResult.pendingInteractions` and is responsible for displaying them and potentially responding.

## Client Responsibilities

Every `ClientIO` implementation must handle three interaction-related methods.

### `requestInteraction(interaction)`

Called when the server needs the client to show a prompt. The client must:

1. Display the appropriate UI for the interaction type (`askYesNo`, `popupQuestion`, or `proposeAction`).
2. Register the interaction locally (keyed by `interaction.interactionId`) so it can be dismissed later.
3. When the user responds, call `dispatcher.respondToInteraction(response)`.
4. Remove the local registration after responding or after being dismissed.

Only one client needs to respond — the server ignores duplicate responses for the same `interactionId`.

### `interactionResolved(interactionId, response)`

Called on all clients after any client successfully calls `respondToInteraction`. The client must:

1. Look up the active prompt by `interactionId`.
2. Cancel or dismiss the prompt without sending another response.
3. Optionally show a brief notice (e.g. `[answered by another client]`) so the user understands why the prompt disappeared.

### `interactionCancelled(interactionId)`

Called on all clients after `cancelInteraction` is called or the interaction times out. The client must:

1. Look up the active prompt by `interactionId`.
2. Cancel or dismiss the prompt.
3. Optionally show a notice (e.g. `[interaction cancelled]`).

## CLI Implementation Requirements

The CLI (`enhancedConsole.ts`) owns stdin and renders prompts inline in the terminal. To support multiple clients it needs:

### Active prompt registry

A `Map<string, { cancel: () => void }>` keyed by `interactionId`, local to `createEnhancedClientIO`. Each entry holds a function that aborts the in-progress `question()` call for that interaction.

```typescript
const activeInteractions = new Map<string, { cancel: () => void }>();
```

### Cancellable `question()` races

`requestInteraction` wraps the `question()` call in a `Promise.race` against a cancellation promise. The cancellation promise rejects when `cancel()` is called (by `interactionResolved` or `interactionCancelled`).

```
requestInteraction(interaction):
  cancelled = false
  cancelFn = () => { cancelled = true; rejectCancelPromise() }
  activeInteractions.set(interaction.interactionId, { cancel: cancelFn })

  try:
    input = await Promise.race([question(prompt), cancelPromise])
    if (!cancelled):
      build response
      await dispatcher.respondToInteraction(response)
  catch (CancelledError):
    // dismissed — print notice if resolved by another client vs. cancelled
  finally:
    activeInteractions.delete(interaction.interactionId)
```

The `question()` function itself must also clean up its stdin listener when the outer race rejects, to avoid a leaked `data` listener on stdin.

### `interactionResolved` and `interactionCancelled`

```typescript
interactionResolved(interactionId, response): void {
    activeInteractions.get(interactionId)?.cancel();
    // "resolved" variant — optionally print "[answered by another client]"
},
interactionCancelled(interactionId): void {
    activeInteractions.get(interactionId)?.cancel();
    // "cancelled" variant — optionally print "[interaction cancelled]"
},
```

The cancel functions must distinguish resolved vs. cancelled so the client can print the appropriate notice. This can be done by passing a reason string to `cancel()`, or by using two separate rejection types.

## Shell Implementation Notes

The Shell (`main.ts`) is not yet implemented (stubs in place). The same pattern applies: hold a `Map<interactionId, dismissFn>` and call `dismissFn` from `interactionResolved`/`interactionCancelled`. The UI (modal dialog or inline card) should be dismissed programmatically and a toast shown if resolved by a remote client.

## Future Work

### Unify `askYesNo` and `popupQuestion` into a single `question` type

`askYesNo` is a special case of `popupQuestion` — a two-choice prompt where choices are implicitly `["Yes", "No"]` and the response is a boolean rather than an index. The protocol could be simplified by collapsing both into a single `question` interaction type:

```typescript
// Unified request
{ type: "question"; message: string; choices: string[]; defaultId?: number }

// Unified response
{ interactionId: string; type: "question"; value: number }
```

Caller ergonomics on `SessionContext` can be preserved with thin wrappers that map the boolean/index conversion. `proposeAction` remains intentionally separate — it renders a structured template editor rather than a text prompt, and its response type is `unknown`.

Benefits:

- One code path in all `ClientIO` implementations instead of two
- Simpler discriminated union in `PendingInteractionRequest` / `PendingInteractionResponse`
- Consistent rendering logic across CLI, Shell, and future clients
